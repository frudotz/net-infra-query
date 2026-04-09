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


    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const bbk = elApartment.value;
        const il = elProvince.value;
        
        // Turnstile Tokenini Al
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
                document.getElementById('resXdslSpeed').textContent = data.data.port.speedLabel || 'Yok';
                document.getElementById('resFiberSpeed').textContent = data.data.fiber.maxSpeedLabel || 'Yok';
                document.getElementById('resExchange').textContent = data.data.exchange.name || 'Bilinmiyor';
                document.getElementById('resAddress').textContent = data.data.address?.text || 'Bilinmiyor';
                
                resultsSection.classList.remove('hidden');
                resultsSection.scrollIntoView({ behavior: 'smooth' });
            } else {
                alert('Sorgulama sırasında bir hata oluştu: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Sunucuya bağlanılamadı. Lütfen Backend tarafının ayakta olduğundan emin olun.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sorgula';
            // Turnstile'i bir sonraki sorgu için sıfırlayalım
            if (typeof turnstile !== 'undefined') {
                turnstile.reset();
            }
        }
    });
});
