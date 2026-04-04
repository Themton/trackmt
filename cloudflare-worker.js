// ═══════════════════════════════════════════════════════════════════════
// Cloudflare Worker — Supabase Proxy
// เพื่อไม่ให้ติด rate limit ของ Supabase
//
// วิธีใช้:
// 1. ไปที่ https://dash.cloudflare.com → Workers & Pages → Create
// 2. ตั้งชื่อ เช่น "supabase-proxy"
// 3. วางโค้ดนี้ทั้งหมด → Deploy
// 4. เปลี่ยน SUPABASE_URL + SUPABASE_ANON_KEY ด้านล่าง
// 5. ใน React app เปลี่ยน BASE_URL เป็น Worker URL
//    เช่น https://supabase-proxy.YOUR_NAME.workers.dev
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

// Allowed origins (CORS) — ใส่ domain ที่อนุญาต
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://YOUR_SITE.pages.dev",
  "https://YOUR_DOMAIN.com",
];

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleCORS(request);
    }

    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ 
        status: "ok", 
        proxy: "supabase-proxy",
        timestamp: new Date().toISOString() 
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(request) },
      });
    }

    // Proxy to Supabase
    const targetUrl = SUPABASE_URL + url.pathname + url.search;
    
    // Build headers
    const headers = new Headers(request.headers);
    headers.set("apikey", SUPABASE_ANON_KEY);
    headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
    
    // Remove host header
    headers.delete("host");

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? null : await request.text(),
      });

      // Clone response and add CORS headers
      const responseHeaders = new Headers(response.headers);
      Object.entries(corsHeaders(request)).forEach(([k, v]) => responseHeaders.set(k, v));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(request) },
      });
    }
  },
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization, Prefer, Range",
    "Access-Control-Max-Age": "86400",
  };
}

function handleCORS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
