import { test, expect, fixtures, fillAddress, queryBbk, ok, fail } from './fixtures.js';

const OUT = 'tests/output';

test.describe('query flow', () => {
    test('address cascade → successful result', async ({ page, api, consoleErrors }) => {
        await page.goto('/');
        await fillAddress(page);
        await page.getByRole('button', { name: 'Sorgula' }).click();

        const result = page.locator('#resultSuccess');
        await expect(result).toBeVisible();
        await expect(page.locator('#resSpeed')).toHaveText('50 Mbps');
        await expect(page.locator('#resType')).toHaveText('VDSL');
        await expect(page.locator('#resPort')).toHaveText('Var');
        await expect(page.locator('#resPort')).toHaveClass(/port-yes/);
        await expect(page.locator('#resDistance')).toHaveText('742 Metre');
        await expect(page.locator('#resAddress')).toHaveText(fixtures.infra.address.text);
        await expect(page.locator('#resBbk')).toHaveText('1234567890');
        await expect(page.locator('#resStatusChip')).toHaveText('Başarılı');
        await expect(page.locator('#resSourceChip')).toBeHidden();
        await expect(page.locator('#resNotice')).toBeHidden();

        const infraCall = api.calls.find((c) => c.action === 'infra');
        expect(infraCall.params).toEqual({ action: 'infra', kapi: '1234567890', il: '34' });
        expect(infraCall.auth).toBe('Bearer session-token');
        expect(api.count('session')).toBe(1);
        // Turnstile must not be re-run after a query (old bug reset the province list).
        expect(await page.evaluate(() => window.__turnstileResets)).toBe(0);
        await expect(page.locator('#province')).toHaveValue('34');
        expect(consoleErrors).toEqual([]);
        await page.screenshot({ path: `${OUT}/desktop-success.png`, fullPage: true });
    });

    test('changing a parent level clears dependent levels; stale responses are ignored', async ({ page, api }) => {
        let releaseSlow;
        api.on('address', async (p) => {
            const level = p.get('level');
            if (level === 'province') return { status: 200, body: { success: true, data: fixtures.provinces } };
            if (level === 'district' && p.get('id') === '34') {
                await new Promise((r) => { releaseSlow = r; });
                return { status: 200, body: { success: true, data: fixtures.districts[34] } };
            }
            return { status: 200, body: { success: true, data: fixtures.districts[p.get('id')] || fixtures.neighborhoods } };
        });
        await page.goto('/');
        await expect(page.locator('#province option[value="34"]')).toBeAttached();
        await page.selectOption('#province', '34'); // slow
        await page.selectOption('#province', '6'); // fast
        await expect(page.locator('#district option[value="1231"]')).toBeAttached();
        releaseSlow();
        await page.waitForTimeout(200);
        await expect(page.locator('#district option')).toHaveText(['İlçe seçin', 'ÇANKAYA']);
        await expect(page.locator('#neighborhood')).toBeDisabled();
    });

    test('address list failure shows inline error with working retry', async ({ page, api }) => {
        let failNext = true;
        const base = api;
        api.on('address', (p) => {
            if (p.get('level') === 'district' && failNext) {
                failNext = false;
                return fail(503, 'UPSTREAM_UNAVAILABLE', 'Adres servisine şu an ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.');
            }
            const level = p.get('level');
            return { status: 200, body: { success: true, data: level === 'province' ? fixtures.provinces : fixtures.districts[34] } };
        });
        await page.goto('/');
        await expect(page.locator('#province option[value="34"]')).toBeAttached();
        await page.selectOption('#province', '34');
        await expect(page.locator('#district-msg')).toContainText('Adres servisine şu an ulaşılamıyor');
        await expect(page.locator('#district-msg')).toHaveClass(/is-error/);
        await page.locator('#district-msg').getByRole('button', { name: 'Tekrar dene' }).click();
        await expect(page.locator('#district option[value="1421"]')).toBeAttached();
        await expect(page.locator('#district-msg')).toBeEmpty();
        expect(base.count('address')).toBeGreaterThanOrEqual(3);
    });

    test('submitting an incomplete address focuses the first missing field', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#province option[value="34"]')).toBeAttached();
        await page.getByRole('button', { name: 'Sorgula' }).click();
        await expect(page.locator('#province')).toBeFocused();
        await expect(page.locator('#province')).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#province-msg')).toHaveText('İl seçimi gerekli.');
    });

    test('BBK validation: digits only, inline errors, no request on invalid input', async ({ page, api }) => {
        await page.goto('/');
        await page.getByRole('tab', { name: 'BBK ile' }).click();
        await page.getByRole('button', { name: 'Sorgula' }).click();
        await expect(page.locator('#bbk-msg')).toHaveText('BBK numarası girin.');
        await expect(page.locator('#bbkInput')).toHaveAttribute('aria-invalid', 'true');
        await page.fill('#bbkInput', '12a34 5');
        await expect(page.locator('#bbkInput')).toHaveValue('12345');
        await expect(page.locator('#bbk-msg')).toBeEmpty();
        await page.fill('#bbkInput', '1'.repeat(16));
        await page.getByRole('button', { name: 'Sorgula' }).click();
        await expect(page.locator('#bbk-msg')).toContainText('en fazla 15 hane');
        expect(api.count('infra')).toBe(0);
        await page.fill('#bbkInput', '987654321');
        await page.getByRole('button', { name: 'Sorgula' }).click();
        await expect(page.locator('#resBbk')).toHaveText('987654321');
        expect(api.calls.find((c) => c.action === 'infra').params.il).toBe('7');
    });
});

test.describe('result states', () => {
    test('fallback (backup source) result is labelled without exposing internals', async ({ page, api }) => {
        api.on('infra', (p) => ok({ ...fixtures.infra, bbk: p.get('kapi') }, { source: 'backup' }));
        await page.goto('/');
        await queryBbk(page);
        await expect(page.locator('#resSourceChip')).toHaveText('Yedek kaynak');
        await expect(page.locator('#resStatusChip')).toHaveText('Başarılı');
        await expect(page.locator('#resNotice')).toHaveText(/yedek kaynaktan alındı/);
        const text = await page.locator('#resultSuccess').innerText();
        expect(text).not.toMatch(/adapter|netgsm|yeninet|veganet|infra_/i);
    });

    test('partial result: placeholders become "Bilinmiyor", chip and notice explain', async ({ page, api }) => {
        api.on('infra', () => ok({ type: 'ADSL', portStatus: 'Yok', maxSpeed: '16 Mbps', distance: 'Belirsiz', bbk: '42', santralAdi: 'Belirsiz', mudurlukAdi: '-', kabinTipi: null, address: { text: 'Adres bulunamadı.' } }, { partial: true }));
        await page.goto('/');
        await queryBbk(page, '42');
        await expect(page.locator('#resStatusChip')).toHaveText('Kısmi sonuç');
        await expect(page.locator('#resStatusChip')).toHaveClass(/chip-warn/);
        for (const id of ['#resAddress', '#resSantral', '#resMudurluk', '#resKabin', '#resDistance']) {
            await expect(page.locator(id)).toHaveText('Bilinmiyor');
            await expect(page.locator(id)).toHaveClass(/is-missing/);
        }
        await expect(page.locator('#resPort')).toHaveClass(/port-no/);
        await expect(page.locator('#resNotice')).toContainText('Adres, Santral, Santral mesafesi, Müdürlük, FTTX tipi');
    });

    test('fiber: 1000 Mbps rule kept and distance hidden', async ({ page, api }) => {
        api.on('infra', () => ok({ ...fixtures.infra, type: 'Fiber', maxSpeed: '1 Gbps', distance: '0 Metre', kabinTipi: 'FTTH' }));
        await page.goto('/');
        await queryBbk(page);
        await expect(page.locator('#resType')).toHaveText('Fiber');
        await expect(page.locator('#resSpeed')).toHaveText('1000 Mbps');
        await expect(page.locator('#resDistanceRow')).toBeHidden();
    });

    test('upstream outage → explanatory error, retry succeeds', async ({ page, api }) => {
        let first = true;
        api.on('infra', (p) => {
            if (first) { first = false; return fail(503, 'UPSTREAM_UNAVAILABLE', 'Altyapı sağlayıcılarına şu an ulaşılamıyor. Birkaç dakika sonra tekrar deneyin.'); }
            return ok({ ...fixtures.infra, bbk: p.get('kapi') });
        });
        await page.goto('/');
        await queryBbk(page);
        const error = page.locator('#resultError');
        await expect(error).toBeVisible();
        await expect(error).toHaveAttribute('role', 'alert');
        await expect(page.locator('#errorTitle')).toHaveText('Altyapı kaynaklarına ulaşılamıyor');
        await expect(page.locator('#errorRef')).toHaveText('Destek için referans: req-1234');
        await page.screenshot({ path: `${OUT}/desktop-error.png` });
        await page.getByRole('button', { name: 'Tekrar dene' }).click();
        await expect(page.locator('#resultSuccess')).toBeVisible();
    });

    test('no data / daily limit / network failure / non-JSON have distinct states', async ({ page, api }) => {
        await page.goto('/');
        const cases = [
            [() => fail(404, 'NO_DATA', 'Bu BBK için altyapı bilgisi bulunamadı. Numarayı kontrol edip tekrar deneyin.'), 'Kayıt bulunamadı', false],
            [() => fail(429, 'DAILY_LIMIT', 'Günlük altyapı sorgu limitine (20) ulaştınız.', { isRateLimited: true }), 'Günlük sorgu hakkı doldu', false],
            [() => 'abort', 'Bağlantı hatası', true],
            [() => ({ status: 502, body: '<html>Bad gateway</html>' }), 'Sorgu tamamlanamadı', true],
        ];
        await page.getByRole('tab', { name: 'BBK ile' }).click();
        for (const [handler, title, retry] of cases) {
            api.on('infra', handler);
            await page.fill('#bbkInput', '1234567890');
            await page.getByRole('button', { name: 'Sorgula' }).click();
            await expect(page.locator('#errorTitle')).toHaveText(title);
            await expect(page.locator('#errorRetryBtn')).toBeVisible({ visible: retry });
            await expect(page.locator('#errorMessage')).not.toBeEmpty();
        }
    });

    test('expired session (401) is renewed transparently via Turnstile', async ({ page, api }) => {
        let n = 0;
        api.on('session', () => ({ status: 200, body: { success: true, token: `session-${++n}` } }));
        api.on('infra', (p, route) => {
            const auth = route.request().headers().authorization;
            if (auth === 'Bearer session-1') return fail(401, 'UNAUTHORIZED', 'Oturum yetkisiz.');
            return ok({ ...fixtures.infra, bbk: p.get('kapi') });
        });
        await page.goto('/');
        await queryBbk(page);
        await expect(page.locator('#resultSuccess')).toBeVisible();
        expect(await page.evaluate(() => window.__turnstileResets)).toBe(1);
        expect(api.calls.filter((c) => c.action === 'infra').map((c) => c.auth)).toEqual(['Bearer session-1', 'Bearer session-2']);
    });

    test('untrusted strings are rendered as text (no HTML/script injection)', async ({ page, api }) => {
        let dialog = false;
        page.on('dialog', (d) => { dialog = true; d.dismiss(); });
        const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
        api.on('infra', () => ok({ ...fixtures.infra, santralAdi: evil, address: { text: evil } }));
        await page.goto('/');
        await queryBbk(page);
        await expect(page.locator('#resSantral')).toHaveText(evil);
        await expect(page.locator('#resultSuccess img')).toHaveCount(0);
        api.on('infra', () => fail(500, 'INTERNAL_ERROR', evil));
        await page.getByRole('button', { name: 'Sorgula' }).click();
        await expect(page.locator('#errorMessage')).toHaveText(evil);
        await expect(page.locator('#resultError img')).toHaveCount(0);
        expect(dialog).toBe(false);
    });

    test('loading state is shown and the submit button is busy', async ({ page, api }) => {
        let release;
        api.on('infra', async (p) => { await new Promise((r) => { release = r; }); return ok({ ...fixtures.infra, bbk: p.get('kapi') }); });
        await page.goto('/');
        await queryBbk(page);
        await expect(page.locator('#resultLoading')).toBeVisible();
        await expect(page.locator('#loadingText')).toHaveText('BBK 1234567890 sorgulanıyor…');
        await expect(page.locator('#submitBtn')).toBeDisabled();
        await expect(page.locator('#submitBtn')).toHaveAttribute('aria-busy', 'true');
        await page.getByRole('button', { name: /Sorgula/ }).click({ force: true }).catch(() => {});
        release();
        await expect(page.locator('#resultSuccess')).toBeVisible();
        expect(api.count('infra')).toBe(1);
    });
});

test.describe('last query', () => {
    test('persists across reloads, reopens without a request, refresh limited to once a day', async ({ page, api }) => {
        await page.goto('/');
        await queryBbk(page);
        await expect(page.locator('#resultSuccess')).toBeVisible();
        await page.reload();
        await expect(page.locator('#lastQuerySection')).toBeVisible();
        await expect(page.locator('#lastQueryAddressText')).toHaveText(fixtures.infra.address.text);
        const before = api.count('infra');
        await page.locator('#lastQueryCard').click();
        await expect(page.locator('#resSpeed')).toHaveText('50 Mbps');
        expect(api.count('infra')).toBe(before);
        await page.getByRole('button', { name: 'Güncelle' }).click();
        await expect(page.locator('#refreshLastQueryBtn')).toBeDisabled();
        expect(api.count('infra')).toBe(before + 1);
    });

    test('old localStorage schema still renders', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('lastQuery', JSON.stringify({
            date: '2025-01-01', bbk: '555', il: '34',
            data: { exchange: { name: 'VDSL', distanceM: 900 }, port: { status: 'available', speedLabel: '24 Mbps' }, address: { text: 'ESKİ ADRES' } },
        })));
        await page.goto('/');
        await page.locator('#lastQueryCard').click();
        await expect(page.locator('#resType')).toHaveText('VDSL');
        await expect(page.locator('#resSpeed')).toHaveText('24 Mbps');
        await expect(page.locator('#resPort')).toHaveText('Var');
        await expect(page.locator('#resDistance')).toHaveText('900 Metre');
    });
});

test.describe('accessibility and layout', () => {
    test('tabs follow the ARIA tabs pattern with arrow keys', async ({ page }) => {
        await page.goto('/');
        await page.locator('#tabAddressBtn').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tabBbkBtn')).toBeFocused();
        await expect(page.locator('#tabBbkBtn')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#panelBbk')).toBeVisible();
        await expect(page.locator('#panelAddress')).toBeHidden();
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#panelAddress')).toBeVisible();
    });

    test('keyboard-only BBK query with visible focus', async ({ page }) => {
        await page.goto('/');
        await page.locator('#tabBbkBtn').focus();
        await page.keyboard.press('Enter');
        await page.locator('#bbkInput').focus();
        const outline = await page.locator('#bbkInput').evaluate((el) => getComputedStyle(el).outlineStyle);
        expect(outline).toBe('solid');
        await page.keyboard.type('1234567890');
        await page.keyboard.press('Enter');
        await expect(page.locator('#resultSuccess')).toBeVisible();
        await expect(page.locator('#srStatus')).toHaveText(/Sonuç hazır/);
    });

    test('theme toggle persists and both themes render', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/');
        await expect(page.locator('html')).toHaveClass(/dark/);
        await page.locator('#themeToggle').click();
        await expect(page.locator('html')).toHaveClass(/light/);
        await page.reload();
        await expect(page.locator('html')).toHaveClass(/light/);
        await queryBbk(page);
        await expect(page.locator('#resultSuccess')).toBeVisible();
        await page.screenshot({ path: `${OUT}/desktop-light.png`, fullPage: true });
    });

    test('@mobile no horizontal overflow with long Turkish values', async ({ page, api }) => {
        const long = 'ÇOK UZUN MAHALLE ADI GÜNEŞLİBAHÇE ŞİŞLİ İSTANBUL '.repeat(8) + 'X'.repeat(120);
        api.on('infra', () => ok({ ...fixtures.infra, address: { text: long }, santralAdi: 'Ş'.repeat(90), mudurlukAdi: 'İĞÜŞÖÇ ığüşöç müdürlüğü' }));
        await page.goto('/');
        await queryBbk(page);
        await expect(page.locator('#resultSuccess')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `${OUT}/mobile-result.png`, fullPage: true });
    });

    test('@mobile initial screen fits without overflow', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#province option[value="34"]')).toBeAttached();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `${OUT}/mobile-initial.png`, fullPage: true });
    });
});

test.describe('map picker', () => {
    test('lazy-loads Leaflet with SRI and fills the cascade from a reverse-geocoded location', async ({ page, api, context, consoleErrors }) => {
        await context.grantPermissions(['geolocation']);
        await context.setGeolocation({ latitude: 40.9876, longitude: 29.0254 });
        await page.goto('/');
        expect(await page.evaluate(() => typeof window.L)).toBe('undefined');
        await page.getByRole('button', { name: 'Haritadan seç' }).click();
        await expect(page.locator('#map .leaflet-marker-icon')).toBeVisible();
        await expect(page.locator('#apartment')).toHaveValue('1234567890', { timeout: 10_000 });
        await expect(page.locator('#province')).toHaveValue('34');
        await expect(page.locator('#district')).toHaveValue('1421');
        await expect(page.locator('#street')).toHaveValue('50001');
        await expect(page.locator('#mapScoreText')).toHaveText(/%\d+/);
        expect(api.calls.find((c) => c.action === 'geocode').params.lat).toBe('40.987600');
        expect(consoleErrors.filter((e) => !/tile/i.test(e))).toEqual([]);
    });
});
