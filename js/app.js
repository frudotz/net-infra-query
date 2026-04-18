document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('themeToggle');
    const htmlElement = document.documentElement;

    // Theme setup
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        htmlElement.classList.replace('dark', 'light');
    }

    themeToggleBtn.addEventListener('click', () => {
        if (htmlElement.classList.contains('dark')) {
            htmlElement.classList.replace('dark', 'light');
            localStorage.setItem('theme', 'light');
        } else {
            htmlElement.classList.replace('light', 'dark');
            localStorage.setItem('theme', 'dark');
        }
    });

    const form = document.getElementById('infrastructureForm');
    const resultsSection = document.getElementById('resultsSection');
    const submitBtn = document.getElementById('submitBtn');

    const mapToggleBtn = document.getElementById('mapToggleBtn');
    const mapWrapper = document.getElementById('mapWrapper');
    const mapScoreText = document.getElementById('mapScoreText');
    const geoLocateBtn = document.getElementById('geoLocateBtn');
    let leafletMap = null;
    let leafletMarker = null;

    // Dropdowns
    const elProvince = document.getElementById('province');
    const elDistrict = document.getElementById('district');
    const elNeighborhood = document.getElementById('neighborhood');
    const elStreet = document.getElementById('street');
    const elBuilding = document.getElementById('building');
    const elApartment = document.getElementById('apartment');

    const BACKEND_URL = 'https://niq.api.frudotz.com'; // Use your backend url

    function levenshtein(a, b) {
        const matrix = [];
        let i, j;
        if (a.length == 0) return b.length;
        if (b.length == 0) return a.length;
        for (i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (i = 1; i <= b.length; i++) {
            for (j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) == a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                }
            }
        }
        return matrix[b.length][a.length];
    }

    function normalizeStr(str) {
        if (!str) return '';
        // Haritadan gelen gereksiz ekleri (ili, ilçesi, bulvarı) kaldır ve temizle
        return str.replace(/İ/g, 'I').replace(/ı/g, 'i').toLowerCase()
            .replace(/\b(mah(\.|alle|allesi)?)\b/ig, '')
            .replace(/\b(sok(\.|ak|ağı|agi|aği)?)\b/ig, '')
            .replace(/\b(sk(\.)?)\b/ig, '')
            .replace(/\b(cad(\.|de|desi)?)\b/ig, '')
            .replace(/\b(cd(\.)?)\b/ig, '')
            .replace(/\b(bulv(\.|ar|arı|ari)?)\b/ig, '')
            .replace(/\b(il[cç]es[iı])\b/ig, '')
            .replace(/\b(il[iı])\b/ig, '')
            .replace(/\b(k[oö]y[uü])\b/ig, '')
            .replace(/\b(beldes[iı])\b/ig, '')
            .replace(/\b(buca[gğ][iı])\b/ig, '')
            .replace(/[-_./\/]/g, ' ') // Özel karakterleri boşluk yap
            .replace(/\s+/g, ' ').trim();
    }

    function extractAlphaNumCode(str) {
        // Önemsiz kelimeleri sil ("no: ", "bina: " vs.)
        let s = (str || '').replace(/\b(no|numara|bina|blok)\b/ig, '');
        s = s.replace(/[^0-9a-zçğöşü]/g, ' ').replace(/\s+/g, ' ').trim();
        s = s.replace(/\b(\d+)\s+([a-zçğöşü])\b/g, '$1$2');
        const tokens = s.split(' ');
        const numToken = tokens.find(t => /\d/.test(t));
        return numToken || '';
    }

    function findBestMatch(targetStr, optionsArray, strictNumeric = false) {
        let bestMatch = null;
        let minDistance = Infinity;

        // Alt tire sonrasını kes (TT adres yapmasındaki detayları es geç)
        let cleanTarget = (targetStr || '').split('_')[0].trim();
        let targetNorm = normalizeStr(cleanTarget);

        // TT formatı düzeltmesi: Eğer haritadan No:8 veya 8 gelirse onu NO :8 sistemine benzet
        if (strictNumeric && targetNorm) {
            let baseNorm = targetNorm.replace(/no/g, '').trim(); // 8
            if (baseNorm) targetNorm = 'no :' + baseNorm;
        }

        const targetCodes = extractAlphaNumCode(targetNorm);

        for (let opt of optionsArray) {
            const text = opt.name || opt.ad || opt.kapiNo || opt.binaNo || '';
            let optNorm = normalizeStr(text.split('_')[0].trim()); // Alt tireden sonrasını es geç
            if (!optNorm) continue;

            // Sokak adı eşleştirmesi
            if (strictNumeric) {
                const optCodes = extractAlphaNumCode(optNorm);
                if (targetCodes && optCodes && targetCodes !== optCodes) {
                    continue; // Skip this option, the essential street/building numbers do not match
                }
            }

            if (optNorm === targetNorm) {
                bestMatch = opt;
                minDistance = 0;
                break;
            }

            const dist = levenshtein(targetNorm, optNorm);
            if (dist < minDistance) {
                minDistance = dist;
                bestMatch = opt;
            }
        }

        const maxLength = Math.max(targetNorm.length, bestMatch ? normalizeStr((bestMatch.name || bestMatch.ad || '').split('_')[0]).length : 1);
        let score = Math.max(0, 100 - Math.round((minDistance / maxLength) * 100));

        if (strictNumeric && bestMatch && targetCodes) {
            const bestCodes = extractAlphaNumCode(normalizeStr(bestMatch.name || bestMatch.ad || ''));
            if (bestCodes === targetCodes) {
                score = Math.max(score, 85);
            }
        }

        return { match: bestMatch, score, minDistance };
    }

    let currentGeocodeId = 0;

    async function handleGeocode(lat, lon) {
        const geocodeId = ++currentGeocodeId;
        try {
            if (mapScoreText) mapScoreText.textContent = 'Aranıyor...';
            const res = await fetch(`${BACKEND_URL}/?action=geocode&lat=${lat}&lon=${lon}`);
            const data = await res.json();

            if (data.success && data.data.address) {
                if (geocodeId !== currentGeocodeId) return;

                const addr = data.data.address;
                const provinceName = addr.province || addr.state || addr.city;
                const districtName = addr.town || addr.county || addr.district || addr.suburb || addr.city_district;
                const neighborhoodName = addr.neighbourhood || addr.suburb || addr.quarter;
                const roadName = addr.road;
                const houseNo = addr.house_number;

                let totalScore = 0;
                let checks = 0;

                if (provinceName) {
                    let provOpts = [];
                    // wait for province to be loaded
                    let waits = 0;
                    while (elProvince.options.length <= 1 && waits < 20) {
                        await new Promise(r => setTimeout(r, 100)); waits++;
                    }
                    if (elProvince.options.length > 1) {
                        provOpts = Array.from(elProvince.options).slice(1).map(o => ({ id: o.value, name: o.textContent }));
                    }

                    const matchRes = findBestMatch(provinceName, provOpts, false);
                    if (matchRes.match && matchRes.score > 40) {
                        elProvince.value = matchRes.match.id;
                        totalScore += matchRes.score; checks++;

                        if (districtName) {
                            try {
                                resetDropdown(elDistrict, 'Yükleniyor...');
                                const listD = await fetchAddressData('district', matchRes.match.id);
                                if (geocodeId !== currentGeocodeId) return;
                                populateDropdown(elDistrict, listD, 'İlçe Seçiniz...');

                                const dMatch = findBestMatch(districtName, listD, false);
                                if (dMatch.match && dMatch.score > 40) {
                                    elDistrict.value = dMatch.match.id;
                                    totalScore += dMatch.score; checks++;

                                    if (neighborhoodName) {
                                        resetDropdown(elNeighborhood, 'Yükleniyor...');
                                        const listN = await fetchAddressData('neighborhood', dMatch.match.id);
                                        if (geocodeId !== currentGeocodeId) return;
                                        populateDropdown(elNeighborhood, listN, 'Mahalle Seçiniz...');

                                        const nMatch = findBestMatch(neighborhoodName, listN, false);
                                        if (nMatch.match && nMatch.score > 40) {
                                            elNeighborhood.value = nMatch.match.id;
                                            totalScore += nMatch.score; checks++;

                                            if (roadName) {
                                                resetDropdown(elStreet, 'Yükleniyor...');
                                                const listS = await fetchAddressData('street', nMatch.match.id);
                                                if (geocodeId !== currentGeocodeId) return;
                                                populateDropdown(elStreet, listS, 'Sokak Seçiniz...');

                                                // Sokak ve bina eşleşmelerinde katı numaratör (strictNumeric) kullanılır
                                                const sMatch = findBestMatch(roadName, listS, true);
                                                if (sMatch.match && sMatch.score > 50) {
                                                    elStreet.value = sMatch.match.id;
                                                    totalScore += sMatch.score; checks++;

                                                    resetDropdown(elBuilding, 'Yükleniyor...');
                                                    const listB = await fetchAddressData('building', sMatch.match.id);
                                                    if (geocodeId !== currentGeocodeId) return;
                                                    populateDropdown(elBuilding, listB, 'Bina Seçiniz...');

                                                    if (houseNo) {
                                                        const bMatch = findBestMatch(houseNo, listB, true);
                                                        if (bMatch.match && bMatch.score > 70) {
                                                            elBuilding.value = bMatch.match.id;
                                                            resetDropdown(elApartment, 'Yükleniyor...');
                                                            const listA = await fetchAddressData('apartment', bMatch.match.id);
                                                            if (geocodeId !== currentGeocodeId) return;
                                                            populateDropdown(elApartment, listA, 'Daire Seçiniz...');
                                                        } else {
                                                            resetDropdown(elApartment, 'Bina ile eşleştirilemedi');
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (addrErr) {
                                console.warn("Harita adres dönüşümü sırasında detaylar çekilemedi: ", addrErr);
                            }
                        }
                    }
                }

                if (geocodeId !== currentGeocodeId) return;

                const finalScore = checks > 0 ? Math.round(totalScore / checks) : 0;
                if (mapScoreText) {
                    mapScoreText.textContent = `%${finalScore}`;
                    mapScoreText.style.color = finalScore < 60 ? 'var(--clr-secondary)' : 'var(--clr-success)';
                }
            } else {
                if (mapScoreText) mapScoreText.textContent = 'Adres Bulunamadı';
            }
        } catch (e) {
            console.error(e);
            if (mapScoreText) mapScoreText.textContent = 'Hata';
        }
    }

    function initMap() {
        if (leafletMap || typeof L === 'undefined') return;

        leafletMap = L.map('map').setView([39.92077, 32.85411], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(leafletMap);

        leafletMarker = L.marker([39.92077, 32.85411], { draggable: true }).addTo(leafletMap);

        leafletMarker.on('dragend', function (e) {
            const coords = e.target.getLatLng();
            handleGeocode(coords.lat, coords.lng);
        });

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                leafletMap.setView([lat, lng], 16);
                leafletMarker.setLatLng([lat, lng]);
                handleGeocode(lat, lng);
            }, err => console.warn("GPS reddedildi"));
        }
    }

    if (mapToggleBtn) {
        mapToggleBtn.addEventListener('click', () => {
            if (mapWrapper.classList.contains('hidden')) {
                mapWrapper.classList.remove('hidden');
                initMap();
                setTimeout(() => {
                    leafletMap.invalidateSize();
                }, 200);
            } else {
                mapWrapper.classList.add('hidden');
            }
        });
    }

    if (geoLocateBtn) {
        geoLocateBtn.addEventListener('click', () => {
            if (navigator.geolocation && leafletMap && leafletMarker) {
                mapScoreText.textContent = 'Konum aranıyor...';
                navigator.geolocation.getCurrentPosition(pos => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    leafletMap.setView([lat, lng], 16);
                    leafletMarker.setLatLng([lat, lng]);
                    handleGeocode(lat, lng);
                }, err => {
                    alert('Konum alınamadı, izinleri kontrol edin.');
                });
            }
        });
    }

    // Last Query Elements
    const lastQuerySection = document.getElementById('lastQuerySection');
    const lastQueryAddressText = document.getElementById('lastQueryAddressText');
    const lastQuerySpeed = document.getElementById('lastQuerySpeed');
    const lastQueryFiber = document.getElementById('lastQueryFiber');
    const lastQueryDate = document.getElementById('lastQueryDate');
    const lastQueryCard = document.getElementById('lastQueryCard');
    const refreshLastQueryBtn = document.getElementById('refreshLastQueryBtn');

    function renderLastQuery() {
        const saved = localStorage.getItem('lastQuery');
        if (!saved) {
            lastQuerySection?.classList.add('hidden');
            return;
        }
        try {
            const savedData = JSON.parse(saved);
            const d = savedData.data;

            // Eski şema ile geriye dönük uyumluluk
            const type = d.type || (d.exchange && d.exchange.name) || '-';
            let speed = d.maxSpeed;
            if (!speed) { // Eğer eski şemaysa
                if (type.toUpperCase().includes('FIBER')) {
                    speed = (d.fiber && d.fiber.maxSpeedLabel) || '1000 Mbps';
                } else {
                    speed = (d.port && d.port.speedLabel) || '-';
                }
            }

            if (lastQueryAddressText) lastQueryAddressText.textContent = d.address?.text || 'Bilinmiyor';
            if (lastQuerySpeed) lastQuerySpeed.textContent = `Tür: ${type}`;
            if (lastQueryFiber) lastQueryFiber.textContent = `Hız: ${speed}`;
            if (lastQueryDate) lastQueryDate.textContent = savedData.date;

            lastQuerySection?.classList.remove('hidden');

            const today = new Date().toISOString().split('T')[0];
            if (savedData.date === today && savedData.hasRefreshedToday) {
                if (refreshLastQueryBtn) {
                    refreshLastQueryBtn.disabled = true;
                    refreshLastQueryBtn.style.opacity = '0.3';
                    refreshLastQueryBtn.title = "Günde sadece 1 kez güncelleyebilirsiniz.";
                }
            } else {
                if (refreshLastQueryBtn) {
                    refreshLastQueryBtn.disabled = false;
                    refreshLastQueryBtn.style.opacity = '1';
                    refreshLastQueryBtn.title = "Güncelle";
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    renderLastQuery();

    if (refreshLastQueryBtn) {
        refreshLastQueryBtn.addEventListener('click', async () => {
            const saved = localStorage.getItem('lastQuery');
            if (!saved) return;
            const savedData = JSON.parse(saved);

            const turnstileToken = new FormData(form).get('cf-turnstile-response');
            if (!turnstileToken) {
                alert("Güncellemek için lütfen aşağıdaki formdan 'Ben robot değilim' doğrulamasını tamamlayın.");
                document.querySelector('.cf-turnstile').scrollIntoView({ behavior: 'smooth' });
                return;
            }

            await doInfraQuery(savedData.bbk, savedData.il, turnstileToken, true);
        });
    }

    if (lastQueryCard) {
        lastQueryCard.addEventListener('click', () => {
            const saved = localStorage.getItem('lastQuery');
            if (!saved) return;
            const savedData = JSON.parse(saved);
            showResults(savedData.data, savedData.bbk);
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        });
    }

    function showResults(infraData, bbkArg) {
        // Eski veri şemasıyla veya yayınlanmamış backend ile uyumluluk kalkanı
        const bbk = infraData.bbk || bbkArg || '-';
        const address = infraData.address?.text || 'Bilinmiyor';

        const type = infraData.type || (infraData.exchange && infraData.exchange.name) || '-';
        const isFiber = type.toUpperCase().includes('FIBER');

        let portStatus = infraData.portStatus;
        if (!portStatus) {
            portStatus = (infraData.port && infraData.port.status === 'available') ? 'Var' : 'Yok';
        }

        let speed = infraData.maxSpeed;
        if (isFiber) {
            speed = '1000 Mbps'; // Fiber ise her türlü (eski/yeni API) 1000 Mbps göster
        } else if (!speed) {
            speed = (infraData.port && infraData.port.speedLabel) || '-';
        }

        let distance = infraData.distance;
        if (!distance) {
            distance = (infraData.exchange && infraData.exchange.distanceM) ? `${infraData.exchange.distanceM} Metre` : 'Belirsiz';
        }

        document.getElementById('resBbk').textContent = bbk;
        document.getElementById('resAddress').textContent = address;

        document.getElementById('resType').textContent = type;
        document.getElementById('resPort').textContent = portStatus;
        document.getElementById('resSpeed').textContent = speed;
        document.getElementById('resDistance').textContent = distance;

        const elSantral = document.getElementById('resSantral');
        if (elSantral) elSantral.textContent = infraData.santralAdi || '-';

        const elMudurluk = document.getElementById('resMudurluk');
        if (elMudurluk) elMudurluk.textContent = infraData.mudurlukAdi || '-';

        const elKabin = document.getElementById('resKabin');
        if (elKabin) elKabin.textContent = infraData.kabinTipi || '-';

        // Fiber ise santral mesafesi kartını görünmez yap
        const distanceCard = document.getElementById('resDistance').closest('.stat-card');
        if (distanceCard) {
            distanceCard.style.display = isFiber ? 'none' : 'flex';
        }

        resultsSection.classList.remove('hidden');
    }


    async function fetchAddressData(level, id = null) {
        let url = `${BACKEND_URL}/?action=address&level=${level}`;
        if (id) url += `&id=${id}`;

        const res = await fetch(url);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        return data.data; // clean list
    }

    function resetDropdown(dropdown, defaultText) {
        dropdown.innerHTML = `<option value="">${defaultText}</option>`;
        dropdown.disabled = true;
    }

    function populateDropdown(dropdown, list, defaultText) {
        resetDropdown(dropdown, defaultText);
        list.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            // API bazen farklı fieldlarda gönderebilir, bu yüzden .name olmazsa raw nesneden deneyelim
            option.textContent = item.name || item.ad || item.kapiNo || item.binaNo || "Geçersiz";
            dropdown.appendChild(option);
        });
        dropdown.disabled = false;
    }

    // Load Provinces
    fetchAddressData('province').then(list => {
        populateDropdown(elProvince, list, 'İl Seçiniz...');
    }).catch(console.error);

    elProvince.addEventListener('change', async (e) => {
        resetDropdown(elDistrict, 'İlçe Seçiniz...');
        resetDropdown(elNeighborhood, 'Mahalle Seçiniz...');
        resetDropdown(elStreet, 'Sokak Seçiniz...');
        resetDropdown(elBuilding, 'Bina Seçiniz...');
        resetDropdown(elApartment, 'Daire Seçiniz...');

        const val = e.target.value;
        if (!val) return;

        try {
            const list = await fetchAddressData('district', val);
            populateDropdown(elDistrict, list, 'İlçe Seçiniz...');
        } catch (err) { console.error(err); }
    });

    elDistrict.addEventListener('change', async (e) => {
        resetDropdown(elNeighborhood, 'Mahalle Seçiniz...');
        resetDropdown(elStreet, 'Sokak Seçiniz...');
        resetDropdown(elBuilding, 'Bina Seçiniz...');
        resetDropdown(elApartment, 'Daire Seçiniz...');

        const val = e.target.value;
        if (!val) return;

        try {
            // Worker handles bucak and koy under the hood
            const list = await fetchAddressData('neighborhood', val);
            populateDropdown(elNeighborhood, list, 'Mahalle Seçiniz...');
        } catch (err) { console.error(err); }
    });

    elNeighborhood.addEventListener('change', async (e) => {
        resetDropdown(elStreet, 'Sokak Seçiniz...');
        resetDropdown(elBuilding, 'Bina Seçiniz...');
        resetDropdown(elApartment, 'Daire Seçiniz...');

        const val = e.target.value;
        if (!val) return;

        try {
            const list = await fetchAddressData('street', val);
            populateDropdown(elStreet, list, 'Sokak Seçiniz...');
        } catch (err) { console.error(err); }
    });

    elStreet.addEventListener('change', async (e) => {
        resetDropdown(elBuilding, 'Bina Seçiniz...');
        resetDropdown(elApartment, 'Daire Seçiniz...');

        const val = e.target.value;
        if (!val) return;

        try {
            const list = await fetchAddressData('building', val);
            populateDropdown(elBuilding, list, 'Bina Seçiniz...');
        } catch (err) { console.error(err); }
    });

    elBuilding.addEventListener('change', async (e) => {
        resetDropdown(elApartment, 'Daire Seçiniz...');

        const val = e.target.value;
        if (!val) return;

        try {
            const list = await fetchAddressData('apartment', val);
            // Some specific mapping might be needed here based on exact API fields returned
            populateDropdown(elApartment, list, 'Daire Seçiniz...');
        } catch (err) { console.error(err); }
    });


    async function doInfraQuery(bbk, il, turnstileToken, isRefresh = false) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sorgulanıyor...';

        try {
            const res = await fetch(`${BACKEND_URL}/?action=infra&kapi=${bbk}&il=${il}`, {
                headers: {
                    'X-Turnstile-Token': turnstileToken
                }
            });
            const data = await res.json();

            if (data.success) {
                showResults(data.data, bbk);

                // Save to localStorage
                const today = new Date().toISOString().split('T')[0];
                const existing = localStorage.getItem('lastQuery') ? JSON.parse(localStorage.getItem('lastQuery')) : {};

                localStorage.setItem('lastQuery', JSON.stringify({
                    date: today,
                    bbk: bbk,
                    il: il,
                    data: data.data,
                    hasRefreshedToday: isRefresh ? true : existing.hasRefreshedToday && existing.bbk === bbk
                }));

                renderLastQuery();

                if (!isRefresh) {
                    resultsSection.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                if (data.isRateLimited) {
                    alert('Limit Uyarısı: ' + data.error);
                } else {
                    alert('Sorgulama sırasında bir hata oluştu: ' + data.error);
                }
            }
        } catch (err) {
            console.error(err);
            alert('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sorgula';
            if (typeof turnstile !== 'undefined') {
                turnstile.reset();
            }
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const bbk = elApartment.value;
        const il = elProvince.value;

        const formData = new FormData(form);
        const turnstileToken = formData.get('cf-turnstile-response');

        if (!bbk || !il) {
            alert("Lütfen tüm adres adımlarını tamamlayıp daire seçin.");
            return;
        }

        if (!turnstileToken) {
            alert("Lütfen bot olmadığınızı doğrulamak için kutucuğu işaretleyin.");
            return;
        }
        await doInfraQuery(bbk, il, turnstileToken, false);
    });
});
