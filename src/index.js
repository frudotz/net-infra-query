const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

function handleOptions(request) {
    if (
        request.headers.get('Origin') !== null &&
        request.headers.get('Access-Control-Request-Method') !== null &&
        request.headers.get('Access-Control-Request-Headers') !== null
    ) {
        return new Response(null, { headers: corsHeaders });
    } else {
        return new Response(null, { headers: { Allow: 'GET, POST, OPTIONS' } });
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

    // API expects GET /sorgula?kapi=...&il=...
    const url = `${env.INFRA_SOURCE}?kapi=${kapi}&il=${il}`;
    const raw = await fetchTarget(url, env, { method: "GET" });
    const upstream = await raw.json();

    // API yapısına uygun haritalama
    const data = upstream?.altyapi?.data || {};

    // FTTH, FTTB, FIBER vs kontrolü
    const isFiber = typeof data.altyapi === 'string' && data.altyapi.toUpperCase().includes('FIBER');
    const speedKbps = parseInt(data.max_hiz, 10) || null;
    const portStatus = data.bos_port ? "available" : "occupied";

    return {
        port: {
            status: portStatus,
            speedKbps: isFiber ? null : speedKbps,
            speedLabel: (!isFiber && speedKbps) ? formatSpeed(speedKbps) : (portStatus === 'available' ? 'Var' : 'Yok'),
        },
        exchange: {
            name: data.altyapi || 'Bilinmiyor', // API'de santral ismi dönmüyor ama altyapı tipi dönüyor. Santral adını altyapı tipi olarak gösterebiliriz.
            distanceM: parseInt(data.santral_mesafe, 10) || null,
        },
        fiber: {
            available: isFiber,
            maxSpeedKbps: isFiber ? speedKbps : null,
            maxSpeedLabel: isFiber ? formatSpeed(speedKbps) : 'Yok',
        }
    };
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') return handleOptions(request);

        const url = new URL(request.url);

        if (url.pathname === '/') {
            try {
                const action = url.searchParams.get('action');

                if (action === 'infra') {
                    const kapi = url.searchParams.get('kapi');
                    const il = url.searchParams.get('il');
                    if (!kapi || !il) throw new Error("Eksik parametreler: kapi ve il gerekli.");

                    const data = await fetchRealInfrastructure(kapi, il, env);

                    return new Response(JSON.stringify({ success: true, data: data }), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
                else {
                    return new Response(JSON.stringify({ success: false, error: "Geçersiz action." }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }

            } catch (err) {
                return new Response(JSON.stringify({ success: false, error: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            }
        }

        return new Response(JSON.stringify({ success: false, error: "Not Found" }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    },
};
