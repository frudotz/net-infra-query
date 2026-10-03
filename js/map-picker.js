// Optional "pick on map" flow. Leaflet (~150 KB) is loaded lazily on first
// use, with SRI. Reverse-geocoded names are fuzzy-matched level by level into
// the address cascade.

import { fetchGeocode, fetchIpLocation } from './api.js';
import { findBestMatch } from './address-match.js';
import { $, showToast } from './ui.js';

const LEAFLET = {
    css: { href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=' },
    js: { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=' },
};
const TURKEY_BOUNDS = [[35.8, 25.6], [42.1, 44.8]];
const DEFAULT_VIEW = [39.92077, 32.85411];

let leafletPromise = null;
function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        Object.assign(link, { rel: 'stylesheet', href: LEAFLET.css.href, integrity: LEAFLET.css.integrity, crossOrigin: '' });
        document.head.appendChild(link);
        const script = document.createElement('script');
        Object.assign(script, { src: LEAFLET.js.src, integrity: LEAFLET.js.integrity, crossOrigin: '', async: true });
        script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet yüklenemedi')));
        script.onerror = () => reject(new Error('Harita kütüphanesi yüklenemedi'));
        document.head.appendChild(script);
    }).catch((err) => {
        leafletPromise = null;
        throw err;
    });
    return leafletPromise;
}

export function createMapPicker(addressForm) {
    const toggleBtn = $('mapToggleBtn');
    const wrapper = $('mapWrapper');
    const scoreEl = $('mapScoreText');
    const locateBtn = $('geoLocateBtn');
    let map = null;
    let marker = null;
    let geocodeRun = 0;
    let debounce = null;
    let lastGeocodeAt = 0;

    function setScore(text, tone) {
        scoreEl.textContent = text;
        scoreEl.classList.toggle('is-good', tone === 'good');
        scoreEl.classList.toggle('is-weak', tone === 'weak');
    }

    async function matchLevel(index, parentId, name, { strict = false, threshold = 40, run }) {
        if (!name) return null;
        const list = await addressForm.load(index, parentId);
        if (run !== geocodeRun || !list) return null;
        const res = findBestMatch(name, list, strict);
        if (!res.match || res.score <= threshold) return null;
        addressForm.setValue(index, res.match.id);
        return res;
    }

    async function geocode(lat, lon) {
        const run = ++geocodeRun;
        setScore('aranıyor…');
        try {
            const body = await fetchGeocode(lat, lon);
            if (run !== geocodeRun) return;
            const a = body.data?.address || {};
            const names = [
                a.province || a.state || a.city,
                a.town || a.county || a.district || a.suburb || a.city_district,
                a.neighbourhood || a.suburb || a.quarter,
                a.road,
            ];
            if (!names[0]) {
                setScore('adres bulunamadı', 'weak');
                return;
            }

            const scores = [];
            let parentId = null;
            const plan = [
                { name: names[0], threshold: 40 },
                { name: names[1], threshold: 40 },
                { name: names[2], threshold: 40 },
                { name: names[3], threshold: 50, strict: true },
            ];
            for (let i = 0; i < plan.length; i++) {
                const res = await matchLevel(i, parentId, plan[i].name, { ...plan[i], run });
                if (run !== geocodeRun) return;
                if (!res) break;
                scores.push(res.score);
                parentId = res.match.id;
            }

            // Street matched: load buildings, try the house number, then pick the first flat.
            if (scores.length === 4) {
                const buildings = await addressForm.load(4, parentId);
                if (run !== geocodeRun) return;
                if (buildings && a.house_number) {
                    const b = findBestMatch(a.house_number, buildings, true, { buildingNo: true });
                    if (b.match && b.score > 70) {
                        addressForm.setValue(4, b.match.id);
                        const flats = await addressForm.load(5, b.match.id);
                        if (run !== geocodeRun) return;
                        if (flats?.length) {
                            addressForm.setValue(5, flats[0].id);
                            showToast('Bina bulundu. Genel altyapıyı görebilmeniz için ilk daire seçildi; gerekirse değiştirin.', 'success');
                        }
                    }
                }
            }

            const score = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
            setScore(`%${score}`, score < 60 ? 'weak' : 'good');
        } catch (err) {
            if (run !== geocodeRun) return;
            setScore('—', 'weak');
            showToast(err?.message || 'Konumdan adres alınamadı.', err?.isRateLimited ? 'warning' : 'error');
        }
    }

    function moveTo(lat, lon, zoom) {
        map.setView([lat, lon], zoom);
        marker.setLatLng([lat, lon]);
        geocode(lat, lon);
    }

    function locate({ silentFallback }) {
        if (!navigator.geolocation) return;
        setScore('konum alınıyor…');
        navigator.geolocation.getCurrentPosition(
            (pos) => moveTo(pos.coords.latitude, pos.coords.longitude, 17),
            async () => {
                if (!silentFallback) {
                    setScore('—');
                    showToast('Konum izni verilmedi. Tarayıcı ayarlarından izin verebilir ya da iğneyi elle taşıyabilirsiniz.', 'warning');
                    return;
                }
                try {
                    const ip = await fetchIpLocation();
                    if (ip.success && Number.isFinite(ip.lat) && Number.isFinite(ip.lon)) {
                        showToast('Konum izni verilmedi; yaklaşık konum IP adresinden tahmin edildi.', 'warning');
                        moveTo(ip.lat, ip.lon, 12);
                    } else setScore('—');
                } catch {
                    setScore('—');
                }
            },
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
    }

    async function init() {
        const L = await loadLeaflet();
        map = L.map('map', { maxBounds: TURKEY_BOUNDS, maxBoundsViscosity: 1.0, minZoom: 5 }).setView(DEFAULT_VIEW, 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
        marker = L.marker(DEFAULT_VIEW, { draggable: true, keyboard: true, title: 'Konum iğnesi' }).addTo(map);
        marker.on('dragend', (e) => {
            const { lat, lng } = e.target.getLatLng();
            if (Date.now() - lastGeocodeAt < 1000) {
                showToast('Lütfen biraz yavaşlayın; konum sorguları sınırlıdır.', 'warning');
                return;
            }
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                lastGeocodeAt = Date.now();
                geocode(lat, lng);
            }, 500);
        });
        locate({ silentFallback: true });
    }

    toggleBtn.addEventListener('click', async () => {
        const open = wrapper.hidden;
        wrapper.hidden = !open;
        toggleBtn.setAttribute('aria-expanded', String(open));
        toggleBtn.querySelector('span').textContent = open ? 'Haritayı gizle' : 'Haritadan seç';
        if (!open) return;
        try {
            if (!map) await init();
            setTimeout(() => map?.invalidateSize(), 100);
        } catch (err) {
            showToast(err.message || 'Harita yüklenemedi.', 'error');
            wrapper.hidden = true;
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.querySelector('span').textContent = 'Haritadan seç';
        }
    });

    locateBtn.addEventListener('click', () => {
        if (map) locate({ silentFallback: false });
    });
}
