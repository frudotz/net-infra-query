import { test, expect, fixtures, queryBbk, ok } from './fixtures.js';
import { writeFileSync } from 'node:fs';

const OUT = 'tests/output';

/** Reads the PNG currently on the clipboard; returns { width, height, type, dataUrl }. */
async function readClipboardImage(page) {
    return page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items.find((i) => i.types.includes('image/png'));
        if (!item) return null;
        const blob = await item.getType('image/png');
        const bmp = await createImageBitmap(blob);
        const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        return { width: bmp.width, height: bmp.height, type: blob.type, size: blob.size, dataUrl };
    });
}

function save(name, dataUrl) {
    writeFileSync(`${OUT}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('one click copies a PNG share card to the clipboard', async ({ page }) => {
    await page.goto('/');
    await queryBbk(page);
    await page.getByRole('button', { name: 'Görseli Kopyala' }).click();
    await expect(page.locator('.toast')).toContainText('panoya kopyalandı');
    await expect(page.locator('#copyImageBtn .btn-label')).toHaveText('Kopyalandı');
    const img = await readClipboardImage(page);
    expect(img.type).toBe('image/png');
    expect(img.width).toBe(2000);
    expect(img.height).toBeGreaterThan(900);
    expect(img.height).toBeLessThan(2400);
    save('share-card.png', img.dataUrl);
});

test('card contains the site host and Turkish text renders (canvas text audit)', async ({ page }) => {
    await page.goto('/');
    await queryBbk(page);
    // Record every string drawn on any canvas during export.
    await page.evaluate(() => {
        window.__drawn = [];
        const orig = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) { window.__drawn.push(String(t)); return orig.call(this, t, ...rest); };
    });
    await page.getByRole('button', { name: 'Görseli Kopyala' }).click();
    await expect(page.locator('.toast')).toContainText('panoya kopyalandı');
    const drawn = await page.evaluate(() => window.__drawn);
    expect(drawn.filter((t) => t === 'altyapi.frudotz.com').length).toBeGreaterThanOrEqual(2);
    for (const s of ['1234567890', '50 Mbps', 'VDSL', 'Var', 'MODA', 'KADIKÖY', 'FTTC', '742 Metre', 'MAKSİMUM HIZ', 'BOŞ PORT']) {
        expect(drawn, s).toContain(s);
    }
    expect(drawn.join(' ')).toContain('CAFERAĞA');
    expect(await page.evaluate(() => document.fonts.check('600 20px Inter', 'ĞŞİ'))).toBe(true);
});

test('backup-source and partial results are reflected in the image', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
        window.__drawn = [];
        const orig = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) { window.__drawn.push(String(t)); return orig.call(this, t, ...rest); };
    });
    await page.route('https://niq.api.frudotz.com/?action=infra*', (route) => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' },
        body: JSON.stringify(ok({ ...fixtures.infra, santralAdi: 'Belirsiz', address: { text: 'Adres bulunamadı.' } }, { source: 'backup' }).body),
    }));
    await queryBbk(page);
    await expect(page.locator('#resSourceChip')).toBeVisible();
    await page.getByRole('button', { name: 'Görseli Kopyala' }).click();
    await expect(page.locator('.toast')).toContainText('panoya kopyalandı');
    const drawn = await page.evaluate(() => window.__drawn);
    expect(drawn).toContain('Yedek kaynak');
    expect(drawn).toContain('Kısmi sonuç');
    expect(drawn).toContain('Bilinmiyor');
    save('share-card-backup-partial.png', (await readClipboardImage(page)).dataUrl);
});

test('pathological input: huge unbroken strings are wrapped/ellipsized quickly', async ({ page, api }) => {
    const huge = 'Ğ'.repeat(20_000);
    api.on('infra', () => ok({ ...fixtures.infra, address: { text: `${huge} ${'kelime '.repeat(3000)}` }, santralAdi: huge, mudurlukAdi: 'x'.repeat(5000), kabinTipi: '<script>alert(1)</script>' }));
    await page.goto('/');
    await queryBbk(page);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Görseli Kopyala' }).click();
    await expect(page.locator('.toast')).toContainText('panoya kopyalandı');
    expect(Date.now() - t0).toBeLessThan(5000);
    const img = await readClipboardImage(page);
    expect(img.height).toBeLessThan(2400);
    save('share-card-long.png', img.dataUrl);
});

test('falls back to a PNG download when image clipboard is unsupported', async ({ page }) => {
    await page.addInitScript(() => { delete window.ClipboardItem; });
    await page.goto('/');
    await queryBbk(page, '555000111');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Görseli Kopyala' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('altyapi-555000111.png');
    await expect(page.locator('.toast')).toContainText('görsel indirildi');
});

test('falls back to download when the clipboard write is rejected', async ({ page }) => {
    await page.addInitScript(() => {
        navigator.clipboard.write = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await page.goto('/');
    await queryBbk(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Görseli Kopyala' }).click();
    await downloadPromise;
    await expect(page.locator('.toast')).toContainText('görsel indirildi');
});

test('copy text produces a readable summary', async ({ page }) => {
    await page.goto('/');
    await queryBbk(page);
    await page.getByRole('button', { name: 'Metni Kopyala' }).click();
    await expect(page.locator('.toast')).toContainText('metni panoya');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('altyapi.frudotz.com');
    expect(text).toContain('BBK: 1234567890');
    expect(text).toContain('Maksimum hız: 50 Mbps');
    expect(text).toContain('Adres: CAFERAĞA MAH.');
});
