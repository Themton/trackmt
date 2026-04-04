// ═══════════════════════════════════════════════════════════════════════
// Cloudflare Worker — Supabase + Flash Express Proxy
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://fnkohtdpwdwedjrtklre.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZua29odGRwd2R3ZWRqcnRrbHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTA3MjIsImV4cCI6MjA4ODkyNjcyMn0.AuotNxQWgKiSYpS7kLBMm3jOCFhJWsXy31yaqG6dwic";
const FLASH_API_URL = "https://open-api.flashexpress.com";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://themton.github.io",
];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return handleCORS(request);

    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", proxy: "supabase-flash-proxy" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(request) },
      });
    }

    // Flash Express API Proxy
    if (url.pathname.startsWith("/flash/")) {
      const flashPath = url.pathname.replace("/flash", "");
      const targetUrl = FLASH_API_URL + flashPath;
      try {
        const response = await fetch(targetUrl, {
          method: request.method,
          headers: { "Content-Type": request.headers.get("Content-Type") || "application/x-www-form-urlencoded" },
          body: ["GET", "HEAD"].includes(request.method) ? null : await request.text(),
        });
        const responseHeaders = new Headers(response.headers);
        Object.entries(corsHeaders(request)).forEach(([k, v]) => responseHeaders.set(k, v));
        return new Response(response.body, { status: response.status, headers: responseHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(request) },
        });
      }
    }

    // Supabase Proxy
    const targetUrl = SUPABASE_URL + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.set("apikey", SUPABASE_ANON_KEY);
    headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
    headers.delete("host");

    try {
      const response = await fetch(targetUrl, {
        method: request.method, headers,
        body: ["GET", "HEAD"].includes(request.method) ? null : await request.text(),
      });
      const responseHeaders = new Headers(response.headers);
      Object.entries(corsHeaders(request)).forEach(([k, v]) => responseHeaders.set(k, v));
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(request) },
      });
    }
  },
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o)) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization, Prefer, Range",
    "Access-Control-Max-Age": "86400",
  };
}

function handleCORS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
