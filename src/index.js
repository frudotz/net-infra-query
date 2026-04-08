import { fetchInfrastructureDemo } from './adapters/demo.js';

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

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }

        const url = new URL(request.url);

        if (url.pathname.startsWith('/api/infra')) {
            try {
                // Burada request normalization ve validation ileride devreye girecek.
                const data = await fetchInfrastructureDemo();
                return new Response(JSON.stringify({ success: true, data: data }), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
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
