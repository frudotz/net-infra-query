document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('themeToggle');
    const htmlElement = document.documentElement;
    
    // Theme setup based on user preference or local storage
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

    // Form logic setup
    const form = document.getElementById('infrastructureForm');
    const resultsSection = document.getElementById('resultsSection');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Form gönderimi sırasında buton disable edilir
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sorgulanıyor...';

        try {
            // Frontend: /api/infra
            // Cloudflare Worker lokal geliştirme aşamasında genellikle 8787 portunda ayaktadır
            const res = await fetch('https://niq.api.frudotz.com/api/infra');
            const data = await res.json();

            if (data.success) {
                document.getElementById('resXdslSpeed').textContent = data.data.port.speedLabel || 'Yok';
                document.getElementById('resFiberSpeed').textContent = data.data.fiber.maxSpeedLabel || 'Yok';
                document.getElementById('resExchange').textContent = data.data.exchange.name || 'Bilinmiyor';
                
                resultsSection.classList.remove('hidden');
                
                // Animasyonlu biçimde aşağı kaydır
                resultsSection.scrollIntoView({ behavior: 'smooth' });
            } else {
                alert('Sorgulama sırasında bir hata oluştu: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Sunucuya bağlanılamadı. Lütfen Worker backend\'in ayakta olduğundan emin olun.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sorgula';
        }
    });
});
