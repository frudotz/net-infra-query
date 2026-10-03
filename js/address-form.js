// The six-level address cascade (il → … → daire). Each level tracks a request
// sequence number so a slow, stale response can never overwrite a newer
// selection, and each field shows its own loading / error / retry state.

import { fetchAddressList } from './api.js';
import { $ } from './ui.js';

export const LEVELS = [
    { key: 'province', placeholder: 'İl seçin', waiting: 'Yükleniyor…' },
    { key: 'district', placeholder: 'İlçe seçin', waiting: 'Önce il seçin' },
    { key: 'neighborhood', placeholder: 'Mahalle seçin', waiting: 'Önce ilçe seçin' },
    { key: 'street', placeholder: 'Cadde / sokak seçin', waiting: 'Önce mahalle seçin' },
    { key: 'building', placeholder: 'Bina seçin', waiting: 'Önce sokak seçin' },
    { key: 'apartment', placeholder: 'Daire seçin', waiting: 'Önce bina seçin' },
];

function setOptions(select, placeholder, list = []) {
    const frag = document.createDocumentFragment();
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    frag.appendChild(first);
    for (const item of list) {
        const o = document.createElement('option');
        o.value = item.id;
        o.textContent = item.name;
        frag.appendChild(o);
    }
    select.replaceChildren(frag);
}

export function createAddressForm() {
    const levels = LEVELS.map((def) => ({
        ...def,
        select: $(def.key),
        msg: $(`${def.key}-msg`),
        seq: 0,
        controller: null,
        parentId: null,
        list: [],
    }));

    function setMessage(level, text, { error = false, retry = null } = {}) {
        level.msg.replaceChildren();
        level.msg.classList.toggle('is-error', error);
        level.select.toggleAttribute('aria-invalid', false);
        if (!text) return;
        level.msg.append(text);
        if (retry) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'link-btn';
            btn.textContent = 'Tekrar dene';
            btn.addEventListener('click', retry);
            level.msg.append(' ', btn);
        }
    }

    function resetFrom(index) {
        for (let i = index; i < levels.length; i++) {
            const level = levels[i];
            level.seq += 1;
            level.controller?.abort();
            level.controller = null;
            level.list = [];
            level.parentId = null;
            setOptions(level.select, level.waiting);
            level.select.disabled = true;
            setMessage(level, '');
        }
    }

    /** Loads the list for `index` under `parentId`. Resolves to the list, or null if superseded. */
    async function load(index, parentId = null) {
        const level = levels[index];
        resetFrom(index);
        const seq = level.seq;
        level.parentId = parentId;
        level.controller = new AbortController();
        setOptions(level.select, 'Yükleniyor…');
        level.select.setAttribute('aria-busy', 'true');
        try {
            const list = await fetchAddressList(level.key, parentId, { signal: level.controller.signal });
            if (seq !== level.seq) return null;
            level.list = list;
            setOptions(level.select, level.placeholder, list);
            level.select.disabled = false;
            if (list.length === 0) setMessage(level, 'Bu seçim için kayıt bulunamadı.');
            return list;
        } catch (err) {
            if (seq !== level.seq || err?.name === 'AbortError') return null;
            setOptions(level.select, 'Yüklenemedi');
            setMessage(level, err?.message || 'Liste yüklenemedi.', { error: true, retry: () => load(index, parentId).catch(() => {}) });
            throw err;
        } finally {
            if (seq === level.seq) level.select.removeAttribute('aria-busy');
        }
    }

    levels.forEach((level, index) => {
        level.select.addEventListener('change', () => {
            setMessage(level, '');
            if (index + 1 >= levels.length) return;
            const value = level.select.value;
            if (value) load(index + 1, value).catch(() => {});
            else resetFrom(index + 1);
        });
    });

    return {
        levels,
        load,
        resetFrom,
        /** Programmatic selection (used by the map). Returns false if the id is not in the list. */
        setValue(index, id) {
            const level = levels[index];
            if (!level.list.some((x) => x.id === id)) return false;
            level.select.value = id;
            return true;
        },
        value: (key) => levels.find((l) => l.key === key)?.select.value || '',
        selectedName(key) {
            const sel = levels.find((l) => l.key === key)?.select;
            return sel && sel.value ? sel.options[sel.selectedIndex]?.textContent || '' : '';
        },
        /** First level without a selection, marked invalid; null when complete. */
        firstIncomplete() {
            const level = levels.find((l) => !l.select.value);
            if (!level) return null;
            if (!level.select.disabled) {
                setMessage(level, `${level.placeholder.replace(/ seçin$/, '')} seçimi gerekli.`, { error: true });
                level.select.setAttribute('aria-invalid', 'true');
            }
            return level;
        },
    };
}
