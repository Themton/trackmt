const SB_URL = "https://fnkohtdpwdwedjrtklre.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZua29odGRwd2R3ZWRqcnRrbHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTA3MjIsImV4cCI6MjA4ODkyNjcyMn0.AuotNxQWgKiSYpS7kLBMm3jOCFhJWsXy31yaqG6dwic";
const FLASH_PROD = "https://open-api.flashexpress.com";
const FLASH_TRA = "https://open-api-tra.flashexpress.com";

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,apikey,Authorization,Prefer",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    if (url.pathname === "/") return new Response('{"status":"ok"}', { headers: { ...cors, "Content-Type": "application/json" } });

    let targetUrl, fetchOpts;
    const body = ["GET","HEAD"].includes(req.method) ? null : await req.text();

    if (url.pathname.startsWith("/flash-tra/")) {
      targetUrl = FLASH_TRA + url.pathname.replace("/flash-tra", "");
      fetchOpts = { method: req.method, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body };
    } else if (url.pathname.startsWith("/flash/")) {
      targetUrl = FLASH_PROD + url.pathname.replace("/flash", "");
      fetchOpts = { method: req.method, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body };
    } else {
      targetUrl = SB_URL + url.pathname + url.search;
      const h = new Headers();
      h.set("apikey", SB_KEY);
      h.set("Authorization", "Bearer " + SB_KEY);
      h.set("Content-Type", "application/json");
      if (req.headers.get("Prefer")) h.set("Prefer", req.headers.get("Prefer"));
      fetchOpts = { method: req.method, headers: h, body };
    }

    try {
      const res = await fetch(targetUrl, fetchOpts);
      const respHeaders = new Headers();
      respHeaders.set("Content-Type", res.headers.get("Content-Type") || "application/json");
      Object.entries(cors).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(res.body, { status: res.status, headers: respHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }
  }
};
