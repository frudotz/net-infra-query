// Audit finding FE-001: an apartment option whose id cannot be a BBK (the
// value submitted as `kapi`) used to be sent anyway and came back as a 400
// with a misleading "Geçersiz giriş" title. The form now refuses such a
// selection with an inline Turkish message and never sends the request, and a
// backend 400 in address mode is presented as a problem with the selected
// record rather than with typed input.
import { test, expect, fixtures, fail } from './fixtures.js';

const VALID = fixtures.apartments[0].id; // '1234567890'

/** Serves `apartments` for the apartment level; other levels use the default fixtures. */
function withApartments(api, apartments) {
    api.on('address', (p) => {
        const level = p.get('level');
        const lists = {
            province: fixtures.provinces, district: fixtures.districts[p.get('id')] || [], neighborhood: fixtures.neighborhoods,
            street: fixtures.streets, building: fixtures.buildings, apartment: apartments,
        };
        return { status: 200, body: { success: true, data: lists[level], meta: { source: 'primary', scope: 'a1' } } };
    });
}

async function selectToBuilding(page) {
    for (const [sel, value] of [['#province', '34'], ['#district', '1421'], ['#neighborhood', '40002'], ['#street', '50001'], ['#building', '60001']]) {
        await expect(page.locator(`${sel} option[value="${value}"]`)).toBeAttached();
        await page.selectOption(sel, value);
    }
    await expect(page.locator('#apartment')).toBeEnabled();
}

const submit = (page) => page.getByRole('button', { name: 'Sorgula' }).click();

test('valid apartment: the request carries the apartment id as kapi and the province as il', async ({ page, api }) => {
    await page.goto('/');
    await selectToBuilding(page);
    await page.selectOption('#apartment', VALID);
    await submit(page);
    await expect(page.locator('#resultSuccess')).toBeVisible();
    await expect(page.locator('#resBbk')).toHaveText(VALID);
    const infra = api.calls.find((c) => c.action === 'infra');
    expect(infra.params).toEqual({ action: 'infra', kapi: VALID, il: '34' });
    await expect(page.locator('#apartment-msg')).toBeEmpty();
});

test('negative apartment id: inline Turkish message, no request; picking a valid sibling then works', async ({ page, api }) => {
    withApartments(api, [{ id: '-1234567', name: 'Ic Kapi No :2' }, { id: VALID, name: 'Ic Kapi No :1' }]);
    await page.goto('/');
    await selectToBuilding(page);
    await page.selectOption('#apartment', '-1234567');
    await submit(page);
    await expect(page.locator('#apartment-msg')).toHaveText('Bu daire kaydı sorgulanamıyor. Lütfen listeden başka bir daire seçin.');
    await expect(page.locator('#apartment-msg')).toHaveClass(/is-error/);
    await expect(page.locator('#apartment')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#apartment')).toBeFocused();
    await expect(page.locator('#resultEmpty')).toBeVisible();
    expect(api.count('infra')).toBe(0);
    // The form stays usable: the user can choose another apartment.
    await expect(page.locator('#apartment')).toBeEnabled();
    await page.selectOption('#apartment', VALID);
    await expect(page.locator('#apartment-msg')).toBeEmpty();
    await expect(page.locator('#apartment')).not.toHaveAttribute('aria-invalid', 'true');
    await submit(page);
    await expect(page.locator('#resBbk')).toHaveText(VALID);
    expect(api.calls.filter((c) => c.action === 'infra').map((c) => c.params.kapi)).toEqual([VALID]);
});

for (const [label, id] of [['null id', null], ['missing id', undefined], ['empty id', ''], ['non-numeric id', 'abc12'], ['hyphenated id', '12-34'], ['all-zero id', '0'], ['too long id', '1'.repeat(16)]]) {
    test(`${label}: no infrastructure request is sent`, async ({ page, api }) => {
        const row = id === undefined ? { name: 'Daire X' } : { id, name: 'Daire X' };
        withApartments(api, [row, { id: VALID, name: 'Daire 1' }]);
        await page.goto('/');
        await selectToBuilding(page);
        // Select by position: an empty-string id would collide with the placeholder option's value.
        await page.selectOption('#apartment', { index: 1 });
        await submit(page);
        await expect(page.locator('#apartment-msg')).toHaveClass(/is-error/);
        await expect(page.locator('#apartment-msg')).not.toBeEmpty();
        await expect(page.locator('#resultError')).toBeHidden();
        expect(api.count('infra')).toBe(0);
    });
}

test('labels with punctuation or a slash are not a reason to block a valid id', async ({ page, api }) => {
    withApartments(api, [{ id: '7000000001', name: 'Daire 1/2 (Zemin) - A Blok' }, { id: VALID, name: 'Daire :null' }]);
    await page.goto('/');
    await selectToBuilding(page);
    await page.selectOption('#apartment', '7000000001');
    await submit(page);
    await expect(page.locator('#resBbk')).toHaveText('7000000001');
    expect(api.count('infra')).toBe(1);
});

test('backend 400 in address mode is presented as a selected-record problem without a retry button', async ({ page, api }) => {
    api.on('infra', () => fail(400, 'VALIDATION_ERROR', 'BBK numarası yalnızca rakamlardan oluşmalı (en fazla 15 hane).'));
    await page.goto('/');
    await selectToBuilding(page);
    await page.selectOption('#apartment', VALID);
    await submit(page);
    await expect(page.locator('#resultError')).toBeVisible();
    await expect(page.locator('#errorTitle')).toHaveText('Seçilen daire sorgulanamadı');
    await expect(page.locator('#errorMessage')).toHaveText('Bu daire kaydı sorgulanamıyor. Lütfen listeden başka bir daire seçin.');
    await expect(page.locator('#errorRetryBtn')).toBeHidden();
    await expect(page.locator('#errorRef')).toContainText('req-1234');
    const text = await page.locator('#resultError').innerText();
    expect(text).not.toMatch(/adapter|addr_|upstream|ADDR_SOURCE/i);
    // The form is still usable for another selection.
    await expect(page.locator('#apartment')).toBeEnabled();
});

test('BBK tab: an all-zero number is rejected inline (same contract as the backend), leading zeros are not', async ({ page, api }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'BBK ile' }).click();
    for (const zeros of ['0', '0000000']) {
        await page.fill('#bbkInput', zeros);
        await submit(page);
        await expect(page.locator('#bbk-msg')).toHaveText('BBK numarası yalnızca sıfırlardan oluşamaz.');
        await expect(page.locator('#bbkInput')).toHaveAttribute('aria-invalid', 'true');
    }
    expect(api.count('infra')).toBe(0);
    await page.fill('#bbkInput', '0012');
    await submit(page);
    await expect(page.locator('#resBbk')).toHaveText('0012');
    expect(api.calls.find((c) => c.action === 'infra').params.kapi).toBe('0012');
});

test('backend 400 in BBK mode keeps the typed-input presentation', async ({ page, api }) => {
    api.on('infra', () => fail(400, 'VALIDATION_ERROR', 'BBK numarası yalnızca rakamlardan oluşmalı (en fazla 15 hane).'));
    await page.goto('/');
    await page.getByRole('tab', { name: 'BBK ile' }).click();
    await page.fill('#bbkInput', '123456');
    await submit(page);
    await expect(page.locator('#errorTitle')).toHaveText('Geçersiz giriş');
    await expect(page.locator('#errorMessage')).toContainText('rakamlardan');
});
