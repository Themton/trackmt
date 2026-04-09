import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ADDR_DB from "./addr.js";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://fnkohtdpwdwedjrtklre.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZua29odGRwd2R3ZWRqcnRrbHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTA3MjIsImV4cCI6MjA4ODkyNjcyMn0.AuotNxQWgKiSYpS7kLBMm3jOCFhJWsXy31yaqG6dwic";
const BASE_URL = SUPABASE_URL; // ใช้ Supabase ตรง

// ═══════════════════════════════════════════════════════════════
// FLASH EXPRESS API CONFIG
// ═══════════════════════════════════════════════════════════════
const FLASH_TRAINING = false;
const FLASH_ACCOUNTS = [
  { name: "CBC9351", mchId: "CBC9351", key: "0d0b630e5e245149fe120a062c342b3f41ffaea51597464841e97d324b792334" },
  { name: "CBF1654", mchId: "CBF1654", key: "976a16aac51569cb55b055c0665fef802d77a8dfad05b277b6fe312985e360e3" },
];
const FLASH_DIRECT_URL = FLASH_TRAINING
  ? "https://open-api-tra.flashexpress.com"
  : "https://open-api.flashexpress.com";
const FLASH_API_URL = FLASH_TRAINING
  ? "https://upabase-proxy.themtja.workers.dev/flash-tra"
  : "https://upabase-proxy.themtja.workers.dev/flash";

// Flash Express API Helper
const flashApi = {
  getAccount(mchId) {
    return FLASH_ACCOUNTS.find(a => a.mchId === mchId) || FLASH_ACCOUNTS[0];
  },
  async sign(params, apiKey) {
    const keys = Object.keys(params).filter(k => k !== 'sign' && params[k] !== '' && params[k] !== null && params[k] !== undefined).sort();
    const stringA = keys.map(k => `${k}=${params[k]}`).join("&");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stringA + "&key=" + apiKey));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  },
  async ping(account) {
    const acc = account || FLASH_ACCOUNTS[0];
    const params = { mchId: acc.mchId, nonceStr: String(Date.now()) };
    params.sign = await this.sign(params, acc.key);
    const body = new URLSearchParams(params).toString();
    const res = await fetch(`${FLASH_API_URL}/open/v1/ping`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { code: 1, message: text }; }
  },
  async createOrder(parcel, account) {
    const acc = account || FLASH_ACCOUNTS[0];
    // Validate
    const missing = [];
    if (!parcel.sender_name) missing.push("ชื่อผู้ส่ง");
    if (!parcel.sender_phone) missing.push("เบอร์ผู้ส่ง");
    if (!parcel.receiver_name) missing.push("ชื่อผู้รับ");
    if (!parcel.receiver_phone) missing.push("เบอร์ผู้รับ");
    if (!parcel.receiver_district) missing.push("อำเภอผู้รับ");
    if (!parcel.receiver_postal) missing.push("รหัสไปรษณีย์ผู้รับ");
    if (missing.length) throw new Error("ข้อมูลไม่ครบ:\n" + missing.join(", "));

    const mapProv = (p) => p === "กรุงเทพมหานคร" ? "กรุงเทพ" : p;
    const uniqueId = "O" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

    const params = {
      mchId: acc.mchId,
      nonceStr: String(Date.now()) + Math.random().toString(36).substring(2, 8),
      outTradeNo: uniqueId,
      srcName: parcel.sender_name,
      srcPhone: parcel.sender_phone,
      srcDetailAddress: parcel.sender_address || parcel.sender_name,
      dstName: parcel.receiver_name,
      dstPhone: parcel.receiver_phone,
      dstProvinceName: mapProv(parcel.receiver_province || ""),
      dstCityName: parcel.receiver_district || "",
      dstPostalCode: String(parcel.receiver_postal),
      dstDetailAddress: [parcel.receiver_address, parcel.receiver_subdistrict, parcel.receiver_district, parcel.receiver_province].filter(Boolean).join(" ") || parcel.receiver_name,
      articleCategory: "1",
      expressCategory: "1",
      codEnabled: parcel.cod_enabled ? "1" : "0",
      weight: String(Math.max(1, Math.round((parcel.weight || 1) * 1000))),
    };
    if (parcel.sender_province) params.srcProvinceName = mapProv(parcel.sender_province);
    let senderPostal = parcel.sender_postal || "";
    if (!senderPostal) { const m = (parcel.sender_address || "").match(/\b(\d{5})\b/); if (m) senderPostal = m[1]; }
    if (senderPostal) params.srcPostalCode = String(senderPostal);
    if (parcel.receiver_subdistrict) params.dstDistrictName = parcel.receiver_subdistrict;
    if (parcel.cod_enabled && parcel.cod_amount > 0) {
      params.codAmount = String(Math.round(parcel.cod_amount * 100));
    }
    console.log("Flash API [" + acc.mchId + "] params:", JSON.stringify(params, null, 2));
    params.sign = await this.sign(params, acc.key);

    const body = new URLSearchParams(params).toString();
    console.log("Flash API body:", decodeURIComponent(body));
    const urls = [
      `${FLASH_API_URL}/open/v1/orders`,
      `${FLASH_DIRECT_URL}/open/v1/orders`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        return await res.json();
      } catch (e) { console.warn("Flash:", url, e.message); continue; }
    }
    throw new Error("ไม่สามารถเชื่อมต่อ Flash API — ตรวจสอบ Cloudflare Worker");
  },
};

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT (with Cloudflare Worker fallback)
// ═══════════════════════════════════════════════════════════════
let activeBaseUrl = BASE_URL;

const sb = {
  headers: () => ({
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  }),
  async query(table, { method = "GET", filters = "", body, order } = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const params = [];
    if (filters) params.push(filters);
    if (order) params.push(`order=${order}`);
    if (method === "GET") params.push("select=*");
    if (params.length) url += `?${params.join("&")}`;
    const res = await fetch(url, { method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || `HTTP ${res.status}`); }
    return res.json();
  },
  select: (t, o) => sb.query(t, { ...o, method: "GET" }),
  insert: (t, b) => sb.query(t, { method: "POST", body: b }),
  update: (t, id, b) => sb.query(t, { method: "PATCH", body: b, filters: `id=eq.${id}` }),
  delete: (t, id) => sb.query(t, { method: "DELETE", filters: `id=eq.${id}` }),
  realtime: (table, cb) => {
    try {
      const wsUrl = SUPABASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1/websocket?apikey=" + SUPABASE_ANON_KEY + "&vsn=1.0.0";
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ topic: `realtime:public:${table}`, event: "phx_join", payload: { config: { broadcast: { self: true }, postgres_changes: [{ event: "*", schema: "public", table }] } }, ref: "1" }));
        setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" })), 30000);
      };
      ws.onmessage = (e) => { try { const msg = JSON.parse(e.data); if (msg.event === "postgres_changes") cb(msg.payload); } catch {} };
      return () => ws.close();
    } catch { return () => {}; }
  },
};

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateParcelNo() {
  const now = new Date();
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `FX-${d}-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0")}`;
}

const ROLES = {
  admin: { label: "แอดมิน", icon: "👑", color: "#dc2626", bg: "#fef2f2" },
  shipping: { label: "พนักงานจัดส่ง", icon: "🚚", color: "#0284c7", bg: "#e0f2fe" },
  accounting: { label: "พนักงานบัญชี", icon: "💰", color: "#059669", bg: "#ecfdf5" },
};

const CAN = {
  admin:      { create: true, edit: true, delete: true, status: true, print: true, users: true, viewCOD: true },
  shipping:   { create: true, edit: true, delete: false, status: true, print: true, users: false, viewCOD: false },
  accounting: { create: false, edit: false, delete: false, status: false, print: true, users: false, viewCOD: true },
};

const PROVINCES = ["กรุงเทพมหานคร","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา","ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก","นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน","บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา","พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต","มหาสารคาม","มุกดาหาร","แม่ฮ่องสอน","ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี","ลพบุรี","ลำปาง","ลำพูน","เลย","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร","สระแก้ว","สระบุรี","สิงห์บุรี","สุโขทัย","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","หนองคาย","หนองบัวลำภู","อ่างทอง","อำนาจเจริญ","อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี"];

// ═══════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════
function LoginScreen({ onLogin, isDemo }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"); return; }
    setLoading(true); setError("");
    try {
      if (isDemo) {
        const demoUsers = [
          { id: "u1", username: "admin", password: "admin1234", display_name: "แอดมิน", role: "admin", avatar_color: "#dc2626" },
          { id: "u2", username: "shipping1", password: "ship1234", display_name: "พนักงานจัดส่ง 1", role: "shipping", avatar_color: "#0284c7" },
          { id: "u3", username: "accounting1", password: "acc1234", display_name: "พนักงานบัญชี 1", role: "accounting", avatar_color: "#059669" },
        ];
        const u = demoUsers.find(u => u.username === username && u.password === password);
        if (u) { onLogin(u); } else { setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"); }
        setLoading(false); return;
      }
      const hash = await sha256(password);
      const users = await sb.select("fx_users", { filters: `username=eq.${username}&password=eq.${hash}&is_active=eq.true` });
      if (users?.length) {
        const user = users[0];
        sb.update("fx_users", user.id, { last_login: new Date().toISOString() }).catch(() => {});
        sb.insert("fx_login_logs", { user_id: user.id, username: user.username, action: "login" }).catch(() => {});
        onLogin(user);
      } else {
        sb.insert("fx_login_logs", { username, action: "failed" }).catch(() => {});
        setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
    } catch (e) { setError("เชื่อมต่อไม่ได้: " + e.message); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans Thai', -apple-system, sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 72, height: 72, background: "linear-gradient(135deg,#dc2626,#f97316)", borderRadius: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 36, marginBottom: 16, boxShadow: "0 8px 30px rgba(220,38,38,.3)" }}>⚡</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", margin: 0 }}>Flash Backend</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 6 }}>ระบบจัดการพัสดุขนส่งแฟลช</p>
        </div>
        <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, padding: 32, backdropFilter: "blur(10px)" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: "0 0 24px", textAlign: "center" }}>เข้าสู่ระบบ</h2>
          {error && <div style={{ padding: "10px 14px", background: "rgba(220,38,38,.15)", border: "1px solid rgba(220,38,38,.3)", borderRadius: 10, marginBottom: 16, fontSize: 13, color: "#f87171" }}>❌ {error}</div>}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>ชื่อผู้ใช้</label>
            <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().trim())} placeholder="username" onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", padding: "12px 16px", background: "rgba(255,255,255,.06)", border: "1.5px solid rgba(255,255,255,.12)", borderRadius: 12, fontSize: 15, color: "#f8fafc", outline: "none", fontFamily: "inherit" }} autoFocus />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>รหัสผ่าน</label>
            <div style={{ position: "relative" }}>
              <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", padding: "12px 48px 12px 16px", background: "rgba(255,255,255,.06)", border: "1.5px solid rgba(255,255,255,.12)", borderRadius: 12, fontSize: 15, color: "#f8fafc", outline: "none", fontFamily: "inherit" }} />
              <button onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", fontSize: 18, cursor: "pointer", opacity: .5 }}>{showPass ? "🙈" : "👁️"}</button>
            </div>
          </div>
          <button onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: 14, background: loading ? "#475569" : "linear-gradient(135deg,#dc2626,#f97316)", border: "none", borderRadius: 12, color: "#fff", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: loading ? "none" : "0 4px 20px rgba(220,38,38,.4)" }}>
            {loading ? "กำลังเข้าสู่ระบบ..." : "🔓 เข้าสู่ระบบ"}
          </button>
        </div>
        {isDemo && (
          <div style={{ marginTop: 20, padding: 16, background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.2)", borderRadius: 14, fontSize: 12, color: "#fbbf24" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>⚠️ Demo — บัญชีทดสอบ:</div>
            <div style={{ display: "grid", gap: 4, fontFamily: "monospace", fontSize: 11 }}>
              <div>👑 admin / admin1234</div>
              <div>🚚 shipping1 / ship1234</div>
              <div>💰 accounting1 / acc1234</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USER MANAGEMENT (Admin only)
// ═══════════════════════════════════════════════════════════════
function UserManagement({ onClose, isDemo, inline }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", display_name: "", role: "shipping" });
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    if (isDemo) {
      setUsers([
        { id: "u1", username: "admin", display_name: "แอดมิน", role: "admin", is_active: true, last_login: "2026-04-04T10:00:00Z" },
        { id: "u2", username: "shipping1", display_name: "พนักงานจัดส่ง 1", role: "shipping", is_active: true, last_login: "2026-04-04T09:30:00Z" },
        { id: "u3", username: "accounting1", display_name: "พนักงานบัญชี 1", role: "accounting", is_active: true, last_login: "2026-04-03T16:00:00Z" },
      ]);
      setLoading(false); return;
    }
    try { const d = await sb.select("fx_users", { order: "created_at.asc" }); setUsers(d || []); } catch {}
    setLoading(false);
  }, [isDemo]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleAdd = async () => {
    if (!form.username || !form.password || !form.display_name) { alert("กรุณากรอกข้อมูลให้ครบ"); return; }
    setSaving(true);
    try {
      const hash = await sha256(form.password);
      await sb.insert("fx_users", { username: form.username.toLowerCase().trim(), password: hash, display_name: form.display_name, role: form.role });
      setShowAdd(false); setForm({ username: "", password: "", display_name: "", role: "shipping" }); loadUsers();
    } catch (e) { alert("Error: " + e.message); }
    setSaving(false);
  };

  const toggleActive = async (u) => {
    if (isDemo) return;
    try { await sb.update("fx_users", u.id, { is_active: !u.is_active }); loadUsers(); } catch (e) { alert(e.message); }
  };

  const resetPassword = async (u) => {
    const newPass = prompt(`รีเซ็ตรหัสผ่าน ${u.display_name}\nพิมพ์รหัสผ่านใหม่:`);
    if (!newPass) return;
    try { const hash = await sha256(newPass); await sb.update("fx_users", u.id, { password: hash }); alert("รีเซ็ตสำเร็จ"); } catch (e) { alert(e.message); }
  };

  const I = { width: "100%", padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, outline: "none", fontFamily: "inherit" };

  const renderContent = () => (<>
    <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>👥 จัดการผู้ใช้งาน</h2>
      <button onClick={() => setShowAdd(!showAdd)} style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>＋ เพิ่มผู้ใช้</button>
    </div>
    {showAdd && (
      <div style={{ padding: "16px 24px", background: "#fafafa", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อผู้ใช้ *</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="username" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>รหัสผ่าน *</label><input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="password" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อที่แสดง *</label><input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="ชื่อ-สกุล" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ตำแหน่ง</label><select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...I, background: "#fff" }}><option value="admin">👑 แอดมิน</option><option value="shipping">🚚 พนักงานจัดส่ง</option><option value="accounting">💰 พนักงานบัญชี</option></select></div>
        </div>
        <button onClick={handleAdd} disabled={saving} style={{ marginTop: 10, padding: "10px 20px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{saving ? "..." : "✅ บันทึก"}</button>
      </div>
    )}
    <div style={{ overflowY: "auto" }}>
      {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>กำลังโหลด...</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["ผู้ใช้", "ตำแหน่ง", "สถานะ", "เข้าล่าสุด", "จัดการ"].map((h, i) => <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 12, borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
          <tbody>{users.map(u => { const r = ROLES[u.role] || ROLES.shipping; return (
            <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "12px 14px" }}><div style={{ fontWeight: 600 }}>{u.display_name}</div><div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>@{u.username}</div></td>
              <td style={{ padding: "12px 14px" }}><span style={{ padding: "3px 10px", borderRadius: 20, background: r.bg, color: r.color, fontSize: 12, fontWeight: 600 }}>{r.icon} {r.label}</span></td>
              <td style={{ padding: "12px 14px" }}><span style={{ color: u.is_active ? "#059669" : "#dc2626", fontWeight: 600, fontSize: 12 }}>{u.is_active ? "🟢 ใช้งาน" : "🔴 ปิด"}</span></td>
              <td style={{ padding: "12px 14px", fontSize: 12, color: "#64748b" }}>{u.last_login ? new Date(u.last_login).toLocaleString("th-TH") : "—"}</td>
              <td style={{ padding: "12px 14px" }}><div style={{ display: "flex", gap: 4 }}>
                <button title="รีเซ็ต" onClick={() => resetPassword(u)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🔑</button>
                <button title={u.is_active ? "ปิด" : "เปิด"} onClick={() => toggleActive(u)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{u.is_active ? "🚫" : "✅"}</button>
              </div></td>
            </tr>); })}</tbody>
        </table>
      )}
    </div>
  </>);

  if (inline) return <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>{renderContent()}</div>;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 640, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {renderContent()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRINT LABEL 100x75mm
// ═══════════════════════════════════════════════════════════════
function PrintLabel({ parcel, onClose }) {
  const ref = useRef();
  const [barcodeUrl, setBarcodeUrl] = useState("");

  useEffect(() => {
    if (!parcel.flash_pno) return;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js";
    script.onload = () => {
      const canvas = document.createElement("canvas");
      try { window.JsBarcode(canvas, parcel.flash_pno, { format: "CODE128", width: 3, height: 80, displayValue: false, margin: 0 }); setBarcodeUrl(canvas.toDataURL("image/png")); } catch {}
    };
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, [parcel.flash_pno]);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html><head><style>@page{size:100mm 75mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{width:100mm;height:75mm;font-family:'Sarabun',sans-serif}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${ref.current.innerHTML}<script>var imgs=document.querySelectorAll('img'),loaded=0,total=imgs.length;if(!total)window.print();else{imgs.forEach(function(img){if(img.complete){loaded++;if(loaded>=total)window.print();}else{img.onload=img.onerror=function(){loaded++;if(loaded>=total)window.print();};}});setTimeout(function(){window.print();},5000);}</script></body></html>`);
    win.document.close();
  };

  const pno = parcel.flash_pno || "";
  const sc = parcel.flash_sort_code || "";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 480, width: "95%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🖨️ ใบปะหน้า</h3><button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button></div>
        <div ref={ref} style={{ border: "1px solid #ccc" }}>
          <div style={{ width: "100mm", height: "75mm", fontFamily: "'Sarabun',sans-serif", border: "0.3mm solid #000", overflow: "hidden", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
            {/* Sort Code — ด้านบนสุด ตัวใหญ่ */}
            <div style={{ background: "#333", color: "#fff", display: "flex", alignItems: "center" }}>
              {sc && <div style={{ background: "#e67e22", color: "#fff", fontSize: "8pt", fontWeight: 900, padding: "1mm 2mm", minWidth: "6mm", textAlign: "center" }}>⚡</div>}
              <div style={{ flex: 1, textAlign: "center", fontSize: sc ? "16pt" : "10pt", fontWeight: 900, padding: "0.5mm 2mm", letterSpacing: "1px" }}>{sc || "FLASH EXPRESS"}</div>
            </div>
            {/* Barcode — เต็มความกว้าง ชัดมาก */}
            {pno && <div style={{ textAlign: "center", padding: "1mm 3mm 0" }}>
              {barcodeUrl ? <img src={barcodeUrl} style={{ width: "90mm", height: "11mm", display: "block", margin: "0 auto" }} alt="" /> : <div style={{ height: "11mm" }} />}
            </div>}
            {/* Tracking Number */}
            <div style={{ background: "#f5f5f5", textAlign: "center", fontSize: "11pt", fontWeight: 900, fontFamily: "monospace", letterSpacing: "1.5px", padding: "0.5mm", borderTop: "0.3mm solid #ccc", borderBottom: "0.3mm solid #ccc" }}>{pno || "—"}</div>
            {/* DST — อำเภอ — จังหวัด */}
            <div style={{ background: "#555", color: "#fff", fontSize: "7pt", fontWeight: 700, padding: "0.5mm 2mm" }}>DST &nbsp; {parcel.receiver_district || ""} — {parcel.receiver_province || ""}</div>
            {/* ผู้ส่ง — บรรทัดเดียว เล็ก */}
            <div style={{ fontSize: "5.5pt", color: "#666", padding: "0.5mm 2mm", borderBottom: "0.2mm solid #ddd" }}>ผู้ส่ง {parcel.sender_name} {parcel.sender_phone} {parcel.sender_address} {parcel.sender_province} {parcel.sender_postal}</div>
            {/* ผู้รับ + ที่อยู่ + QR */}
            <div style={{ display: "flex", flex: 1, padding: "0.5mm 2mm" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "8pt", fontWeight: 800 }}>ผู้รับ {parcel.receiver_name}</div>
                <div style={{ fontSize: "11pt", fontWeight: 900, fontFamily: "monospace" }}>{(parcel.receiver_phone || "").replace(/^(\d{3})\d{4}(\d{3})$/, "$1****$2")}</div>
                <div style={{ fontSize: "6pt", lineHeight: 1.3, marginTop: "0.5mm" }}>
                  {parcel.receiver_address}<br/>
                  {parcel.receiver_subdistrict}{parcel.receiver_subdistrict ? ", " : ""}{parcel.receiver_district}<br/>
                  {parcel.receiver_province} {parcel.receiver_postal}
                </div>
              </div>
              {pno && <img src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${pno}&margin=0`} style={{ width: "16mm", height: "16mm", alignSelf: "center" }} alt="" />}
            </div>
            {/* COD */}
            {parcel.cod_enabled && <div style={{ background: "#000", display: "flex", alignItems: "center", padding: "0.8mm 2mm" }}>
              <span style={{ background: "#fff", color: "#000", fontSize: "6pt", fontWeight: 900, padding: "0.3mm 1.5mm", marginRight: "2mm" }}>COD</span>
              <span style={{ color: "#fff", fontSize: "12pt", fontWeight: 900 }}>เก็บเงินค่าสินค้า COD {Number(parcel.cod_amount || 0).toLocaleString()}</span>
            </div>}
            {/* Note */}
            {parcel.remark && <div style={{ fontSize: "7pt", fontWeight: 700, padding: "0.5mm 2mm", borderTop: "0.2mm solid #999", background: "#f9f9f9" }}>Note: {parcel.remark}</div>}
            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "4.5pt", color: "#999", padding: "0.3mm 2mm", borderTop: "0.2mm solid #ddd", marginTop: "auto" }}>
              <span>Print: {new Date().toLocaleString("th-TH")}</span>
              <span>{parcel.weight || 1}kg</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={handlePrint} style={{ flex: 1, padding: 12, background: "#e53e3e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>🖨️ ปริ้นลาเบล</button>
          <button onClick={onClose} style={{ padding: "12px 24px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARCEL FORM
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// ADDRESS PARSER — วางที่อยู่แล้วจับอัตโนมัติ
// ═══════════════════════════════════════════════════════════════
function parseThaiAddress(raw) {
  const r = { name: "", phone: "", address: "", subdistrict: "", district: "", province: "", postal: "" };
  if (!raw) return r;
  const lines = raw.replace(/\r/g, "").split("\n").map(s => s.trim()).filter(Boolean);
  const full = lines.join(" ");
  // Phone
  const phoneMatch = full.match(/(\d[\d-]{8,})/);
  if (phoneMatch) r.phone = phoneMatch[1].replace(/-/g, "");
  // Postal → auto-fill from ADDR_DB
  const postalMatch = full.match(/\b(\d{5})\b/);
  if (postalMatch) {
    r.postal = postalMatch[1];
    const addrList = ADDR_DB[r.postal];
    if (addrList?.length) {
      r.province = addrList[0].p;
      r.district = addrList[0].d;
      r.subdistrict = addrList[0].s;
    }
  }
  // Province
  const provMatch = full.match(/(จ\.|จังหวัด)\s*([ก-๙]+)/);
  if (provMatch) r.province = provMatch[2];
  else { for (const p of PROVINCES) { if (full.includes(p)) { r.province = p; break; } } }
  // District
  const distMatch = full.match(/(อ\.|อำเภอ|เขต)\s*([ก-๙]+)/);
  if (distMatch) r.district = distMatch[2];
  // Subdistrict
  const subMatch = full.match(/(ต\.|ตำบล|แขวง)\s*([ก-๙]+)/);
  if (subMatch) r.subdistrict = subMatch[2];
  // Name — first line or text before phone/address
  if (lines.length >= 2) r.name = lines[0].replace(/(\d[\d-]{8,})/, "").trim();
  else r.name = full.split(/\d{3}/)[0]?.trim() || "";
  // Remove phone from name
  if (r.phone && r.name.includes(r.phone)) r.name = r.name.replace(r.phone, "").trim();
  // Address — everything else
  let addr = full;
  [r.name, r.phone, `จ.${r.province}`, `จังหวัด${r.province}`, r.province, `อ.${r.district}`, `อำเภอ${r.district}`, `เขต${r.district}`, `ต.${r.subdistrict}`, `ตำบล${r.subdistrict}`, `แขวง${r.subdistrict}`, r.postal].forEach(v => { if (v) addr = addr.replace(v, ""); });
  r.address = addr.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  return r;
}

// ═══════════════════════════════════════════════════════════════
// PARCEL FORM — with Shop selector + Address parser
// ═══════════════════════════════════════════════════════════════
function ParcelForm({ parcel, user, shops, onSave, onClose }) {
  const isEdit = !!parcel?.id;
  const [form, setForm] = useState(parcel || { sender_name: "", sender_phone: "", sender_address: "", sender_province: "", receiver_name: "", receiver_phone: "", receiver_address: "", receiver_province: "", receiver_district: "", receiver_subdistrict: "", receiver_postal: "", weight: 1, item_desc: "", quantity: 1, cod_enabled: false, cod_amount: 0, remark: "" });
  const [saving, setSaving] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [rawAddr, setRawAddr] = useState("");

  // โหลดข้อมูลร้านค้าเริ่มต้น
  useEffect(() => {
    if (!isEdit && shops?.length) {
      const def = shops.find(s => s.is_default) || shops[0];
      if (def) setForm(f => ({ ...f, sender_name: def.name || "", sender_phone: def.phone || "", sender_address: def.address || "", sender_province: def.province || "", sender_postal: def.postal || "", sender_district: def.district || "", sender_subdistrict: def.subdistrict || "", shop_id: def.id }));
    }
  }, [isEdit, shops]);

  const selectShop = (shopId) => {
    const shop = shops?.find(s => s.id === shopId);
    if (shop) setForm(f => ({ ...f, sender_name: shop.name || "", sender_phone: shop.phone || "", sender_address: shop.address || "", sender_province: shop.province || "", sender_postal: shop.postal || "", sender_district: shop.district || "", sender_subdistrict: shop.subdistrict || "", shop_id: shop.id }));
  };

  const handleParseAddress = () => {
    const parsed = parseThaiAddress(rawAddr);
    setForm(f => ({
      ...f,
      receiver_name: parsed.name || f.receiver_name,
      receiver_phone: parsed.phone || f.receiver_phone,
      receiver_address: parsed.address || f.receiver_address,
      receiver_subdistrict: parsed.subdistrict || f.receiver_subdistrict,
      receiver_district: parsed.district || f.receiver_district,
      receiver_province: parsed.province || f.receiver_province,
      receiver_postal: parsed.postal || f.receiver_postal,
    }));
    setPasteMode(false);
    setRawAddr("");
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => {
    if (!form.receiver_name || !form.receiver_phone) { alert("กรุณากรอกชื่อ+เบอร์ผู้รับ"); return; }
    setSaving(true);
    try { const d = { ...form }; delete d.id; delete d.created_at; delete d.updated_at; if (isEdit) { await sb.update("fx_parcels", parcel.id, d); } else { d.parcel_no = generateParcelNo(); d.status = "draft"; d.created_by = user.id; d.created_by_name = user.display_name; await sb.insert("fx_parcels", d); } onSave(); } catch (e) { alert(e.message); }
    setSaving(false);
  };
  const I = { width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit" };
  const L = { display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 };
  const F = ({ label, k, ph, type = "text", span }) => <div style={{ gridColumn: span ? `span ${span}` : undefined }}><label style={L}>{label}</label><input type={type} value={form[k] || ""} onChange={e => set(k, type === "number" ? +e.target.value : e.target.value)} placeholder={ph} style={I} /></div>;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 30, overflowY: "auto" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 680, marginBottom: 40, overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)", padding: "20px 24px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{isEdit ? "✏️ แก้ไข" : "📦 สร้างพัสดุใหม่"}</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: 10, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 24, maxHeight: "70vh", overflowY: "auto" }}>
          {/* ═══ เลือกร้านค้า ═══ */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>🏪 ร้านค้า / ผู้ส่ง</h3>
            {shops?.length > 0 && (
              <select value={form.shop_id || ""} onChange={e => selectShop(e.target.value)} style={{ padding: "6px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", fontWeight: 600, color: "#dc2626" }}>
                <option value="">-- เลือกร้าน --</option>
                {shops.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="ชื่อ" k="sender_name" ph="ร้าน" /><F label="เบอร์" k="sender_phone" ph="08X..." />
            <F label="ที่อยู่" k="sender_address" ph="ที่อยู่" span={2} />
            <div><label style={L}>จังหวัด</label><select value={form.sender_province || ""} onChange={e => set("sender_province", e.target.value)} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
            <F label="ไปรษณีย์" k="sender_postal" ph="XXXXX" />
          </div>

          {/* ═══ ผู้รับ + ปุ่มวางที่อยู่ ═══ */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>📥 ผู้รับ</h3>
            <button onClick={() => setPasteMode(!pasteMode)} style={{ padding: "6px 14px", background: pasteMode ? "#dc2626" : "#eef2ff", color: pasteMode ? "#fff" : "#4f46e5", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
              {pasteMode ? "✕ ปิด" : "📋 วางที่อยู่อัตโนมัติ"}
            </button>
          </div>

          {pasteMode && (
            <div style={{ marginBottom: 16, padding: 14, background: "#eef2ff", borderRadius: 12, border: "1.5px solid #c7d2fe" }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#4f46e5", marginBottom: 6, display: "block" }}>วางชื่อ + ที่อยู่ทั้งหมดตรงนี้ ระบบจะจับอัตโนมัติ</label>
              <textarea value={rawAddr} onChange={e => setRawAddr(e.target.value)} rows={4} placeholder={"สมชาย ใจดี 0891112222\n456 ม.5 ต.บ้านนา อ.เมือง จ.นครสวรรค์ 60000"} style={{ ...I, resize: "vertical", fontSize: 13, borderColor: "#a5b4fc" }} />
              <button onClick={handleParseAddress} disabled={!rawAddr.trim()} style={{ marginTop: 8, padding: "8px 20px", background: rawAddr.trim() ? "#4f46e5" : "#94a3b8", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: rawAddr.trim() ? "pointer" : "not-allowed" }}>⚡ จับที่อยู่อัตโนมัติ</button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="ชื่อ *" k="receiver_name" ph="ชื่อ" /><F label="เบอร์ *" k="receiver_phone" ph="08X..." />
            <F label="ที่อยู่" k="receiver_address" ph="ที่อยู่" span={2} />
            <div style={{ gridColumn: "span 2" }}>
              <label style={L}>รหัสไปรษณีย์ (พิมพ์แล้วเติมที่อยู่อัตโนมัติ)</label>
              <input value={form.receiver_postal || ""} onChange={e => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                set("receiver_postal", v);
                if (v.length === 5 && ADDR_DB[v]) {
                  const list = ADDR_DB[v];
                  if (list.length === 1) {
                    set("receiver_province", list[0].p); set("receiver_district", list[0].d); set("receiver_subdistrict", list[0].s);
                    setForm(f => ({ ...f, receiver_postal: v, receiver_province: list[0].p, receiver_district: list[0].d, receiver_subdistrict: list[0].s }));
                  }
                }
              }} placeholder="XXXXX → เติมจังหวัด อำเภอ ตำบล อัตโนมัติ" style={{ ...I, borderColor: "#6366f1", fontWeight: 600 }} />
              {form.receiver_postal?.length === 5 && ADDR_DB[form.receiver_postal]?.length > 1 && (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {ADDR_DB[form.receiver_postal].map((a, i) => (
                    <button key={i} onClick={() => setForm(f => ({ ...f, receiver_province: a.p, receiver_district: a.d, receiver_subdistrict: a.s }))}
                      style={{ padding: "4px 10px", fontSize: 11, border: form.receiver_subdistrict === a.s && form.receiver_district === a.d ? "2px solid #6366f1" : "1px solid #e2e8f0", borderRadius: 8, background: form.receiver_subdistrict === a.s && form.receiver_district === a.d ? "#eef2ff" : "#fff", cursor: "pointer", fontWeight: 500 }}>
                      {a.s} · {a.d}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <F label="ตำบล" k="receiver_subdistrict" ph="ตำบล" /><F label="อำเภอ" k="receiver_district" ph="อำเภอ" />
            <div><label style={L}>จังหวัด</label><select value={form.receiver_province || ""} onChange={e => set("receiver_province", e.target.value)} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
          </div>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>📦 พัสดุ</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="น้ำหนัก (kg)" k="weight" type="number" /><F label="จำนวน" k="quantity" type="number" /><F label="สินค้า" k="item_desc" ph="สินค้า" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>💰 COD</h3>
            <div onClick={() => set("cod_enabled", !form.cod_enabled)} style={{ width: 44, height: 24, borderRadius: 12, background: form.cod_enabled ? "#059669" : "#d1d5db", cursor: "pointer", position: "relative" }}><div style={{ width: 20, height: 20, borderRadius: 10, background: "#fff", position: "absolute", top: 2, left: form.cod_enabled ? 22 : 2, transition: ".2s" }} /></div>
          </div>
          {form.cod_enabled && <F label="จำนวนเงิน (บาท)" k="cod_amount" type="number" />}
          <div style={{ marginTop: 16 }}><label style={L}>หมายเหตุ</label><textarea value={form.remark || ""} onChange={e => set("remark", e.target.value)} rows={2} style={{ ...I, resize: "vertical" }} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: 14, background: saving ? "#94a3b8" : "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{saving ? "..." : isEdit ? "💾 บันทึก" : "📦 สร้าง"}</button>
          <button onClick={onClose} style={{ padding: "14px 28px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT EXCEL MODAL
// ═══════════════════════════════════════════════════════════════
function ImportModal({ user, shops, onSave, onClose, inline }) {
  const [rows, setRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [selectedShop, setSelectedShop] = useState(shops?.find(s => s.is_default)?.id || shops?.[0]?.id || "");
  const fileRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      // Find header row — row that has values in multiple columns (not just col 0)
      let headerIdx = 0;
      for (let i = 0; i < Math.min(5, data.length); i++) {
        const row = data[i];
        const filledCols = row.filter((v, j) => j > 0 && v && String(v).trim()).length;
        const rowText = row.map(String).join("|").toLowerCase();
        if (filledCols >= 3 && (rowText.includes("mobile") || rowText.includes("name") || rowText.includes("ชื่อ"))) { headerIdx = i; break; }
      }
      const parsed = [];
      for (let i = headerIdx + 1; i < data.length; i++) {
        const r = data[i];
        if (!r || !r[0]) continue;
        const phone = String(r[0] || "").replace(/[^0-9]/g, "");
        const name = String(r[1] || "");
        const address = String(r[2] || "");
        const subdistrict = String(r[3] || "");
        const district = String(r[4] || "");
        const postal = String(r[5] || "").replace(/[^0-9]/g, "");
        const codAmount = parseFloat(r[10]) || 0;
        const remark = String(r[11] || "");
        if (!phone && !name) continue;

        // Auto-fill province from postal code
        let province = "";
        let autoDistrict = district;
        let autoSubdistrict = subdistrict;
        if (postal && ADDR_DB[postal]) {
          const addrList = ADDR_DB[postal];
          province = addrList[0]?.p || "";
          // Try to match district/subdistrict
          if (!autoDistrict && addrList.length === 1) autoDistrict = addrList[0].d;
          if (!autoSubdistrict && addrList.length === 1) autoSubdistrict = addrList[0].s;
          // If district provided, find matching entry
          if (district) {
            const match = addrList.find(a => a.d === district);
            if (match) { province = match.p; if (!autoSubdistrict) autoSubdistrict = match.s; }
          }
        }

        parsed.push({
          receiver_phone: phone.startsWith("0") ? phone : "0" + phone,
          receiver_name: name,
          receiver_address: address,
          receiver_subdistrict: autoSubdistrict,
          receiver_district: autoDistrict,
          receiver_province: province,
          receiver_postal: postal,
          cod_enabled: codAmount > 0,
          cod_amount: codAmount,
          item_desc: String(r[7] || ""),
          remark: remark,
          _selected: true,
        });
      }
      setRows(parsed);
    } catch (err) { alert("อ่านไฟล์ไม่ได้: " + err.message); }
  };

  const handleImport = async () => {
    const selected = rows.filter(r => r._selected);
    if (!selected.length) { alert("ไม่มีรายการที่เลือก"); return; }
    const shop = shops?.find(s => s.id === selectedShop);
    setImporting(true);
    let success = 0;
    for (let i = 0; i < selected.length; i++) {
      const r = selected[i];
      try {
        const parcelData = {
          parcel_no: generateParcelNo(),
          status: "draft",
          sender_name: shop?.name || "", sender_phone: shop?.phone || "", sender_address: shop?.address || "",
          sender_province: shop?.province || "", sender_district: shop?.district || "",
          sender_subdistrict: shop?.subdistrict || "", sender_postal: shop?.postal || "",
          receiver_name: r.receiver_name, receiver_phone: r.receiver_phone, receiver_address: r.receiver_address || "-",
          receiver_subdistrict: r.receiver_subdistrict, receiver_district: r.receiver_district,
          receiver_province: r.receiver_province || "", receiver_postal: r.receiver_postal,
          weight: 1, quantity: 1, item_desc: r.item_desc || "",
          cod_enabled: r.cod_enabled, cod_amount: r.cod_amount || 0,
          remark: r.remark || "",
          created_by: user.id, created_by_name: user.display_name, shop_id: selectedShop || null,
        };
        await sb.insert("fx_parcels", parcelData);
        success++;
      } catch (err) { console.warn("Import failed:", r.receiver_name, err.message); }
      setProgress(Math.round(((i + 1) / selected.length) * 100));
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 500));
    }
    setDone(true);
    const failed = selected.length - success;
    if (failed > 0) alert(`นำเข้าสำเร็จ ${success}/${selected.length} รายการ\n\n${failed} รายการล้มเหลว — ตรวจสอบข้อมูลในไฟล์`);
    setTimeout(() => onSave(), 1000);
  };

  const toggleRow = (i) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, _selected: !r._selected } : r));
  const toggleAll = () => { const allSel = rows.every(r => r._selected); setRows(prev => prev.map(r => ({ ...r, _selected: !allSel }))); };

  if (inline) return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>🏪 ร้านผู้ส่ง:</label>
        <select value={selectedShop} onChange={e => setSelectedShop(e.target.value)} style={{ padding: "8px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit", minWidth: 200 }}><option value="">--</option>{shops?.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </div>
      {rows.length === 0 && !importing && (<>
        <div onClick={() => fileRef.current?.click()} style={{ border: "2px dashed #d1d5db", borderRadius: 16, padding: 50, textAlign: "center", cursor: "pointer", background: "#fff" }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#475569" }}>คลิกเลือกไฟล์ หรือ ลากวาง</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>รองรับ .csv .xlsx .xls</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
        </div>
        <div style={{ marginTop: 16, padding: 16, background: "#fef9c3", borderRadius: 12, border: "1px solid #fde68a" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>📋 คอลัมน์ที่ต้องมี</div>
          <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>ชื่อ, เบอร์โทร, ที่อยู่, ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์, COD, หมายเหตุ</div>
          <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>* ชื่อคอลัมน์ภาษาไทยหรืออังกฤษก็ได้ ระบบจับอัตโนมัติ</div>
        </div>
      </>)}
      {rows.length > 0 && !importing && (<>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><span style={{ fontSize: 14, fontWeight: 700 }}>พบ {rows.length} รายการ</span><button onClick={toggleAll} style={{ padding: "6px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{rows.every(r => r._selected) ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</button></div>
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ background: "#f8fafc" }}><th style={{ padding: 8, width: 30 }}>✓</th><th style={{ padding: 8, textAlign: "left" }}>ชื่อ</th><th style={{ padding: 8, textAlign: "left" }}>เบอร์</th><th style={{ padding: 8, textAlign: "left" }}>อำเภอ</th><th style={{ padding: 8, textAlign: "right" }}>COD</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: "1px solid #f1f5f9", opacity: r._selected ? 1 : .4 }}><td style={{ padding: 8, textAlign: "center" }}><input type="checkbox" checked={r._selected} onChange={() => toggleRow(i)} /></td><td style={{ padding: 8, fontWeight: 600 }}>{r.receiver_name}</td><td style={{ padding: 8, fontFamily: "monospace" }}>{r.receiver_phone}</td><td style={{ padding: 8 }}>{r.receiver_district}</td><td style={{ padding: 8, textAlign: "right", fontWeight: 600, color: r.cod_amount > 0 ? "#d97706" : "#cbd5e1" }}>{r.cod_amount > 0 ? `฿${r.cod_amount}` : "—"}</td></tr>)}</tbody></table></div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button onClick={handleImport} style={{ flex: 1, padding: 14, background: "#059669", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>📥 นำเข้า {rows.filter(r => r._selected).length} รายการ</button><button onClick={() => setRows([])} style={{ padding: "14px 20px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>เลือกไฟล์ใหม่</button></div>
      </>)}
      {importing && <div style={{ padding: 40, textAlign: "center" }}><div style={{ fontSize: 40 }}>{done ? "✅" : "⏳"}</div><div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>{done ? "สำเร็จ!" : `กำลังนำเข้า... ${progress}%`}</div><div style={{ width: "100%", height: 8, background: "#e2e8f0", borderRadius: 4, marginTop: 12 }}><div style={{ width: `${progress}%`, height: "100%", background: "#059669", borderRadius: 4 }} /></div></div>}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 30, overflowY: "auto" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 800, marginBottom: 40, overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg,#059669,#10b981)", padding: "20px 24px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>📥 Import Excel</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: 10, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 24, maxHeight: inline ? "none" : "75vh", overflowY: "auto" }}>
          {/* เลือกร้าน */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>🏪 ร้านผู้ส่ง:</label>
            <select value={selectedShop} onChange={e => setSelectedShop(e.target.value)} style={{ padding: "8px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit", flex: 1, minWidth: 150 }}>
              <option value="">-- เลือกร้าน --</option>
              {shops?.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* เลือกไฟล์ */}
          {rows.length === 0 && (
            <div onClick={() => fileRef.current?.click()} style={{ border: "2px dashed #d1d5db", borderRadius: 16, padding: 40, textAlign: "center", cursor: "pointer", background: "#fafafa" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#475569" }}>คลิกเพื่อเลือกไฟล์ Excel</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>รองรับ .xlsx, .xls (รูปแบบ Flash Express)</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
            </div>
          )}

          {/* แสดงข้อมูลที่อ่านได้ */}
          {rows.length > 0 && !importing && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>พบ {rows.length} รายการ (เลือก {rows.filter(r => r._selected).length})</span>
                <button onClick={toggleAll} style={{ padding: "6px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{rows.every(r => r._selected) ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</button>
              </div>
              <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: 8, width: 30 }}>✓</th>
                    <th style={{ padding: 8, textAlign: "left" }}>ชื่อ</th>
                    <th style={{ padding: 8, textAlign: "left" }}>เบอร์</th>
                    <th style={{ padding: 8, textAlign: "left" }}>อำเภอ</th>
                    <th style={{ padding: 8, textAlign: "right" }}>COD</th>
                  </tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9", opacity: r._selected ? 1 : .4 }}>
                      <td style={{ padding: 8, textAlign: "center" }}><input type="checkbox" checked={r._selected} onChange={() => toggleRow(i)} /></td>
                      <td style={{ padding: 8, fontWeight: 600 }}>{r.receiver_name}</td>
                      <td style={{ padding: 8, fontFamily: "monospace" }}>{r.receiver_phone}</td>
                      <td style={{ padding: 8 }}>{r.receiver_district}</td>
                      <td style={{ padding: 8, textAlign: "right", fontWeight: 600, color: r.cod_amount > 0 ? "#d97706" : "#cbd5e1" }}>{r.cod_amount > 0 ? `฿${r.cod_amount}` : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}

          {/* Progress */}
          {importing && (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{done ? "✅" : "⏳"}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>{done ? "นำเข้าสำเร็จ!" : `กำลังนำเข้า... ${progress}%`}</div>
              <div style={{ width: "100%", height: 8, background: "#e2e8f0", borderRadius: 4, marginTop: 12 }}>
                <div style={{ width: `${progress}%`, height: "100%", background: "#059669", borderRadius: 4, transition: ".3s" }} />
              </div>
            </div>
          )}
        </div>
        {rows.length > 0 && !importing && (
          <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 10 }}>
            <button onClick={handleImport} disabled={!rows.some(r => r._selected)} style={{ flex: 1, padding: 14, background: rows.some(r => r._selected) ? "#059669" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>📥 นำเข้า {rows.filter(r => r._selected).length} รายการ</button>
            <button onClick={() => { setRows([]); }} style={{ padding: "14px 20px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>เลือกไฟล์ใหม่</button>
            <button onClick={onClose} style={{ padding: "14px 20px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHOP MANAGEMENT MODAL
// ═══════════════════════════════════════════════════════════════
function ShopManagement({ onClose, onUpdate, isDemo, inline }) {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", province: "", postal: "", flash_mch_id: FLASH_ACCOUNTS[0]?.mchId || "" });
  const [saving, setSaving] = useState(false);
  const I = { width: "100%", padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, outline: "none", fontFamily: "inherit" };

  const load = useCallback(async () => {
    if (isDemo) { setShops([{ id: "s1", name: "ร้าน ABC Shop", phone: "081-234-5678", address: "123 สุขุมวิท", province: "กรุงเทพมหานคร", postal: "10110", is_default: true, is_active: true }]); setLoading(false); return; }
    try { const d = await sb.select("fx_shops", { order: "created_at.asc" }); setShops(d || []); } catch {} setLoading(false);
  }, [isDemo]);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditId(null); setForm({ name: "", phone: "", address: "", province: "", postal: "", flash_mch_id: FLASH_ACCOUNTS[0]?.mchId || "" }); setShowForm(true); };
  const openEdit = (s) => { setEditId(s.id); setForm({ name: s.name || "", phone: s.phone || "", address: s.address || "", province: s.province || "", postal: s.postal || "", flash_mch_id: s.flash_mch_id || FLASH_ACCOUNTS[0]?.mchId || "" }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.name || !form.phone) { alert("กรุณากรอกชื่อร้าน + เบอร์โทร"); return; }
    setSaving(true);
    try {
      if (editId) { await sb.update("fx_shops", editId, form); }
      else { await sb.insert("fx_shops", { ...form, is_active: true, is_default: shops.length === 0 }); }
      setShowForm(false); load(); onUpdate?.();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const toggleDefault = async (s) => {
    if (isDemo) return;
    try {
      const currentDefault = shops.find(sh => sh.is_default);
      if (currentDefault && currentDefault.id !== s.id) await sb.update("fx_shops", currentDefault.id, { is_default: false });
      await sb.update("fx_shops", s.id, { is_default: true }); load(); onUpdate?.();
    } catch (e) { alert(e.message); }
  };

  const deleteShop = async (s) => {
    if (!confirm(`ลบร้าน ${s.name}?`)) return;
    try { await sb.delete("fx_shops", s.id); load(); onUpdate?.(); } catch (e) { alert(e.message); }
  };

  const renderContent = () => (<>
    <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🏪 จัดการร้านค้า / ผู้ส่ง</h2>
      <button onClick={openAdd} style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>＋ เพิ่มร้าน</button>
    </div>
    {showForm && (
      <div style={{ padding: "16px 24px", background: "#fafafa", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#1e293b" }}>{editId ? "✏️ แก้ไขร้านค้า" : "＋ เพิ่มร้านใหม่"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อร้าน *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ชื่อร้าน" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>เบอร์โทร *</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08X..." style={I} /></div>
          <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ที่อยู่</label><input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="บ้านเลขที่ ถนน ซอย ตำบล อำเภอ จังหวัด รหัสไปรษณีย์" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>จังหวัด</label><select value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>รหัสไปรษณีย์</label><input value={form.postal} onChange={e => setForm(f => ({ ...f, postal: e.target.value }))} placeholder="XXXXX" style={I} /></div>
          <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 12, fontWeight: 600, color: "#dc2626" }}>⚡ บัญชี Flash Express</label><select value={form.flash_mch_id} onChange={e => setForm(f => ({ ...f, flash_mch_id: e.target.value }))} style={{ ...I, background: "#fff", borderColor: "#fbbf24" }}>{FLASH_ACCOUNTS.map(a => <option key={a.mchId} value={a.mchId}>{a.name} ({a.mchId})</option>)}</select></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ padding: "10px 20px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>{saving ? "..." : editId ? "💾 บันทึก" : "✅ เพิ่มร้าน"}</button>
          <button onClick={() => setShowForm(false)} style={{ padding: "10px 20px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
        </div>
      </div>
    )}
    <div style={{ overflowY: "auto" }}>
      {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>โหลด...</div> :
      shops.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>ยังไม่มีร้านค้า — กด "＋ เพิ่มร้าน"</div> :
      shops.map(s => (
        <div key={s.id} style={{ padding: "14px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name} {s.is_default && <span style={{ fontSize: 10, background: "#ecfdf5", color: "#059669", padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginLeft: 6 }}>ค่าเริ่มต้น</span>}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{s.phone} · {s.address} {s.province} {s.postal}</div>
            <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>⚡ {s.flash_mch_id || FLASH_ACCOUNTS[0]?.mchId}</div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button title="แก้ไข" onClick={() => openEdit(s)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>
            {!s.is_default && <button title="ตั้งเป็นค่าเริ่มต้น" onClick={() => toggleDefault(s)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>⭐</button>}
            <button title="ลบ" onClick={() => deleteShop(s)} style={{ width: 30, height: 30, border: "1px solid #fca5a5", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑️</button>
          </div>
        </div>
      ))}
    </div>
  </>);

  if (inline) return <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>{renderContent()}</div>;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 560, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>{renderContent()}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATUS MODAL
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function FlashBackend() {
  const [user, setUser] = useState(() => {
    try { const s = sessionStorage.getItem("fx_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const handleLogin = (u) => { setUser(u); try { sessionStorage.setItem("fx_user", JSON.stringify(u)); } catch {} };
  const handleLogout = () => { setUser(null); setParcels([]); try { sessionStorage.removeItem("fx_user"); } catch {} };
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editParcel, setEditParcel] = useState(null);
  const [printParcel, setPrintParcel] = useState(null);
  const [viewParcel, setViewParcel] = useState(null);
  const [shops, setShops] = useState([]);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [activePage, setActivePage] = useState("parcels");
  const [selectedShopFilter, setSelectedShopFilter] = useState("");
  const PER_PAGE = 20;
  const isDemo = SUPABASE_URL.includes("YOUR_PROJECT");
  const perm = user ? (CAN[user.role] || {}) : {};

  const demoData = useMemo(() => [
    { id: "d1", parcel_no: "FX-260404-0001", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "สมชาย ใจดี", receiver_phone: "089-111-2222", receiver_address: "456 ม.5", receiver_province: "นครสวรรค์", receiver_district: "เมือง", receiver_subdistrict: "ปากน้ำโพ", receiver_postal: "60000", weight: 1.5, cod_enabled: true, cod_amount: 890, status: "created", flash_pno: "TH44128DA70M5A", flash_sort_code: "NSN-01-A", item_desc: "เสื้อผ้า", label_printed: true, created_by_name: "พนักงานจัดส่ง 1", created_at: "2026-04-04T08:30:00Z", updated_at: "2026-04-04T09:00:00Z" },
    { id: "d2", parcel_no: "FX-260404-0002", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "วิภา แก้วงาม", receiver_phone: "085-333-4444", receiver_address: "78 ซ.รามคำแหง 24", receiver_province: "กรุงเทพมหานคร", receiver_district: "บางกะปิ", receiver_subdistrict: "หัวหมาก", receiver_postal: "10240", weight: 0.5, cod_enabled: false, cod_amount: 0, status: "in_transit", flash_pno: "TH44128DA70K4A", flash_sort_code: "BKK-24-C", item_desc: "เคสมือถือ", label_printed: true, created_by_name: "แอดมิน", created_at: "2026-04-04T09:15:00Z", updated_at: "2026-04-04T10:30:00Z" },
    { id: "d3", parcel_no: "FX-260404-0003", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "นภา สุขสบาย", receiver_phone: "062-555-6666", receiver_address: "9/1 นิมมาน", receiver_province: "เชียงใหม่", receiver_district: "เมือง", receiver_subdistrict: "สุเทพ", receiver_postal: "50200", weight: 2, cod_enabled: true, cod_amount: 1250, status: "delivered", flash_pno: "TH44128DA70J9A", flash_sort_code: "CNX-01-B", item_desc: "รองเท้า", label_printed: true, created_by_name: "พนักงานจัดส่ง 1", created_at: "2026-04-03T14:00:00Z", updated_at: "2026-04-04T11:20:00Z" },
    { id: "d4", parcel_no: "FX-260404-0004", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "ประเสริฐ มั่งมี", receiver_phone: "091-777-8888", receiver_address: "222 ม.3", receiver_province: "นครราชสีมา", receiver_district: "เมือง", receiver_subdistrict: "ในเมือง", receiver_postal: "30000", weight: 3.5, cod_enabled: true, cod_amount: 2100, status: "draft", flash_pno: "", flash_sort_code: "", item_desc: "เครื่องสำอาง", label_printed: false, created_by_name: "แอดมิน", created_at: "2026-04-04T11:45:00Z", updated_at: "2026-04-04T11:45:00Z" },
  ], []);

  const loadParcels = useCallback(async () => {
    if (isDemo) { setParcels(demoData); setLoading(false); return; }
    setLoading(true);
    try { const d = await sb.select("fx_parcels", { order: "created_at.desc" }); setParcels(d || []); } catch {} setLoading(false);
  }, [isDemo, demoData]);

  useEffect(() => { if (user) loadParcels(); }, [user, loadParcels]);

  // Load shops
  const loadShops = useCallback(async () => {
    if (isDemo) { setShops([{ id: "s1", name: "ร้าน ABC Shop", phone: "081-234-5678", address: "123 สุขุมวิท", province: "กรุงเทพมหานคร", is_default: true, is_active: true }, { id: "s2", name: "ร้าน XYZ Online", phone: "089-999-8888", address: "456 พหลโยธิน", province: "เชียงใหม่", is_default: false, is_active: true }]); return; }
    try { const d = await sb.select("fx_shops", { order: "created_at.asc" }); setShops(d || []); } catch {}
  }, [isDemo]);
  useEffect(() => { if (user) loadShops(); }, [user, loadShops]);

  const STATUS_TABS = [
    { key: "ALL", label: "ทั้งหมด", icon: "📋", color: "#475569" },
    { key: "draft", label: "เตรียมส่ง", icon: "📝", color: "#f59e0b" },
    { key: "created", label: "สร้างเลขพัสดุแล้ว", icon: "✅", color: "#059669" },
  ];

  const filtered = useMemo(() => {
    let list = parcels;
    if (selectedShopFilter) list = list.filter(p => p.shop_id === selectedShopFilter);
    if (statusFilter !== "ALL") list = list.filter(p => p.status === statusFilter);
    if (search) { const q = search.toLowerCase(); list = list.filter(p => [p.parcel_no, p.receiver_name, p.receiver_phone, p.flash_pno, p.receiver_province, p.created_by_name].some(v => (v || "").toLowerCase().includes(q))); }
    return list;
  }, [parcels, search, selectedShopFilter, statusFilter]);

  const paged = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const statsData = useMemo(() => { const list = selectedShopFilter ? parcels.filter(p => p.shop_id === selectedShopFilter) : parcels; return list; }, [parcels, selectedShopFilter]);
  const stats = useMemo(() => ({ total: statsData.length, draft: statsData.filter(p => p.status === "draft").length, created: statsData.filter(p => p.status === "created").length, codTotal: statsData.filter(p => p.cod_enabled).reduce((s, p) => s + Number(p.cod_amount || 0), 0) }), [statsData]);

  const handleDelete = async (p) => { if (!confirm(`ลบ "${p.receiver_name}"?`)) return; if (isDemo) { setParcels(prev => prev.filter(x => x.id !== p.id)); return; } try { await sb.delete("fx_parcels", p.id); setParcels(prev => prev.filter(x => x.id !== p.id)); showToast("ลบสำเร็จ"); } catch (e) { alert(e.message); } };
  const markPrinted = async (p) => {
    setParcels(prev => prev.map(x => x.id === p.id ? { ...x, label_printed: true } : x));
    if (!isDemo) { try { await sb.update("fx_parcels", p.id, { label_printed: true, label_printed_at: new Date().toISOString() }); } catch {} }
  };

  // สร้างเลข Tracking Flash Express
  const [flashLoading, setFlashLoading] = useState(null);
  const [globalLoading, setGlobalLoading] = useState(null); // { msg, progress }
  const [toast, setToast] = useState(null); // { msg, type }
  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  // Get Flash account for a parcel (from its shop)
  const getFlashAccount = (p) => {
    const shop = shops?.find(s => s.id === p.shop_id);
    const mchId = shop?.flash_mch_id || FLASH_ACCOUNTS[0]?.mchId;
    return flashApi.getAccount(mchId);
  };

  const createFlashOrder = async (p) => {
    if (p.flash_pno) { alert("พัสดุนี้มีเลข Tracking แล้ว: " + p.flash_pno); return; }
    if (!p.receiver_name || !p.receiver_phone) { alert(`❌ ${p.receiver_name}\nกรุณากรอกชื่อและเบอร์ผู้รับก่อน`); return; }
    if (!p.receiver_province && !p.receiver_postal) { alert(`❌ ${p.receiver_name}\nกรุณากรอกจังหวัดหรือรหัสไปรษณีย์ผู้รับ`); return; }
    const acc = getFlashAccount(p);
    if (!confirm(`สร้างเลข Tracking Flash Express?\n\nบัญชี: ${acc.mchId}\nผู้รับ: ${p.receiver_name}\nเบอร์: ${p.receiver_phone}`)) return;
    setFlashLoading(p.id);
    try {
      const result = await flashApi.createOrder(p, acc);
      console.log("Flash API response:", JSON.stringify(result));
      if (result.code === 1 && result.data) {
        const updates = {
          flash_pno: result.data.pno || "",
          flash_sort_code: result.data.sortCode || result.data.dstStoreName || "",
          flash_api_response: result.data,
          status: "created",
        };
        if (!isDemo) await sb.update("fx_parcels", p.id, updates);
        setParcels(prev => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
        showToast(`สร้างเลข Tracking สำเร็จ! ${updates.flash_pno}`);
      } else {
        alert(`❌ Flash API Error (code: ${result.code}):\n${result.message || ""}\n${result.data ? "\nรายละเอียด: " + JSON.stringify(result.data) : ""}\n\n📤 ผู้ส่ง: ${p.sender_name || "❌"} | ${p.sender_phone || "❌"}\nที่อยู่ส่ง: ${p.sender_address || "❌"} | ${p.sender_province || "❌"} | ปณ.${p.sender_postal || "❌"}\n\n📥 ผู้รับ: ${p.receiver_name} | ${p.receiver_phone}\nจังหวัด: ${p.receiver_province || "❌"} | อำเภอ: ${p.receiver_district || "❌"}\nตำบล: ${p.receiver_subdistrict || "❌"} | ปณ.${p.receiver_postal || "❌"}\nที่อยู่: ${p.receiver_address || "❌"}`);
      }
    } catch (e) { alert("เชื่อมต่อ Flash API ไม่ได้:\n" + e.message); }
    setFlashLoading(null);
  };

  // Batch สร้างเลข Tracking
  const [batchProgress, setBatchProgress] = useState(null);
  const batchCreateFlash = async () => {
    const targets = parcels.filter(p => selectedIds.has(p.id) && !p.flash_pno && p.receiver_name && p.receiver_phone);
    if (!targets.length) { alert("ไม่มีรายการที่เลือก (ต้องยังไม่มีเลข Tracking + มีข้อมูลผู้รับ)"); return; }
    if (!confirm(`สร้างเลข Tracking Flash Express ${targets.length} รายการ?`)) return;
    setBatchProgress({ total: targets.length, done: 0, success: 0, errors: [] });
    let success = 0; const errors = [];
    for (let i = 0; i < targets.length; i++) {
      const pct = Math.round(((i + 1) / targets.length) * 100);
      setGlobalLoading({ msg: `กำลังสร้างเลข Tracking ${i + 1}/${targets.length}`, progress: pct });
      const p = targets[i];
      try {
        const result = await flashApi.createOrder(p, getFlashAccount(p));
        if (result.code === 1 && result.data) {
          const updates = { flash_pno: result.data.pno || "", flash_sort_code: result.data.sortCode || result.data.dstStoreName || "", flash_api_response: result.data, status: "created" };
          if (!isDemo) await sb.update("fx_parcels", p.id, updates);
          setParcels(prev => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
          success++;
        } else { errors.push(`${p.receiver_name}: ${result.message || "error"}`); }
      } catch (e) { errors.push(`${p.receiver_name}: ${e.message}`); }
      if (i % 3 === 2) await new Promise(r => setTimeout(r, 500));
    }
    setGlobalLoading(null);
    setBatchProgress(null);
    showToast(`สร้างเลข Tracking สำเร็จ ${success}/${targets.length} รายการ`);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => { const ids = paged.map(p => p.id); const allSel = ids.every(id => selectedIds.has(id)); setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => allSel ? n.delete(id) : n.add(id)); return n; }); };

  const selectedCounts = useMemo(() => {
    const sel = parcels.filter(p => selectedIds.has(p.id));
    return { total: sel.length, noTracking: sel.filter(p => !p.flash_pno).length, hasTracking: sel.filter(p => p.flash_pno).length };
  }, [parcels, selectedIds]);

  const batchPrint = () => {
    const targets = parcels.filter(p => selectedIds.has(p.id) && p.flash_pno);
    if (!targets.length) { alert("ไม่มีรายการที่มีเลข Tracking ให้ปริ้น"); return; }
    const maskPhone = (ph) => (ph || "").replace(/^(\d{3})\d{4}(\d{3})$/, "$1****$2");
    const now = new Date().toLocaleString("en-GB", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const win = window.open("", "_blank");
    const labels = targets.map((p, idx) => {
      const sc = p.flash_sort_code || "";
      const pno = p.flash_pno;
      return `
      <div class="label">
        <!-- Sort Code -->
        <div class="sort-row">
          <div class="sort-num">${idx + 1}</div>
          <div class="sort-code">${sc || "FLASH EXPRESS"}</div>
        </div>
        <!-- Barcode -->
        <div class="barcode-row"><img src="https://barcodeapi.org/api/128/${pno}?height=100" class="barcode-img" /></div>
        <!-- Tracking -->
        <div class="tracking-row">${pno}</div>
        <!-- DST -->
        <div class="dst-row"><b>DST</b> &nbsp; ${p.receiver_district || ""} — ${p.receiver_province || ""}</div>
        <!-- Sender -->
        <div class="sender-row">ผู้ส่ง ${p.sender_name} ${p.sender_phone} ${p.sender_address || ""} ${p.sender_province || ""} ${p.sender_postal || ""}</div>
        <!-- Receiver + QR -->
        <div class="recv-row">
          <div class="recv-info">
            <div class="recv-name">ผู้รับ ${p.receiver_name}</div>
            <div class="recv-phone">${maskPhone(p.receiver_phone)}</div>
            <div class="recv-addr">${p.receiver_address || ""}<br/>${p.receiver_subdistrict || ""}${p.receiver_subdistrict ? ", " : ""}${p.receiver_district || ""}<br/>${p.receiver_province || ""} ${p.receiver_postal || ""}</div>
          </div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${pno}&margin=0" class="qr-img" />
        </div>
        <!-- COD -->
        ${p.cod_enabled ? `<div class="cod-row"><span class="cod-badge">COD</span><span class="cod-text">เก็บเงินค่าสินค้า COD ${Number(p.cod_amount || 0).toLocaleString()}</span></div>` : ""}
        <!-- Note -->
        ${p.remark ? `<div class="note-row"><b>Note:</b> ${p.remark}</div>` : ""}
        <!-- Footer -->
        <div class="footer-row"><span>Print-: ${now}</span><span>${idx + 1}/${targets.length}</span><span>THE MT</span></div>
      </div>`;
    }).join("\n");

    win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>ใบปะหน้า Flash Express (${targets.length} ใบ)</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'IBM Plex Sans Thai',sans-serif;background:#e5e7eb}
      .toolbar{position:sticky;top:0;z-index:100;background:#fff;padding:12px 24px;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:12px;justify-content:center}
      .toolbar button{padding:10px 24px;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
      .btn-print{background:#dc2626;color:#fff}
      .btn-download{background:#059669;color:#fff}
      .page-wrap{display:flex;flex-direction:column;align-items:center;padding:20px;gap:20px}
      .label{width:100mm;height:75mm;background:#fff;border:1px solid #000;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,.15)}
      .sort-row{background:#333;color:#fff;display:flex;align-items:center}
      .sort-num{background:#e67e22;color:#fff;font-size:11pt;font-weight:900;padding:1.5mm 3mm;min-width:8mm;text-align:center}
      .sort-code{flex:1;text-align:center;font-size:16pt;font-weight:900;padding:1mm 2mm;letter-spacing:1px}
      .barcode-row{text-align:center;padding:2mm 4mm 1mm}
      .barcode-img{width:88mm;height:14mm}
      .tracking-row{background:#f3f4f6;text-align:center;font-size:13pt;font-weight:900;font-family:monospace;letter-spacing:2px;padding:1mm;border-top:0.5mm solid #ccc;border-bottom:0.5mm solid #ccc}
      .dst-row{background:#555;color:#fff;font-size:8pt;font-weight:700;padding:1mm 3mm}
      .sender-row{font-size:6pt;color:#666;padding:1mm 3mm;border-bottom:0.3mm solid #ddd}
      .recv-row{display:flex;flex:1;padding:1mm 3mm}
      .recv-info{flex:1}
      .recv-name{font-size:9pt;font-weight:800}
      .recv-phone{font-size:13pt;font-weight:900;font-family:monospace}
      .recv-addr{font-size:7pt;line-height:1.4;margin-top:1mm}
      .qr-img{width:18mm;height:18mm;align-self:center}
      .cod-row{background:#000;display:flex;align-items:center;padding:1.5mm 3mm;gap:3mm}
      .cod-badge{background:#fff;color:#000;font-size:7pt;font-weight:900;padding:0.5mm 2mm}
      .cod-text{color:#fff;font-size:14pt;font-weight:900}
      .note-row{font-size:8pt;font-weight:700;padding:1mm 3mm;border-top:0.3mm solid #999;background:#f9f9f9}
      .footer-row{display:flex;justify-content:space-between;font-size:5pt;color:#999;padding:0.5mm 3mm;border-top:0.3mm solid #ddd;margin-top:auto}
      @media print{
        .toolbar{display:none}
        body{background:#fff}
        .page-wrap{padding:0;gap:0}
        .label{box-shadow:none;page-break-after:always}
        body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      }
      @page{size:100mm 75mm;margin:0}
    </style>
    </head><body>
      <div class="toolbar">
        <span style="font-weight:700;font-size:16px">🖨️ ใบปะหน้า Flash Express — ${targets.length} ใบ</span>
        <button class="btn-print" onclick="window.print()">🖨️ ปริ้น</button>
        <button class="btn-download" onclick="downloadPDF()">📥 ดาวน์โหลด PDF</button>
      </div>
      <div class="page-wrap">${labels}</div>
      <script>
        function downloadPDF(){
          window.print();
        }
        // Wait for images
        var imgs=document.querySelectorAll('img'),loaded=0,total=imgs.length;
        imgs.forEach(function(img){
          if(img.complete){loaded++;}
          else{img.onload=img.onerror=function(){loaded++;};}
        });
      </script>
    </body></html>`);
    win.document.close();
  };

  const batchDelete = async () => {
    const targets = parcels.filter(p => selectedIds.has(p.id));
    if (!targets.length) return;
    if (!confirm(`ลบ ${targets.length} รายการ?`)) return;
    let success = 0;
    for (let i = 0; i < targets.length; i++) {
      setGlobalLoading({ msg: `กำลังลบ ${i + 1}/${targets.length}`, progress: Math.round(((i + 1) / targets.length) * 100) });
      const p = targets[i];
      try { if (!isDemo) await sb.delete("fx_parcels", p.id); success++; } catch {}
    }
    setParcels(prev => prev.filter(x => !selectedIds.has(x.id)));
    setGlobalLoading(null);
    showToast(`ลบสำเร็จ ${success}/${targets.length} รายการ`);
    setSelectedIds(new Set());
  };

  if (!user) return <LoginScreen onLogin={handleLogin} isDemo={isDemo} />;
  const role = ROLES[user.role] || ROLES.shipping;

  const MENU = [
    { key: "parcels", label: "การจัดส่ง", icon: "📦" },
    { key: "import", label: "Import ไฟล์", icon: "📥" },
    { key: "export", label: "Export ข้อมูล", icon: "📤" },
    { key: "shops", label: "ร้านค้า", icon: "🏪" },
    ...(perm.users ? [{ key: "users", label: "จัดการผู้ใช้", icon: "👥" }] : []),
  ];

  // ═══ IMPORT PAGE ═══
  const ImportPage = () => (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📥 Import ไฟล์สร้างเลขพัสดุ</h2>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>อัพโหลดไฟล์ CSV / Excel → ตรวจสอบข้อมูล → สร้างออเดอร์ + เลขพัสดุ Flash</p>
      </div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <ImportModal user={user} shops={shops} onClose={() => setActivePage("parcels")} onSave={() => { setActivePage("parcels"); loadParcels(); }} inline />
      </div>
    </div>
  );

  // ═══ SHOPS PAGE — inline ═══
  const ShopsPage = () => <div style={{ padding: 24 }}><ShopManagement onClose={() => {}} onUpdate={loadShops} isDemo={isDemo} inline /></div>;

  // ═══ EXPORT PAGE ═══
  const ExportPage = () => {
    const [exportShop, setExportShop] = useState("");
    const [exportFrom, setExportFrom] = useState("");
    const [exportTo, setExportTo] = useState("");
    const [exporting, setExporting] = useState(false);

    const getExportData = () => {
      let list = parcels;
      if (exportShop) list = list.filter(p => p.shop_id === exportShop);
      if (exportFrom) list = list.filter(p => new Date(p.created_at) >= new Date(exportFrom));
      if (exportTo) list = list.filter(p => new Date(p.created_at) <= new Date(exportTo + "T23:59:59"));
      return list;
    };

    const doExport = async (format) => {
      const data = getExportData();
      if (!data.length) { alert("ไม่มีข้อมูลที่จะ Export"); return; }
      setExporting(true);

      const headers = ["ชื่อผู้รับ","เบอร์ผู้รับ","ที่อยู่","ตำบล","อำเภอ","จังหวัด","รหัสไปรษณีย์","Tracking","Sort Code","COD","ยอด COD","หมายเหตุ","ชื่อผู้ส่ง","เบอร์ผู้ส่ง","วันที่สร้าง"];
      const rows = data.map(p => [
        p.receiver_name, p.receiver_phone, p.receiver_address,
        p.receiver_subdistrict, p.receiver_district, p.receiver_province, p.receiver_postal,
        p.flash_pno || "", p.flash_sort_code || "",
        p.cod_enabled ? "ใช่" : "ไม่", p.cod_amount || 0,
        p.remark || "",
        p.sender_name, p.sender_phone,
        new Date(p.created_at).toLocaleString("th-TH"),
      ]);

      if (format === "csv") {
        const bom = "\uFEFF";
        const csv = bom + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `flash-export-${new Date().toISOString().slice(0,10)}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        ws["!cols"] = headers.map((_, i) => ({ wch: i < 2 ? 20 : i === 2 ? 30 : i === 7 ? 18 : 14 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Export");
        XLSX.writeFile(wb, `flash-export-${new Date().toISOString().slice(0,10)}.xlsx`);
      }
      setExporting(false);
      showToast(`Export สำเร็จ ${data.length} รายการ`);
    };

    const previewData = getExportData();
    const I = { padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit" };

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📤 Export ข้อมูล</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>ดาวน์โหลดข้อมูลพัสดุเป็น Excel หรือ CSV</p>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {/* Filters */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ร้านค้า</label>
                <select value={exportShop} onChange={e => setExportShop(e.target.value)} style={{ ...I, minWidth: 150 }}>
                  <option value="">ทุกร้าน</option>
                  {shops?.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ตั้งแต่วันที่</label>
                <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} style={I} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ถึงวันที่</label>
                <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} style={I} />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>พบ {previewData.length} รายการ</div>
            {previewData.length > 0 && (
              <div style={{ overflowX: "auto", maxHeight: 300 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>
                    {["ชื่อ","เบอร์","อำเภอ","จังหวัด","Tracking","COD","หมายเหตุ"].map((h,i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 700, color: "#64748b", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{previewData.slice(0, 20).map((p, i) => {
                    return <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "5px 8px", fontWeight: 600 }}>{p.receiver_name}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{p.receiver_phone}</td>
                      <td style={{ padding: "5px 8px" }}>{p.receiver_district}</td>
                      <td style={{ padding: "5px 8px" }}>{p.receiver_province}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 10 }}>{p.flash_pno || "—"}</td>
                      <td style={{ padding: "5px 8px", fontWeight: 600, color: "#d97706" }}>{p.cod_enabled ? `฿${p.cod_amount}` : "—"}</td>
                      <td style={{ padding: "5px 8px", fontSize: 10, color: "#64748b", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.remark || "—"}</td>
                    </tr>;
                  })}</tbody>
                </table>
                {previewData.length > 20 && <div style={{ padding: 8, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>... แสดง 20/{previewData.length} รายการ</div>}
              </div>
            )}
          </div>

          {/* Export Buttons */}
          <div style={{ padding: "16px 24px", display: "flex", gap: 12 }}>
            <button onClick={() => doExport("xlsx")} disabled={exporting || !previewData.length} style={{ flex: 1, padding: 14, background: previewData.length ? "#059669" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: previewData.length ? "pointer" : "not-allowed" }}>
              📊 Export Excel (.xlsx)
            </button>
            <button onClick={() => doExport("csv")} disabled={exporting || !previewData.length} style={{ flex: 1, padding: 14, background: previewData.length ? "#4f46e5" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: previewData.length ? "pointer" : "not-allowed" }}>
              📄 Export CSV
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ═══ USERS PAGE — inline ═══
  const UsersPage = () => <div style={{ padding: 24 }}><UserManagement onClose={() => {}} isDemo={isDemo} inline /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f0", fontFamily: "'IBM Plex Sans Thai',-apple-system,sans-serif", display: "flex" }}>

      {/* ═══ SIDEBAR ═══ */}
      <div style={{ width: 200, background: "#1a1a2e", color: "#fff", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100, flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>⚡ Flash Express</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.4)", marginTop: 2 }}>ระบบจัดการขนส่ง</div>
        </div>

        {/* Menu */}
        <div style={{ flex: 1, padding: "12px 8px" }}>
          {MENU.map(m => (
            <button key={m.key} onClick={() => setActivePage(m.key)} style={{
              width: "100%", padding: "11px 14px", border: "none", borderRadius: 10, marginBottom: 4,
              background: activePage === m.key ? "rgba(239,68,68,.15)" : "transparent",
              color: activePage === m.key ? "#f87171" : "rgba(255,255,255,.6)",
              fontSize: 13, fontWeight: activePage === m.key ? 700 : 500, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10, textAlign: "left", fontFamily: "inherit",
            }}>{m.icon} {m.label}</button>
          ))}
        </div>

        {/* User */}
        <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: user.avatar_color || role.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff" }}>{user.display_name?.charAt(0)}</div>
            <div><div style={{ fontSize: 12, fontWeight: 600 }}>{user.display_name}</div><div style={{ fontSize: 10, opacity: .5 }}>{role.icon} {role.label}</div></div>
          </div>
          <button onClick={handleLogout} style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, color: "#f87171", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>🚪 ออกจากระบบ</button>
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div style={{ flex: 1, marginLeft: 200, minHeight: "100vh" }}>
        {/* TOP BAR */}
        {activePage === "parcels" && (
          <div style={{ background: "#fff", padding: "14px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, position: "sticky", top: 0, zIndex: 50 }}>
            <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 200 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: .4 }}>🔍</span>
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="ค้นหา เลขพัสดุ, ชื่อ, เบอร์, Tracking..." style={{ width: "100%", padding: "9px 12px 9px 36px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, outline: "none", fontFamily: "inherit" }} />
              </div>
              <button onClick={loadParcels} style={{ padding: "9px 14px", background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, cursor: "pointer", fontSize: 13 }}>🔄</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {shops?.length > 0 && <select value={selectedShopFilter} onChange={e => { setSelectedShopFilter(e.target.value); setPage(0); }} style={{ padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit", fontWeight: 600, color: selectedShopFilter ? "#dc2626" : "#64748b", minWidth: 120 }}>
                <option value="">🏪 ทุกร้าน</option>
                {shops.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>}
              {perm.create && <button onClick={() => { setEditParcel(null); setShowForm(true); }} style={{ padding: "9px 18px", background: "#dc2626", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>＋ สร้างพัสดุ</button>}
            </div>
          </div>
        )}

        <div style={{ padding: activePage === "parcels" ? "0" : "24px" }}>
          {/* ═══ PARCELS PAGE ═══ */}
          {activePage === "parcels" && (<>
            {/* STATUS TABS */}
            <div style={{ borderBottom: "2px solid #e2e8f0", overflowX: "auto", display: "flex" }}>
              {STATUS_TABS.map(s => { const cnt = s.key === "ALL" ? statsData.length : statsData.filter(p => p.status === s.key).length; const active = statusFilter === s.key; return <button key={s.key} onClick={() => { setStatusFilter(s.key); setPage(0); }} style={{ padding: "12px 18px", border: "none", borderBottom: active ? `3px solid ${s.color}` : "3px solid transparent", background: "transparent", color: active ? s.color : "#64748b", fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}><span>{s.icon}</span>{s.label}{cnt > 0 && <span style={{ background: active ? s.color : "#e2e8f0", color: active ? "#fff" : "#64748b", padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{cnt}</span>}</button>; })}
            </div>
            {/* STATS */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${perm.viewCOD ? 4 : 3}, 1fr)`, gap: 12, padding: "12px 24px" }}>
              {[{ l: "ทั้งหมด", v: stats.total, c: "#6366f1", i: "📋" }, { l: "เตรียมส่ง", v: stats.draft, c: "#f59e0b", i: "📝" }, { l: "สร้างเลขแล้ว", v: stats.created, c: "#059669", i: "✅" }, ...(perm.viewCOD ? [{ l: "COD รวม", v: `฿${stats.codTotal.toLocaleString()}`, c: "#7c3aed", i: "💰" }] : [])].map((s, i) => <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #e2e8f0" }}><div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{s.i} {s.l}</div><div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>{s.v}</div></div>)}
            </div>

            {/* TABLE */}
            <div style={{ padding: "0 24px 24px" }}>
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                {/* Batch Action Bar */}
                {selectedIds.size > 0 && perm.status && (
                  <div style={{ padding: "10px 16px", background: "linear-gradient(135deg,#eef2ff,#faf5ff)", borderBottom: "1px solid #c7d2fe", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#4f46e5" }}>✓ เลือก {selectedIds.size} รายการ</span>
                    <button onClick={batchCreateFlash} disabled={!!batchProgress} style={{ padding: "7px 16px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>⚡ สร้างเลข Tracking ({selectedCounts.noTracking})</button>
                    <button onClick={batchPrint} style={{ padding: "7px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🖨️ ปริ้น ({selectedCounts.hasTracking})</button>
                    {perm.delete && <button onClick={batchDelete} style={{ padding: "7px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🗑️ ลบ ({selectedIds.size})</button>}
                    <button onClick={() => setSelectedIds(new Set())} style={{ padding: "7px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>✕ ยกเลิก</button>
                    {batchProgress && <div style={{ flex: 1, minWidth: 150 }}><div style={{ fontSize: 11, color: "#6366f1", marginBottom: 3 }}>กำลังสร้าง... {batchProgress.done}/{batchProgress.total}</div><div style={{ width: "100%", height: 6, background: "#e2e8f0", borderRadius: 3 }}><div style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%`, height: "100%", background: "#6366f1", borderRadius: 3, transition: ".3s" }} /></div></div>}
                  </div>
                )}
                {loading ? <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>⏳ กำลังโหลด...</div> : !paged.length ? <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}><div style={{ fontSize: 40 }}>📭</div><div style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>ไม่พบพัสดุ</div></div> : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead><tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                        {perm.status && <th style={{ padding: "10px 8px", width: 36 }}><input type="checkbox" checked={paged.length > 0 && paged.every(p => selectedIds.has(p.id))} onChange={toggleSelectAll} style={{ cursor: "pointer" }} /></th>}
                        <th style={{ padding: "10px 8px", width: 30, color: "#64748b", fontSize: 11 }}>🖨️</th>
                        {["วันที่", "เวลา", "ลูกค้า", "เบอร์โทรศัพท์", "สถานะ", "หมายเลขการติดตาม", ...(perm.viewCOD ? ["COD"] : []), "ร้านค้า", "การปฏิบัติ"].map((h, i) => <th key={i} style={{ padding: "10px 10px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>)}
                      </tr></thead>
                      <tbody>{paged.map((p, i) => { const d = new Date(p.created_at); return (
                        <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: selectedIds.has(p.id) ? "#eef2ff" : i % 2 ? "#fafafa" : "#fff" }}>
                          {perm.status && <td style={{ padding: "8px", textAlign: "center" }}><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ cursor: "pointer" }} /></td>}
                          <td style={{ padding: "8px", textAlign: "center" }}>{p.flash_pno ? <span style={{ cursor: "pointer", fontSize: 14 }} onClick={() => { setPrintParcel(p); if (!p.label_printed) markPrinted(p); }}>🖨️</span> : <span style={{ color: "#d1d5db" }}>—</span>}</td>
                          <td style={{ padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap" }}>{d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td style={{ padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap", color: "#64748b" }}>{d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} น.</td>
                          <td style={{ padding: "8px 10px", fontWeight: 600, cursor: "pointer", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => setViewParcel(p)}>{p.receiver_name}</td>
                          <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{p.receiver_phone}</td>
                          <td style={{ padding: "8px 10px" }}>{p.flash_pno ? <span style={{ color: "#0ea5e9", fontWeight: 600, fontSize: 12 }}>{p.flash_pno} {p.flash_sort_code ? "📋" : ""}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                          {perm.viewCOD && <td style={{ padding: "8px 10px", fontWeight: 700, fontSize: 13 }}>{p.cod_enabled ? <span style={{ color: "#000" }}>{Number(p.cod_amount || 0).toLocaleString()}</span> : ""}</td>}
                          <td style={{ padding: "8px 10px", fontSize: 11, fontWeight: 600 }}>{p.sender_name || "—"}</td>
                          <td style={{ padding: "8px 6px" }}><div style={{ display: "flex", gap: 2 }}>
                            {perm.status && !p.flash_pno && <button title="สร้างเลข" onClick={() => createFlashOrder(p)} disabled={flashLoading === p.id} style={{ width: 26, height: 26, border: "1px solid #fbbf24", borderRadius: 4, background: flashLoading === p.id ? "#fef3c7" : "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{flashLoading === p.id ? "⏳" : "⚡"}</button>}
                            {perm.edit && <button title="แก้ไข" onClick={() => { setEditParcel(p); setShowForm(true); }} style={{ width: 26, height: 26, border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>}
                            {perm.delete && <button title="ลบ" onClick={() => handleDelete(p)} style={{ width: 26, height: 26, border: "1px solid #fca5a5", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑️</button>}
                            <button title="ดูรายละเอียด" onClick={() => setViewParcel(p)} style={{ width: 26, height: 26, border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>👁️</button>
                          </div></td>
                        </tr>); })}</tbody>
                    </table>
                  </div>
                )}
                {totalPages > 1 && <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: 12, borderTop: "1px solid #f1f5f9" }}><button disabled={!page} onClick={() => setPage(p => p - 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: !page ? "not-allowed" : "pointer", opacity: !page ? .4 : 1 }}>◀</button><span style={{ fontSize: 12, color: "#64748b" }}>{page + 1}/{totalPages} ({filtered.length})</span><button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? .4 : 1 }}>▶</button></div>}
              </div>
            </div>
          </>)}

          {activePage === "import" && <ImportPage />}
          {activePage === "export" && <ExportPage />}
          {activePage === "shops" && <ShopsPage />}
          {activePage === "users" && <UsersPage />}
        </div>
      </div>

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", zIndex: 99999, animation: "slideDown .3s ease" }}>
          <div style={{ background: toast.type === "error" ? "#dc2626" : "#059669", color: "#fff", padding: "14px 28px", borderRadius: 14, fontSize: 15, fontWeight: 700, boxShadow: "0 8px 30px rgba(0,0,0,.25)", display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit" }}>
            <span style={{ fontSize: 20 }}>{toast.type === "error" ? "❌" : "✅"}</span>
            {toast.msg}
          </div>
        </div>
      )}
      <style>{`@keyframes slideDown { from{opacity:0;transform:translateX(-50%) translateY(-20px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }`}</style>

      {/* LOADING OVERLAY — เฉพาะ batch operations */}
      {globalLoading?.progress && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9001 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 40px", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,.2)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{globalLoading.msg}</div>
            <div style={{ width: 200, height: 8, background: "#e2e8f0", borderRadius: 4 }}>
              <div style={{ width: `${globalLoading.progress}%`, height: "100%", background: "linear-gradient(90deg,#dc2626,#f59e0b)", borderRadius: 4, transition: ".3s" }} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#dc2626", marginTop: 8 }}>{globalLoading.progress}%</div>
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {viewParcel && <div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setViewParcel(null)}><div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 520, width: "95%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📦 รายละเอียด</h3><button onClick={() => setViewParcel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button></div>
        {[["Tracking", viewParcel.flash_pno || "—"], ["Sort Code", viewParcel.flash_sort_code || "—"], ["── ผู้ส่ง ──", ""], ["ชื่อ", viewParcel.sender_name], ["เบอร์", viewParcel.sender_phone], ["── ผู้รับ ──", ""], ["ชื่อ", viewParcel.receiver_name], ["เบอร์", viewParcel.receiver_phone], ["ที่อยู่", `${viewParcel.receiver_address || ""} ${viewParcel.receiver_subdistrict || ""} ${viewParcel.receiver_district || ""} ${viewParcel.receiver_province || ""} ${viewParcel.receiver_postal || ""}`], ["── พัสดุ ──", ""], ["น้ำหนัก", `${viewParcel.weight || 1} kg`], ["สินค้า", viewParcel.item_desc || "—"], ...(perm.viewCOD ? [["COD", viewParcel.cod_enabled ? `฿${Number(viewParcel.cod_amount || 0).toLocaleString()}` : "ไม่มี"]] : []), ["หมายเหตุ", viewParcel.remark || "—"], ["ผู้สร้าง", viewParcel.created_by_name || "—"], ["สร้างเมื่อ", new Date(viewParcel.created_at).toLocaleString("th-TH")]].map(([l, v], i) => v === "" ? <div key={i} style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", padding: "10px 0 4px", borderBottom: "1px solid #f1f5f9" }}>{l}</div> : <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f8fafc" }}><span style={{ fontSize: 13, color: "#64748b" }}>{l}</span><span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", textAlign: "right", maxWidth: "60%", wordBreak: "break-word" }}>{v}</span></div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {perm.edit && <button onClick={() => { setEditParcel(viewParcel); setShowForm(true); setViewParcel(null); }} style={{ flex: 1, padding: 11, background: "#e53e3e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>✏️ แก้ไข</button>}
          {perm.print && <button onClick={() => { setPrintParcel(viewParcel); setViewParcel(null); }} style={{ flex: 1, padding: 11, background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ ปริ้น</button>}
        </div>
      </div></div>}

      {/* MODALS */}
      {showForm && <ParcelForm parcel={editParcel} user={user} shops={shops} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadParcels(); }} />}
      {printParcel && <PrintLabel parcel={printParcel} onClose={() => setPrintParcel(null)} />}
    </div>
  );
}
