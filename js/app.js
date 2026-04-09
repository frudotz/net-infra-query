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

    // Dropdowns
    const elProvince = document.getElementById('province');
    const elDistrict = document.getElementById('district');
    const elNeighborhood = document.getElementById('neighborhood');
    const elStreet = document.getElementById('street');
    const elBuilding = document.getElementById('building');
    const elApartment = document.getElementById('apartment');

    const BACKEND_URL = 'https://niq.api.frudotz.com';

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

            if(lastQueryAddressText) lastQueryAddressText.textContent = d.address?.text || 'Bilinmiyor';
            if(lastQuerySpeed) lastQuerySpeed.textContent = `Tür: ${type}`;
            if(lastQueryFiber) lastQueryFiber.textContent = `Hız: ${speed}`;
            if(lastQueryDate) lastQueryDate.textContent = savedData.date;
            
            lastQuerySection?.classList.remove('hidden');

            const today = new Date().toISOString().split('T')[0];
            if (savedData.date === today && savedData.hasRefreshedToday) {
                if(refreshLastQueryBtn) {
                    refreshLastQueryBtn.disabled = true;
                    refreshLastQueryBtn.style.opacity = '0.3';
                    refreshLastQueryBtn.title = "Günde sadece 1 kez güncelleyebilirsiniz.";
                }
            } else {
                if(refreshLastQueryBtn) {
                    refreshLastQueryBtn.disabled = false;
                    refreshLastQueryBtn.style.opacity = '1';
                    refreshLastQueryBtn.title = "Güncelle";
                }
            }
        } catch(e) {
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
            showResults(savedData.data);
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        });
    }

    function showResults(infraData) {
        // Eski veri şemasıyla veya yayınlanmamış backend ile uyumluluk kalkanı
        const bbk = infraData.bbk || '-';
        const address = infraData.address?.text || 'Bilinmiyor';
        
        const type = infraData.type || (infraData.exchange && infraData.exchange.name) || '-';
        
        let portStatus = infraData.portStatus;
        if (!portStatus) {
            portStatus = (infraData.port && infraData.port.status === 'available') ? 'Var' : 'Yok';
        }

        let speed = infraData.maxSpeed;
        if (!speed) {
             if (type.toUpperCase().includes('FIBER')) {
                 speed = (infraData.fiber && infraData.fiber.maxSpeedLabel) ? infraData.fiber.maxSpeedLabel : '1000 Mbps';
             } else {
                 speed = (infraData.port && infraData.port.speedLabel) || '-';
             }
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
        
        resultsSection.classList.remove('hidden');
    }


    async function fetchAddressData(level, id = null) {
        let url = `${BACKEND_URL}/?action=address&level=${level}`;
        if (id) url += `&id=${id}`;
        
        const res = await fetch(url);
        const data = await res.json();
        if(!data.success) throw new Error(data.error);
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
                showResults(data.data);
                
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
