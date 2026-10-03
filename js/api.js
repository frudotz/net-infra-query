// Backend client: Turnstile-backed session handling, timeouts, one transparent
// session renewal on 401, request de-duplication, and errors that always
// carry a user-presentable Turkish message.

const API_BASE = (document.querySelector('meta[name="niq-api-base"]')?.content || 'https://niq.api.frudotz.com').replace(/\/+$/, '');
const TOKEN_KEY = 'api_token';
const SESSION_WAIT_MS = 20_000;

export class ApiError extends Error {
    constructor(message, { code = 'UNKNOWN', status = 0, isRateLimited = false, requestId = null, retryable = false } = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        this.isRateLimited = isRateLimited;
        this.requestId = requestId;
        this.retryable = retryable;
    }
}

// ---------- session ----------

function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(token) {
    try {
        if (token) sessionStorage.setItem(TOKEN_KEY, token);
        else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* storage blocked: token lives in memory only */ }
}

let sessionToken = readToken();
let waiters = [];
let exchanging = false;
let sessionFailed = false;

function settleWaiters(err) {
    const list = waiters;
    waiters = [];
    for (const w of list) {
        clearTimeout(w.timer);
        if (err) w.reject(err);
        else w.resolve(sessionToken);
    }
}

async function exchangeTurnstileToken(turnstileToken) {
    if (exchanging) return;
    exchanging = true;
    try {
        const res = await fetch(`${API_BASE}/?action=session`, {
            headers: { 'X-Turnstile-Token': turnstileToken },
            signal: AbortSignal.timeout(15_000),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success || !body.token) {
            throw new ApiError(body?.error || 'Güvenlik doğrulaması tamamlanamadı.', {
                code: body?.code || 'SESSION_FAILED', status: res.status, isRateLimited: Boolean(body?.isRateLimited), requestId: body?.requestId,
            });
        }
        sessionToken = body.token;
        sessionFailed = false;
        writeToken(sessionToken);
        settleWaiters(null);
    } catch (err) {
        const apiErr = err instanceof ApiError ? err : new ApiError('Güvenlik sunucusuna bağlanılamadı. İnternet bağlantınızı kontrol edin.', { code: 'NETWORK', retryable: true });
        sessionFailed = true;
        settleWaiters(apiErr);
    } finally {
        exchanging = false;
    }
}

window.__turnstileBridge?.subscribe((type, value) => {
    if (type === 'success') {
        // A token we already hold is still valid; Turnstile ran because the page loaded.
        if (sessionToken) {
            settleWaiters(null);
            return;
        }
        exchangeTurnstileToken(value);
    } else if (type === 'error') {
        const err = new ApiError('Bot doğrulaması tamamlanamadı. Sayfayı yenileyip tekrar deneyin.', { code: 'BOT_CHECK_FAILED' });
        sessionFailed = true;
        settleWaiters(err);
    }
});

function resetTurnstile() {
    try {
        if (window.turnstile?.reset) window.turnstile.reset();
    } catch { /* widget not rendered yet; it will run on load */ }
}

export function ensureSession() {
    if (sessionToken) return Promise.resolve(sessionToken);
    // A previous attempt failed: run the challenge again instead of waiting forever.
    if (sessionFailed && !exchanging) {
        sessionFailed = false;
        resetTurnstile();
    }
    return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        waiter.timer = setTimeout(() => {
            waiters = waiters.filter((w) => w !== waiter);
            reject(new ApiError('Güvenlik doğrulaması zaman aşımına uğradı. Sayfayı yenileyip tekrar deneyin.', { code: 'SESSION_TIMEOUT', retryable: true }));
        }, SESSION_WAIT_MS);
        waiters.push(waiter);
    });
}

function invalidateSession() {
    sessionToken = null;
    writeToken(null);
    resetTurnstile();
}

// ---------- requests ----------

function combineSignals(signals) {
    const list = signals.filter(Boolean);
    if (list.length <= 1) return list[0];
    if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
    return list[0];
}

const FALLBACK_MESSAGES = {
    400: 'İstek geçersiz. Girdiğiniz bilgileri kontrol edin.',
    401: 'Oturum doğrulanamadı. Sayfayı yenileyip tekrar deneyin.',
    403: 'Erişim reddedildi.',
    404: 'Kayıt bulunamadı.',
    429: 'Çok fazla istek gönderildi. Biraz bekleyip tekrar deneyin.',
    500: 'Sunucuda beklenmeyen bir hata oluştu.',
    503: 'Servis şu an kullanılamıyor. Birkaç dakika sonra tekrar deneyin.',
    504: 'Servis zamanında yanıt vermedi. Tekrar deneyin.',
};

async function rawGet(params, { signal, timeoutMs }) {
    const token = await ensureSession();
    const url = `${API_BASE}/?${new URLSearchParams(params)}`;
    let res;
    try {
        res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: combineSignals([signal, AbortSignal.timeout(timeoutMs)]),
        });
    } catch (err) {
        if (signal?.aborted) throw err; // caller cancelled: propagate AbortError
        if (err?.name === 'TimeoutError') {
            throw new ApiError('Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.', { code: 'CLIENT_TIMEOUT', retryable: true });
        }
        throw new ApiError('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.', { code: 'NETWORK', retryable: true });
    }
    let body = null;
    try { body = await res.json(); } catch { /* handled below */ }
    return { res, body };
}

/**
 * GET /?…params. Resolves to the parsed JSON body (success === true) or
 * throws ApiError. An expired/IP-changed session is renewed once
 * transparently through Turnstile.
 */
export async function apiGet(params, { signal, timeoutMs = 25_000 } = {}) {
    let { res, body } = await rawGet(params, { signal, timeoutMs });
    if (res.status === 401) {
        invalidateSession();
        ({ res, body } = await rawGet(params, { signal, timeoutMs }));
        if (res.status === 401) invalidateSession();
    }
    if (!body || typeof body !== 'object') {
        throw new ApiError('Sunucudan beklenmeyen bir yanıt alındı. Lütfen tekrar deneyin.', { code: 'BAD_RESPONSE', status: res.status, retryable: true });
    }
    if (!res.ok || body.success !== true) {
        throw new ApiError(body.error || FALLBACK_MESSAGES[res.status] || 'İşlem tamamlanamadı.', {
            code: body.code || `HTTP_${res.status}`,
            status: res.status,
            isRateLimited: Boolean(body.isRateLimited) || res.status === 429,
            requestId: body.requestId || res.headers.get('X-Request-Id'),
            retryable: res.status >= 500 || res.status === 0,
        });
    }
    return body;
}

// Address lists rarely change: memoise per page load and share in-flight requests.
const addressCache = new Map();

export function fetchAddressList(level, id, { signal } = {}) {
    const key = `${level}:${id || ''}`;
    if (addressCache.has(key)) return addressCache.get(key);
    const params = { action: 'address', level };
    if (id) params.id = id;
    const p = apiGet(params, { timeoutMs: 15_000 }).then((body) => (Array.isArray(body.data) ? body.data : []));
    addressCache.set(key, p);
    p.catch(() => addressCache.delete(key));
    // Callers may abandon a stale request; the shared promise keeps running for others.
    if (signal) {
        return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            p.then(resolve, reject);
        });
    }
    return p;
}

export function fetchInfra(bbk, il) {
    return apiGet({ action: 'infra', kapi: bbk, il }, { timeoutMs: 30_000 });
}

export function fetchGeocode(lat, lon) {
    return apiGet({ action: 'geocode', lat: lat.toFixed(6), lon: lon.toFixed(6) }, { timeoutMs: 15_000 });
}

export function fetchIpLocation() {
    return apiGet({ action: 'ip_location' }, { timeoutMs: 8_000 });
}
