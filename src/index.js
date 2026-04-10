const ALLOWED_ORIGINS = [
    'https://frudotz.com',
    'https://altyapi.frudotz.com',
    'https://frudotz.github.io'
];

function getCorsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Turnstile-Token',
        'Access-Control-Max-Age': '86400',
    };
}

function handleOptions(request) {
    const origin = request.headers.get('Origin');
    if (
        origin !== null &&
        request.headers.get('Access-Control-Request-Method') !== null &&
        request.headers.get('Access-Control-Request-Headers') !== null
    ) {
        return new Response(null, { headers: getCorsHeaders(origin) });
    } else {
        return new Response(null, { headers: { Allow: 'GET, POST, OPTIONS', ...getCorsHeaders(origin) } });
    }
}

async function verifyTurnstile(token, secret) {
    if (!token || !secret) return false;
    const formData = new FormData();
    formData.append('secret', secret);
    formData.append('response', token);
    try {
        const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            body: formData,
            method: 'POST',
        });
        const outcome = await result.json();
        return outcome.success;
    } catch (e) {
        return false;
    }
}

function formatSpeed(kbps) {
    if (!kbps || kbps <= 0) return null;
    if (kbps >= 1000000) return `${(kbps / 1000000).toFixed(0)} Gbps`;
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(0)} Mbps`;
    return `${kbps} Kbps`;
}

// Güvenli fetch sarmalayıcı (Headers ile)
async function fetchTarget(url, env, options = {}) {
    const headers = {
        "User-Agent": env.AGENT_STRING || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": env.REFER_STRING || "https://google.com/",
        ...options.headers
    };
    const reqOptions = { ...options, headers };
    return fetch(url, reqOptions);
}

// SOAP/JSON Ortak ayıklayıcı
function extractDataFromSoap(data, key) {
    if (!data || !data.soapenvBody) return [];

    const responseKey = Object.keys(data.soapenvBody)[0]; // e.g. IlListesiGetirResponse
    const returnKey = Object.keys(data.soapenvBody[responseKey])[0]; // e.g. IlListesiGetirReturn

    let result = data.soapenvBody[responseKey][returnKey];

    if (!result) return [];
    // If it's a single object instead of array
    if (!Array.isArray(result) && result.kod) {
        return [result];
    }
    return Array.isArray(result) ? result : [];
}

async function fetchRealInfrastructure(kapi, il, env) {
    if (!env.INFRA_SOURCE) throw new Error("INFRA_SOURCE yapılandırılmamış.");

    const url = `${env.INFRA_SOURCE}?kapi=${kapi}&il=${il}`;
    const addressUrl = env.ADDRESS_SOURCE ? `${env.ADDRESS_SOURCE}/TT_AcikAdres.php?bbk=${kapi}` : null;

    const reqs = [fetchTarget(url, env, { method: "GET" })];
    if (addressUrl) reqs.push(fetchTarget(addressUrl, env, { method: "GET" }).catch(e => null));

    const [raw, rawAddress] = await Promise.all(reqs);
    const data = await raw.json();

    let acikAdresText = "Adres bulunamadı";
    if (rawAddress) {
        try {
            const addressJson = await rawAddress.json();
            const resultObj = addressJson?.soapenvBody?.AcikAdresGetirResponse?.AcikAdresGetirReturn;
            if (resultObj && resultObj.ns22AcikAdres) {
                // Remove extra spaces (2 or more spaces -> 1 space)
                acikAdresText = resultObj.ns22AcikAdres.replace(/\s{2,}/g, ' ').trim();
            }
        } catch (e) { }
    }

    // Altyapı tipi tespiti (Fiber, VDSL2, ADSL vb.)
    // data.altyapi genellikle "Hiper (FIBER)" veya "VDSL2" gibi döner.
    let infraType = data.altyapi || 'Bilinmiyor';
    // Gelen verinin tipini güvene almak için string'e çeviriyoruz if object/array
    if (typeof infraType !== 'string') {
        if (typeof infraType === 'object' && infraType !== null) {
            infraType = JSON.stringify(infraType);
        } else {
            infraType = String(infraType);
        }
    }
    const isFiber = infraType.toUpperCase().includes('FIBER');
    
    if (isFiber) {
        infraType = 'Fiber';
    } else if (infraType.toUpperCase().includes('VDSL')) {
        infraType = 'VDSL';
    } else if (infraType.toUpperCase().includes('ADSL')) {
        infraType = 'ADSL';
    }

    const speedKbps = parseInt(data.max_hiz, 10) || null;
    const portStatus = data.bos_port ? "Var" : "Yok";

    // Fiber ise hızı kullanıcı isteğiyle 1000 Mbps olarak öne çıkabilir,
    // ama API'den gelen hızı da koruyalım
    let displaySpeed = formatSpeed(speedKbps) || (isFiber ? '1000 Mbps' : 'Belirsiz');

    return {
        type: infraType,
        portStatus: portStatus,
        maxSpeed: displaySpeed,
        distance: data.santral_mesafe ? `${data.santral_mesafe} Metre` : 'Belirsiz',
        bbk: kapi,
        address: {
            text: acikAdresText
        }
    };
}

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get('Origin');

        // Sıkı Origin Kontrolü
        if (request.method !== 'OPTIONS' && !ALLOWED_ORIGINS.includes(origin)) {
            // Local testlerin (localhost v.b) de bloklanacağını unutmayın, sadece izin verilen alan adları!
            return new Response(JSON.stringify({ success: false, error: "Erişim Reddedildi. (Forbidden Origin)" }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (request.method === 'OPTIONS') return handleOptions(request);

        const url = new URL(request.url);
        const dynamicCors = getCorsHeaders(origin);

        if (url.pathname === '/') {
            try {
                const action = url.searchParams.get('action');

                if (action === 'infra') {
                    // Turnstile Verification İşlemi
                    const turnstileToken = request.headers.get('X-Turnstile-Token');
                    if (!env.TURNSTILE_SECRET) {
                        return new Response(JSON.stringify({ success: false, error: "TURNSTILE_SECRET yapılandırılmamış." }), {
                            status: 500, headers: { 'Content-Type': 'application/json', ...dynamicCors }
                        });
                    }

                    const isBotValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET);
                    if (!isBotValid) {
                        return new Response(JSON.stringify({ success: false, error: "Bot doğrulaması başarısız oldu." }), {
                            status: 403, headers: { 'Content-Type': 'application/json', ...dynamicCors }
                        });
                    }

                    const kapi = url.searchParams.get('kapi');
                    const il = url.searchParams.get('il');
                    if (!kapi || !il) throw new Error("Eksik parametreler: kapi ve il gerekli.");

                    // 1. Önce KV Cache Kontrolü yapıyoruz (Eğer veri varsa kota düşmez)
                    const cacheKey = `infra:${kapi}`;
                    if (env.ALTYAPI_CACHE) {
                        const cached = await env.ALTYAPI_CACHE.get(cacheKey, "json");
                        if (cached) {
                            return new Response(JSON.stringify({ success: true, data: cached, meta: { cached: true } }), {
                                headers: { 'Content-Type': 'application/json', ...dynamicCors }
                            });
                        }
                    }

                    // 2. Kotalama (Rate Limiting) - Veri KV'de yoksa kontrol ediyoruz
                    if (env.ALTYAPI_CACHE) {
                        const today = new Date().toISOString().split('T')[0];
                        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                        const globalKey = `quota:global:${today}`;
                        const ipKey = `quota:ip:${ip}:${today}`;

                        const globalCount = parseInt(await env.ALTYAPI_CACHE.get(globalKey)) || 0;
                        if (globalCount >= 1024) {
                            return new Response(JSON.stringify({ success: false, error: "Günlük sistem sorgu limitine ulaşıldı, lütfen yarın tekrar deneyin.", isRateLimited: true }), {
                                status: 429, headers: { 'Content-Type': 'application/json', ...dynamicCors }
                            });
                        }

                        const ipCount = parseInt(await env.ALTYAPI_CACHE.get(ipKey)) || 0;
                        if (ipCount >= 12) {
                            return new Response(JSON.stringify({ success: false, error: "Günlük IP sorgu limitinize ulaştınız (12/12).", isRateLimited: true }), {
                                status: 429, headers: { 'Content-Type': 'application/json', ...dynamicCors }
                            });
                        }

                        // Kotaları artır
                        await env.ALTYAPI_CACHE.put(globalKey, (globalCount + 1).toString(), { expirationTtl: 86400 });
                        await env.ALTYAPI_CACHE.put(ipKey, (ipCount + 1).toString(), { expirationTtl: 86400 });
                    }

                    // 3. Upstream API'den veriyi çek
                    const data = await fetchRealInfrastructure(kapi, il, env);

                    // 4. KV Cache'e yaz
                    if (env.ALTYAPI_CACHE && data) {
                        // 24 saat (86400 saniye) önbellekte tut
                        await env.ALTYAPI_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 86400 });
                    }

                    return new Response(JSON.stringify({ success: true, data: data, meta: { cached: false } }), {
                        headers: { 'Content-Type': 'application/json', ...dynamicCors },
                    });
                }
                else if (action === 'address') {
                    if (!env.ADDRESS_SOURCE) throw new Error("ADDRESS_SOURCE yapılandırılmamış.");

                    const level = url.searchParams.get('level');
                    const id = url.searchParams.get('id');
                    let targetUrl = '';

                    if (level === 'province') {
                        targetUrl = `${env.ADDRESS_SOURCE}/TT_Il_Liste.php`;
                    } else if (level === 'district' && id) {
                        targetUrl = `${env.ADDRESS_SOURCE}/TT_Ilce_Liste.php?ilid=${id}`;
                    } else if (level === 'neighborhood' && id) {
                        // Frontend directly skips bucak and koy -> asks for neighborhoods of a district!
                        // Backend must do the silent middle steps: ilce -> bucak -> koy -> mahalle
                        const bucakRes = await fetchTarget(`${env.ADDRESS_SOURCE}/TT_Ilceye_Bagli_Bucak.php?ilceid=${id}`, env);
                        const bucakData = await bucakRes.json();
                        const bucakList = extractDataFromSoap(bucakData);
                        if (!bucakList.length) throw new Error("Bucak bulunamadı.");

                        const koyRes = await fetchTarget(`${env.ADDRESS_SOURCE}/TT_Bucaga_Bagli_Koy.php?bucakid=${bucakList[0].kod}`, env);
                        const koyData = await koyRes.json();
                        const koyList = extractDataFromSoap(koyData);
                        if (!koyList.length) throw new Error("Köy bulunamadı.");

                        targetUrl = `${env.ADDRESS_SOURCE}/TT_Koye_Bagli_Mahalle.php?koyid=${koyList[0].kod}`;
                    } else if (level === 'street' && id) {
                        targetUrl = `${env.ADDRESS_SOURCE}/TT_Mahalleye_Bagli_Cbsm.php?mahalleid=${id}`;
                    } else if (level === 'building' && id) {
                        targetUrl = `${env.ADDRESS_SOURCE}/TT_Csbm_Bina.php?csbmid=${id}`;
                    } else if (level === 'apartment' && id) {
                        targetUrl = `${env.ADDRESS_SOURCE}/TT_Bina_BagimsizBolum.php?binaid=${id}`;
                    } else {
                        throw new Error(`Geçersiz level veya eksik id: ${level}`);
                    }

                    const raw = await fetchTarget(targetUrl, env);
                    const json = await raw.json();
                    const list = extractDataFromSoap(json);

                    // Temiz bir JSON dizisine dönüştürüyoruz
                    const cleanList = list.map(item => ({
                        id: item.kod || item.kapiNo || item.bbk, // API'ye göre değişebilir
                        name: item.ad || item.binaNo || item.kapiNo // API'ye göre adlandırma
                    }));

                    // Bina listelerinde data tipleri kod ve ad yerine, kimilerinde kapiNo dönebilir vs.
                    // Şimdilik gelen JSON'u ham haliyle beraber cleanList olarak basıyoruz
                    return new Response(JSON.stringify({ success: true, data: cleanList, raw: list }), {
                        headers: { 'Content-Type': 'application/json', ...dynamicCors },
                    });
                }
                else {
                    return new Response(JSON.stringify({ success: false, error: "Geçersiz action." }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...dynamicCors },
                    });
                }

            } catch (err) {
                return new Response(JSON.stringify({ success: false, error: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...dynamicCors },
                });
            }
        }

        return new Response(JSON.stringify({ success: false, error: "Not Found" }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...dynamicCors },
        });
    },
};
