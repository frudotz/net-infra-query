// Captures every result state at desktop / tablet / mobile widths in both
// themes (written to tests/output for review) and asserts that no viewport
// scrolls horizontally.
import { test, expect, queryBbk, fixtures, ok, fail } from './fixtures.js';

const VIEWPORTS = { desktop: { width: 1280, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };
const OUT = 'tests/output/visual';

async function noOverflow(page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    for (const scheme of ['dark', 'light']) {
        test(`${name} ${scheme}: empty, loading, success, backup+partial, error`, async ({ page, api }) => {
            await page.setViewportSize(viewport);
            await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
            await page.goto('/');
            await expect(page.locator('#province option[value="34"]')).toBeAttached();
            await noOverflow(page);
            await page.screenshot({ path: `${OUT}/${name}-${scheme}-empty.png`, fullPage: true });

            let release;
            api.on('infra', async (p) => { await new Promise((r) => { release = r; }); return ok({ ...fixtures.infra, bbk: p.get('kapi') }); });
            await queryBbk(page);
            await expect(page.locator('#resultLoading')).toBeVisible();
            await page.locator('#resultsSection').screenshot({ path: `${OUT}/${name}-${scheme}-loading.png` });
            release();
            await expect(page.locator('#resultSuccess')).toBeVisible();
            await noOverflow(page);
            await page.screenshot({ path: `${OUT}/${name}-${scheme}-success.png`, fullPage: true });

            api.on('infra', () => ok({ ...fixtures.infra, type: 'Fiber', santralAdi: 'Belirsiz', address: { text: 'ÇOK UZUN BİR ADRES SATIRI GÜNEŞLİBAHÇE MAHALLESİ MODA CADDESİ NO: 128/4 İÇ KAPI: 12 KADIKÖY/İSTANBUL' } }, { source: 'backup' }));
            await page.getByRole('button', { name: 'Sorgula' }).click();
            await expect(page.locator('#resSourceChip')).toBeVisible();
            await noOverflow(page);
            await page.locator('#resultsSection').screenshot({ path: `${OUT}/${name}-${scheme}-backup.png` });

            api.on('infra', () => fail(503, 'UPSTREAM_UNAVAILABLE', 'Altyapı sağlayıcılarına şu an ulaşılamıyor. Birkaç dakika sonra tekrar deneyin.'));
            await page.getByRole('button', { name: 'Sorgula' }).click();
            await expect(page.locator('#resultError')).toBeVisible();
            await page.locator('#resultsSection').screenshot({ path: `${OUT}/${name}-${scheme}-error.png` });
        });
    }
}
