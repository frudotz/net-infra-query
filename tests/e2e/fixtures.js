// Shared Playwright fixtures: every third-party request is served locally so
// tests are deterministic and offline (Turnstile stub, Inter from
// @fontsource, Leaflet from node_modules, blank map tiles, mocked API).
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NM = fileURLToPath(new URL('../../node_modules/', import.meta.url));
export const API = 'https://niq.api.frudotz.com';

const TURNSTILE_STUB = `
(() => {
  let n = 0;
  window.__turnstileResets = 0;
  const fire = () => setTimeout(() => window.onTurnstileSuccess && window.onTurnstileSuccess('stub-' + (n++)), 20);
  window.turnstile = { reset() { window.__turnstileResets++; fire(); }, render() {}, remove() {} };
  fire();
})();`;

function fontCss() {
    const faces = [];
    for (const w of [400, 500, 600, 700]) {
        for (const subset of ['latin', 'latin-ext']) {
            const range = subset === 'latin'
                ? 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
                : 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
            faces.push(`@font-face{font-family:'Inter';font-style:normal;font-weight:${w};font-display:swap;src:url(https://fonts.gstatic.com/inter-${subset}-${w}-normal.woff2) format('woff2');unicode-range:${range};}`);
        }
    }
    return faces.join('\n');
}

export const fixtures = {
    provinces: [{ id: '34', name: 'İSTANBUL' }, { id: '6', name: 'ANKARA' }, { id: '35', name: 'İZMİR' }],
    districts: { 34: [{ id: '1421', name: 'KADIKÖY' }, { id: '1183', name: 'ŞİŞLİ' }], 6: [{ id: '1231', name: 'ÇANKAYA' }], 35: [{ id: '2006', name: 'KONAK' }] },
    neighborhoods: [{ id: '40001', name: 'CAFERAĞA MAH.' }, { id: '40002', name: 'MODA MAH.' }],
    streets: [{ id: '50001', name: 'MODA CAD.' }, { id: '50002', name: 'GÜNEŞLİBAHÇE SK.' }],
    buildings: [{ id: '60001', name: '12' }, { id: '60002', name: '14A' }],
    apartments: [{ id: '1234567890', name: 'İç Kapı 1' }, { id: '1234567891', name: 'İç Kapı 2' }],
    infra: {
        type: 'VDSL', portStatus: 'Var', maxSpeed: '50 Mbps', distance: '742 Metre', bbk: '1234567890',
        santralAdi: 'MODA', mudurlukAdi: 'KADIKÖY', kabinTipi: 'FTTC',
        address: { text: 'CAFERAĞA MAH. MODA CAD. NO: 12 İÇ KAPI: 1 KADIKÖY/İSTANBUL' },
    },
};

export const ok = (data, meta = {}) => ({ status: 200, body: { success: true, data, meta: { cached: false, source: 'primary', partial: false, missing: [], ...meta } } });
export const fail = (status, code, error, extra = {}) => ({ status, body: { success: false, error, code, requestId: 'req-12345678-abcd', ...extra } });

/** Default API behaviour; tests override `infra` / `address` / etc. via `api.on(action, fn)`. */
function defaultHandlers() {
    return {
        session: () => ({ status: 200, body: { success: true, token: 'session-token' } }),
        address: (p) => {
            const level = p.get('level');
            const id = p.get('id');
            const lists = {
                province: fixtures.provinces, district: fixtures.districts[id] || [], neighborhood: fixtures.neighborhoods,
                street: fixtures.streets, building: fixtures.buildings, apartment: fixtures.apartments,
            };
            return { status: 200, body: { success: true, data: lists[level], meta: { source: 'primary' } } };
        },
        infra: (p) => ok({ ...fixtures.infra, bbk: p.get('kapi') }),
        geocode: () => ok({ address: { province: 'İstanbul', town: 'Kadıköy', suburb: 'Caferağa', road: 'Moda Caddesi', house_number: '12' }, accurate: true }),
        ip_location: () => ({ status: 200, body: { success: true, lat: 40.99, lon: 29.02 } }),
    };
}

/** Serves Turnstile (stub), fonts, Leaflet and map tiles locally. */
export async function stubThirdParty(page) {
    await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }));
    await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: fontCss() }));
    await page.route('https://fonts.gstatic.com/**', (route) => {
        const name = new URL(route.request().url()).pathname.slice(1);
        route.fulfill({ contentType: 'font/woff2', body: readFileSync(`${NM}@fontsource/inter/files/${name}`) });
    });
    await page.route('https://unpkg.com/leaflet@1.9.4/dist/**', (route) => {
        const path = new URL(route.request().url()).pathname.replace('/leaflet@1.9.4/', '');
        const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'image/png';
        route.fulfill({ contentType: type, body: readFileSync(`${NM}leaflet/${path}`), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ contentType: 'image/png', body: readFileSync(`${NM}leaflet/dist/images/layers.png`) }));
}

export const test = base.extend({
    api: [async ({ page }, use) => {
        const handlers = defaultHandlers();
        const calls = [];
        await stubThirdParty(page);
        await page.route(`${API}/**`, async (route) => {
            const url = new URL(route.request().url());
            const action = url.searchParams.get('action');
            calls.push({ action, params: Object.fromEntries(url.searchParams), auth: route.request().headers().authorization });
            const handler = handlers[action];
            if (!handler) return route.fulfill({ status: 400, json: { success: false, error: 'bad', code: 'VALIDATION_ERROR' } });
            const res = await handler(url.searchParams, route);
            if (res === 'abort') return route.abort('connectionrefused');
            if (res === 'handled') return undefined;
            return route.fulfill({
                status: res.status,
                contentType: 'application/json',
                headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173', 'Access-Control-Expose-Headers': 'X-Request-Id', ...(res.headers || {}) },
                body: typeof res.body === 'string' ? res.body : JSON.stringify(res.body),
            });
        });
        await use({
            calls,
            on: (action, fn) => { handlers[action] = fn; },
            count: (action) => calls.filter((c) => c.action === action).length,
        });
    }, { auto: true }],
    consoleErrors: async ({ page }, use) => {
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));
        await use(errors);
    },
});

export { expect };

/** Drives the address cascade to the first apartment. */
export async function fillAddress(page) {
    const steps = [['#province', '34'], ['#district', '1421'], ['#neighborhood', '40002'], ['#street', '50001'], ['#building', '60001'], ['#apartment', '1234567890']];
    for (const [sel, value] of steps) {
        await expect(page.locator(`${sel} option[value="${value}"]`)).toBeAttached();
        await page.selectOption(sel, value);
    }
}

export async function queryBbk(page, bbk = '1234567890') {
    await page.getByRole('tab', { name: 'BBK ile' }).click();
    await page.fill('#bbkInput', bbk);
    await page.getByRole('button', { name: 'Sorgula' }).click();
}
