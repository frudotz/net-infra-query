import { test, expect } from './fixtures.js';

test.use({ serviceWorkers: 'allow' });

test('service worker activates, removes the legacy cache and serves fresh files (network-first)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => { (await caches.open('altyapi-cache-v1')).put('/legacy', new Response('old')); });
    await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.unregister();
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['altyapi-shell-v2']);
    await page.reload();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.locator('h1')).toHaveText('İnternet altyapısı sorgulama');
});
