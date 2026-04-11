const SB_URL = "https://fnkohtdpwdwedjrtklre.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZua29odGRwd2R3ZWRqcnRrbHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTA3MjIsImV4cCI6MjA4ODkyNjcyMn0.AuotNxQWgKiSYpS7kLBMm3jOCFhJWsXy31yaqG6dwic";
const FLASH_PROD = "https://open-api.flashexpress.com";

// Flash API Keys — SECURE (อยู่ใน Worker เท่านั้น)
const FLASH_ACCOUNTS = {
  "CBC9351": "0d0b630e5e245149fe120a062c342b3f41ffaea51597464841e97d324b792334",
  "CBF1654": "976a16aac51569cb55b055c0665fef802d77a8dfad05b277b6fe312985e360e3",
};

async function flashSign(params, apiKey) {
  const keys = Object.keys(params).filter(k => k !== "sign" && params[k] !== "" && params[k] !== null && params[k] !== undefined).sort();
  const stringA = keys.map(k => `${k}=${params[k]}`).join("&");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stringA + "&key=" + apiKey));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function callFlash(path, params, mchId) {
  const apiKey = FLASH_ACCOUNTS[mchId];
  if (!apiKey) return { code: -1, message: "Invalid mchId: " + mchId };
  params.mchId = mchId;
  if (!params.nonceStr) params.nonceStr = String(Date.now()) + Math.random().toString(36).substring(2, 8);
  params.sign = await flashSign(params, apiKey);
  const body = new URLSearchParams(params).toString();
  try {
    const res = await fetch(FLASH_PROD + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    return await res.json();
  } catch (e) { return { code: -1, message: e.message }; }
}

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    const allowed = ["https://themton.github.io", "http://localhost:5173", "http://localhost:3000"];
    const corsOrigin = allowed.includes(origin) ? origin : "https://themton.github.io";
    const cors = { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,apikey,Authorization,Prefer" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const json = (data) => new Response(JSON.stringify(data), { headers: { ...cors, "Content-Type": "application/json" } });

    if (url.pathname === "/") return json({ status: "ok" });

    // ═══ FLASH SECURE API ═══
    if (url.pathname === "/flash-api/ping" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      return json(await callFlash("/open/v1/ping", {}, body.mchId || "CBC9351"));
    }
    if (url.pathname === "/flash-api/create" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || "CBC9351"; delete body.mchId;
      return json(await callFlash("/open/v1/orders", body, mchId));
    }
    if (url.pathname === "/flash-api/cancel" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || "CBC9351";
      return json(await callFlash("/open/v1/orders/" + body.pno + "/cancel", { pno: body.pno }, mchId));
    }

    // ═══ SUPABASE PROXY ═══
    const targetUrl = SB_URL + url.pathname + url.search;
    const h = new Headers();
    h.set("apikey", SB_KEY); h.set("Authorization", "Bearer " + SB_KEY); h.set("Content-Type", "application/json");
    if (req.headers.get("Prefer")) h.set("Prefer", req.headers.get("Prefer"));
    const reqBody = ["GET","HEAD"].includes(req.method) ? null : await req.text();
    try {
      const res = await fetch(targetUrl, { method: req.method, headers: h, body: reqBody });
      const respHeaders = new Headers();
      respHeaders.set("Content-Type", res.headers.get("Content-Type") || "application/json");
      Object.entries(cors).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(res.body, { status: res.status, headers: respHeaders });
    } catch (e) { return json({ error: e.message }); }
  }
};
