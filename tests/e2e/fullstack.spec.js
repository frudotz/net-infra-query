// Full stack: real frontend → real worker (wrangler dev / workerd) → local
// mock upstream providers. Requires the niq-api repository checked out next
// to this one (../niq-api with `npm install` done); skipped otherwise.
import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stubThirdParty, API } from './fixtures.js';

const NIQ = fileURLToPath(new URL('../../../niq-api/', import.meta.url));
const available = existsSync(`${NIQ}node_modules/.bin/wrangler`);
const PORT = 8798;
const SECRET = 'fullstack-secret';

const test = base;
test.skip(!available, 'niq-api checkout with dependencies not found next to this repo');

let upstreams;
let wrangler;
let token;

test.beforeAll(async () => {
    test.setTimeout(120_000);
    const { startMockUpstreams } = await import(pathToFileURL(`${NIQ}test/e2e/mock-upstreams.js`).href);
    const { signToken } = await import(pathToFileURL(`${NIQ}src/auth.js`).href);
    upstreams = await startMockUpstreams();
    rmSync(`${NIQ}.wrangler/fullstack-state`, { recursive: true, force: true });
    const vars = {
        DEV_ALLOW_HTTP_UPSTREAMS: 'true', JWT_SECRET: SECRET, TURNSTILE_SECRET: 'unused',
        INFRA_SOURCE_1: `${upstreams.base}/netgsm`, INFRA_SOURCE_2: `${upstreams.base}/yeninet`,
        INFRA_SOURCE_3: `${upstreams.base}/veganet`, INFRA_SOURCE: `${upstreams.base}/legacy/TT_Altyapi.php`,
        ADDR_SOURCE_1: `${upstreams.base}/dsmart/adres`, // removed provider: must be skipped
        ADDRESS_SOURCE: `${upstreams.base}/legacy/TT_`,
    };
    const args = ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', '.wrangler/fullstack-state', '--show-interactive-dev-session=false'];
    for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
    wrangler = spawn('npx', args, { cwd: NIQ, env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true });
    for (let i = 0; i < 120; i++) {
        try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    token = await signToken({ ip: '127.0.0.1', exp: Date.now() + 3_600_000 }, SECRET);
});

test.afterAll(async () => {
    if (wrangler) { try { process.kill(-wrangler.pid, 'SIGTERM'); } catch { /* gone */ } }
    await upstreams?.close();
});

test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubThirdParty(page);
    // Real Turnstile verification needs Cloudflare; start with a session the worker itself signed.
    await page.addInitScript((t) => sessionStorage.setItem('api_token', t), token);
    // Forward API calls to the local worker as if they came from the production origin.
    await page.route(`${API}/**`, async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
            url: `http://127.0.0.1:${PORT}${url.pathname}${url.search}`,
            headers: { ...route.request().headers(), origin: 'https://altyapi.frudotz.com' },
        });
        const headers = { ...response.headers(), 'access-control-allow-origin': 'http://127.0.0.1:4173' };
        await route.fulfill({ response, headers });
    });
});

let bbk = 7000;

test('primary provider serves the result', async ({ page }) => {
    await upstreams.setModes({});
    await page.goto('/');
    await expect(page.locator('#province option[value="34"]')).toBeAttached();
    // Real names, never the removed provider's "Il" placeholders.
    await expect(page.locator('#province option')).toHaveText(['İl seçin', 'ANKARA', 'İSTANBUL']);
    expect(await upstreams.hits()).not.toContain('dsmart');
    await page.getByRole('tab', { name: 'BBK ile' }).click();
    await page.fill('#bbkInput', String(++bbk));
    await page.getByRole('button', { name: 'Sorgula' }).click();
    await expect(page.locator('#resultSuccess')).toBeVisible();
    await expect(page.locator('#resSantral')).toHaveText('ÇANKAYA');
    await expect(page.locator('#resAddress')).toHaveText('KIZILAY MAH. ATATÜRK BLV. NO: 5 ÇANKAYA/ANKARA');
    await expect(page.locator('#resSourceChip')).toBeHidden();
});

test('primary down → backup result rendered and exported identically', async ({ page }) => {
    await upstreams.setModes({ netgsm: 'down', yeninet: 'html' });
    await page.goto('/');
    await page.getByRole('tab', { name: 'BBK ile' }).click();
    await page.fill('#bbkInput', String(++bbk));
    await page.getByRole('button', { name: 'Sorgula' }).click();
    await expect(page.locator('#resultSuccess')).toBeVisible();
    await expect(page.locator('#resType')).toHaveText('Fiber');
    await expect(page.locator('#resSourceChip')).toHaveText('Yedek kaynak');
    await expect(page.locator('#resAddress')).toContainText('CAFERAĞA');
    await page.evaluate(() => {
        window.__drawn = [];
        const orig = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { window.__drawn.push(String(t)); return orig.call(this, t, ...r); };
    });
    await page.getByRole('button', { name: 'Görseli Kopyala' }).click();
    await expect(page.locator('.toast')).toContainText('panoya kopyalandı');
    const drawn = await page.evaluate(() => window.__drawn);
    expect(drawn).toContain('Yedek kaynak');
    expect(drawn).toContain('altyapi.frudotz.com');
    expect(drawn).toContain('1000 Mbps');
});

test('total outage → controlled error with retry', async ({ page }) => {
    await upstreams.setModes({ netgsm: 'down', yeninet: 'down', veganet: 'down', legacy: 'down' });
    await page.goto('/');
    await page.getByRole('tab', { name: 'BBK ile' }).click();
    await page.fill('#bbkInput', String(++bbk));
    await page.getByRole('button', { name: 'Sorgula' }).click();
    await expect(page.locator('#errorTitle')).toHaveText('Altyapı kaynaklarına ulaşılamıyor');
    await expect(page.locator('#errorRetryBtn')).toBeVisible();
    await expect(page.locator('#errorRef')).toContainText('Destek için referans');
    // Providers recover → retry succeeds.
    await upstreams.setModes({});
    await page.getByRole('button', { name: 'Tekrar dene' }).click();
    await expect(page.locator('#resultSuccess')).toBeVisible();
});

test('invalid BBK rejected by the real backend surfaces its message', async ({ page }) => {
    await page.goto('/');
    const res = await page.evaluate(async ([api, t]) => {
        const r = await fetch(`${api}/?action=infra&kapi=12x&il=6`, { headers: { Authorization: `Bearer ${t}` } });
        return { status: r.status, body: await r.json() };
    }, [API, token]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
});
