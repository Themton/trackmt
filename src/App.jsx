import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://fnkohtdpwdwedjrtklre.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZua29odGRwd2R3ZWRqcnRrbHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTA3MjIsImV4cCI6MjA4ODkyNjcyMn0.AuotNxQWgKiSYpS7kLBMm3jOCFhJWsXy31yaqG6dwic";
const BASE_URL = SUPABASE_URL;

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════
const sb = {
  headers: () => ({
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  }),
  async query(table, { method = "GET", filters = "", body, order } = {}) {
    let url = `${BASE_URL}/rest/v1/${table}`;
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
      const wsUrl = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1/websocket?apikey=" + SUPABASE_ANON_KEY + "&vsn=1.0.0";
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

const STATUSES = [
  { key: "draft", label: "ร่าง", icon: "📝", color: "#94a3b8", bg: "#f1f5f9" },
  { key: "created", label: "สร้างเลขแล้ว", icon: "📋", color: "#6366f1", bg: "#eef2ff" },
  { key: "waiting_pickup", label: "รอเข้ารับ", icon: "⏳", color: "#8b5cf6", bg: "#f5f3ff" },
  { key: "picked_up", label: "รับพัสดุแล้ว", icon: "📥", color: "#0284c7", bg: "#e0f2fe" },
  { key: "in_transit", label: "กำลังขนส่ง", icon: "🚛", color: "#d97706", bg: "#fef3c7" },
  { key: "out_for_delivery", label: "กำลังนำจ่าย", icon: "🚚", color: "#ea580c", bg: "#fff7ed" },
  { key: "delivered", label: "จัดส่งสำเร็จ", icon: "✅", color: "#059669", bg: "#ecfdf5" },
  { key: "returned", label: "ตีกลับ", icon: "↩️", color: "#dc2626", bg: "#fef2f2" },
  { key: "cancelled", label: "ยกเลิก", icon: "❌", color: "#6b7280", bg: "#f9fafb" },
  { key: "failed", label: "จัดส่งไม่สำเร็จ", icon: "⚠️", color: "#dc2626", bg: "#fef2f2" },
];
const getStatus = (k) => STATUSES.find((s) => s.key === k) || STATUSES[0];

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
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
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
function UserManagement({ onClose, isDemo }) {
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

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 640, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>👥 จัดการผู้ใช้งาน</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowAdd(!showAdd)} style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>＋ เพิ่มผู้ใช้</button>
            <button onClick={onClose} style={{ width: 36, height: 36, background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
        </div>
        {showAdd && (
          <div style={{ padding: "16px 24px", background: "#fafafa", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อผู้ใช้ *</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="username" style={I} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>รหัสผ่าน *</label><input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="password" style={I} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อที่แสดง *</label><input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="ชื่อ-สกุล" style={I} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ตำแหน่ง</label><select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...I, background: "#fff" }}><option value="admin">👑 แอดมิน</option><option value="shipping">🚚 พนักงานจัดส่ง</option><option value="accounting">💰 พนักงานบัญชี</option></select></div>
            </div>
            <button onClick={handleAdd} disabled={saving} style={{ marginTop: 10, padding: "10px 20px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{saving ? "กำลังบันทึก..." : "✅ บันทึก"}</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
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
                    <button title="รีเซ็ตรหัสผ่าน" onClick={() => resetPassword(u)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🔑</button>
                    <button title={u.is_active ? "ปิด" : "เปิด"} onClick={() => toggleActive(u)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{u.is_active ? "🚫" : "✅"}</button>
                  </div></td>
                </tr>); })}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRINT LABEL 100x75mm
// ═══════════════════════════════════════════════════════════════
function PrintLabel({ parcel, onClose }) {
  const ref = useRef();
  const handlePrint = () => {
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html><head><style>@page{size:100mm 75mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{width:100mm;height:75mm;font-family:'Sarabun',sans-serif}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${ref.current.innerHTML}</body></html>`);
    win.document.close(); setTimeout(() => { win.print(); win.close(); }, 400);
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 480, width: "95%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ใบลาเบล</h3><button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button></div>
        <div ref={ref} style={{ border: "1px solid #ccc", borderRadius: 4 }}>
          <div style={{ width: "100mm", height: "75mm", padding: "3mm", display: "flex", flexDirection: "column", fontFamily: "'Sarabun',sans-serif", border: "0.3mm solid #000" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "0.5mm solid #000", paddingBottom: "2mm", marginBottom: "2mm" }}>
              <div><div style={{ fontSize: "14pt", fontWeight: 900, color: "#e53e3e" }}>⚡ FLASH</div><div style={{ fontSize: "6pt", color: "#666" }}>EXPRESS</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: "6pt", color: "#888" }}>เลขพัสดุ</div><div style={{ fontSize: "8pt", fontWeight: 700, fontFamily: "monospace" }}>{parcel.parcel_no}</div></div>
            </div>
            <div style={{ textAlign: "center", margin: "1.5mm 0" }}><div style={{ fontSize: "11pt", fontWeight: 700, fontFamily: "monospace", letterSpacing: "1.5px" }}>{parcel.flash_pno || "TH-XXXX-XXXX"}</div></div>
            {parcel.flash_sort_code && <div style={{ fontSize: "18pt", fontWeight: 900, textAlign: "center", background: "#000", color: "#fff", padding: "1.5mm 3mm", margin: "1.5mm 0", letterSpacing: "2px" }}>{parcel.flash_sort_code}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5mm", flex: 1 }}>
              <div style={{ border: "0.3mm solid #ccc", padding: "1.5mm 2mm", borderRadius: "1mm" }}><div style={{ fontSize: "5.5pt", color: "#888" }}>ผู้ส่ง</div><div style={{ fontSize: "7.5pt", fontWeight: 600 }}>{parcel.sender_name}</div><div style={{ fontSize: "6.5pt", color: "#555" }}>{parcel.sender_phone}</div></div>
              <div style={{ border: "0.3mm solid #ccc", padding: "1.5mm 2mm", borderRadius: "1mm" }}><div style={{ fontSize: "5.5pt", color: "#888" }}>ผู้รับ</div><div style={{ fontSize: "8.5pt", fontWeight: 700 }}>{parcel.receiver_name}</div><div style={{ fontSize: "7pt", fontWeight: 600 }}>{parcel.receiver_phone}</div></div>
              <div style={{ border: "0.3mm solid #ccc", padding: "1.5mm 2mm", borderRadius: "1mm", gridColumn: "1/3" }}><div style={{ fontSize: "5.5pt", color: "#888" }}>ที่อยู่ผู้รับ</div><div style={{ fontSize: "7pt", fontWeight: 600, lineHeight: 1.4 }}>{parcel.receiver_address} {parcel.receiver_subdistrict} {parcel.receiver_district} {parcel.receiver_province} {parcel.receiver_postal}</div></div>
            </div>
            {parcel.cod_enabled && <div style={{ background: "#fff3cd", border: "0.5mm solid #f59e0b", textAlign: "center", padding: "1mm", marginTop: "1.5mm", borderRadius: "1mm" }}><span style={{ fontSize: "7pt" }}>COD </span><span style={{ fontSize: "12pt", fontWeight: 900, color: "#d97706" }}>฿{Number(parcel.cod_amount || 0).toLocaleString()}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "5.5pt", color: "#999", marginTop: "auto", paddingTop: "1mm", borderTop: "0.3mm dashed #ddd" }}><span>{parcel.parcel_no}</span><span>{parcel.weight || 1} kg</span><span>{new Date(parcel.created_at || Date.now()).toLocaleDateString("th-TH")}</span></div>
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
function ParcelForm({ parcel, user, onSave, onClose }) {
  const isEdit = !!parcel?.id;
  const [form, setForm] = useState(parcel || { sender_name: "", sender_phone: "", sender_address: "", sender_province: "", receiver_name: "", receiver_phone: "", receiver_address: "", receiver_province: "", receiver_district: "", receiver_subdistrict: "", receiver_postal: "", weight: 1, item_desc: "", quantity: 1, cod_enabled: false, cod_amount: 0, remark: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!isEdit) sb.select("fx_settings", { filters: "key=eq.default_sender" }).then(d => { if (d?.[0]?.value) { const s = d[0].value; setForm(f => ({ ...f, sender_name: s.name || "", sender_phone: s.phone || "", sender_address: s.address || "", sender_province: s.province || "" })); } }).catch(() => {}); }, [isEdit]);
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
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>📤 ผู้ส่ง</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="ชื่อ" k="sender_name" ph="ร้าน" /><F label="เบอร์" k="sender_phone" ph="08X..." />
            <F label="ที่อยู่" k="sender_address" ph="ที่อยู่" span={2} />
            <div><label style={L}>จังหวัด</label><select value={form.sender_province || ""} onChange={e => set("sender_province", e.target.value)} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
            <F label="ไปรษณีย์" k="sender_postal" ph="XXXXX" />
          </div>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>📥 ผู้รับ</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="ชื่อ *" k="receiver_name" ph="ชื่อ" /><F label="เบอร์ *" k="receiver_phone" ph="08X..." />
            <F label="ที่อยู่" k="receiver_address" ph="ที่อยู่" span={2} />
            <F label="ตำบล" k="receiver_subdistrict" ph="ตำบล" /><F label="อำเภอ" k="receiver_district" ph="อำเภอ" />
            <div><label style={L}>จังหวัด</label><select value={form.receiver_province || ""} onChange={e => set("receiver_province", e.target.value)} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
            <F label="ไปรษณีย์" k="receiver_postal" ph="XXXXX" />
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
// STATUS MODAL
// ═══════════════════════════════════════════════════════════════
function StatusModal({ parcel, onSave, onClose }) {
  const [selected, setSelected] = useState(parcel.status);
  const [flashPno, setFlashPno] = useState(parcel.flash_pno || "");
  const [sortCode, setSortCode] = useState(parcel.flash_sort_code || "");
  const [saving, setSaving] = useState(false);
  const handleSave = async () => { setSaving(true); try { const u = { status: selected }; if (flashPno) u.flash_pno = flashPno; if (sortCode) u.flash_sort_code = sortCode; await sb.update("fx_parcels", parcel.id, u); onSave(); } catch (e) { alert(e.message); } setSaving(false); };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 480, width: "95%" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>🔄 อัพเดตสถานะ</h3>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>{parcel.parcel_no} — {parcel.receiver_name}</div>
        <div style={{ marginBottom: 16, padding: 14, background: "#fef2f2", borderRadius: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", display: "block", marginBottom: 6 }}>⚡ Tracking</label>
          <input value={flashPno} onChange={e => setFlashPno(e.target.value)} placeholder="TH..." style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #fca5a5", borderRadius: 8, fontSize: 14, fontFamily: "monospace", outline: "none", marginBottom: 8 }} />
          <label style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", display: "block" }}>Sort Code</label>
          <input value={sortCode} onChange={e => setSortCode(e.target.value)} placeholder="BKK-01-A" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #fca5a5", borderRadius: 8, fontSize: 14, fontFamily: "monospace", outline: "none" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
          {STATUSES.map(s => <button key={s.key} onClick={() => setSelected(s.key)} style={{ padding: "10px 12px", border: selected === s.key ? `2px solid ${s.color}` : "2px solid #e2e8f0", borderRadius: 10, background: selected === s.key ? s.bg : "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 18 }}>{s.icon}</span><span style={{ fontSize: 13, fontWeight: selected === s.key ? 700 : 500, color: selected === s.key ? s.color : "#475569" }}>{s.label}</span></button>)}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: 13, background: saving ? "#94a3b8" : "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer" }}>{saving ? "..." : "✅ บันทึก"}</button>
          <button onClick={onClose} style={{ padding: "13px 24px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function FlashBackend() {
  const [user, setUser] = useState(null);
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editParcel, setEditParcel] = useState(null);
  const [statusParcel, setStatusParcel] = useState(null);
  const [printParcel, setPrintParcel] = useState(null);
  const [viewParcel, setViewParcel] = useState(null);
  const [showUsers, setShowUsers] = useState(false);
  const [page, setPage] = useState(0);
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
  useEffect(() => { if (!user || isDemo) return; const unsub = sb.realtime("fx_parcels", () => loadParcels()); return unsub; }, [user, isDemo, loadParcels]);

  const filtered = useMemo(() => {
    let list = parcels;
    if (statusFilter !== "ALL") list = list.filter(p => p.status === statusFilter);
    if (search) { const q = search.toLowerCase(); list = list.filter(p => [p.parcel_no, p.receiver_name, p.receiver_phone, p.flash_pno, p.receiver_province, p.created_by_name].some(v => (v || "").toLowerCase().includes(q))); }
    return list;
  }, [parcels, statusFilter, search]);

  const paged = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const stats = useMemo(() => ({ total: parcels.length, draft: parcels.filter(p => p.status === "draft").length, inTransit: parcels.filter(p => ["in_transit", "out_for_delivery", "picked_up", "waiting_pickup"].includes(p.status)).length, delivered: parcels.filter(p => p.status === "delivered").length, problems: parcels.filter(p => ["returned", "failed", "cancelled"].includes(p.status)).length, codTotal: parcels.filter(p => p.cod_enabled).reduce((s, p) => s + Number(p.cod_amount || 0), 0) }), [parcels]);

  const handleDelete = async (p) => { if (!confirm(`ลบ ${p.parcel_no}?`)) return; if (isDemo) { setParcels(prev => prev.filter(x => x.id !== p.id)); return; } try { await sb.delete("fx_parcels", p.id); loadParcels(); } catch (e) { alert(e.message); } };
  const markPrinted = async (p) => { if (isDemo) { setParcels(prev => prev.map(x => x.id === p.id ? { ...x, label_printed: true } : x)); return; } try { await sb.update("fx_parcels", p.id, { label_printed: true, label_printed_at: new Date().toISOString() }); loadParcels(); } catch {} };

  if (!user) return <LoginScreen onLogin={setUser} isDemo={isDemo} />;
  const role = ROLES[user.role] || ROLES.shipping;

  return (
    <div style={{ minHeight: "100vh", background: "#f8f7f4", fontFamily: "'IBM Plex Sans Thai',-apple-system,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", padding: "16px 24px", color: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ background: "linear-gradient(135deg,#e53e3e,#f56565)", padding: "6px 12px", borderRadius: 10, fontSize: 20 }}>⚡</div>
              <div><div style={{ fontSize: 20, fontWeight: 800 }}>Flash Backend</div><div style={{ fontSize: 12, opacity: .5 }}>ระบบจัดการพัสดุ</div></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.08)", padding: "8px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,.1)" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: user.avatar_color || role.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff" }}>{user.display_name?.charAt(0)}</div>
                <div><div style={{ fontSize: 13, fontWeight: 600 }}>{user.display_name}</div><div style={{ fontSize: 10, opacity: .6 }}>{role.icon} {role.label}</div></div>
              </div>
              {perm.users && <button onClick={() => setShowUsers(true)} style={{ padding: "8px 14px", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>👥</button>}
              {perm.create && <button onClick={() => { setEditParcel(null); setShowForm(true); }} style={{ padding: "8px 16px", background: "#e53e3e", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>＋ สร้างพัสดุ</button>}
              <button onClick={() => { setUser(null); setParcels([]); }} style={{ padding: "8px 14px", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, color: "#f87171", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🚪</button>
            </div>
          </div>
          {isDemo && <div style={{ marginTop: 10, padding: "8px 14px", background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.25)", borderRadius: 10, fontSize: 12, color: "#fbbf24" }}>⚠️ Demo — {role.icon} {user.display_name} ({role.label})</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginTop: 14 }}>
            {[{ l: "ทั้งหมด", v: stats.total, c: "#818cf8", i: "📦" }, { l: "ร่าง", v: stats.draft, c: "#94a3b8", i: "📝" }, { l: "กำลังส่ง", v: stats.inTransit, c: "#f59e0b", i: "🚛" }, { l: "สำเร็จ", v: stats.delivered, c: "#34d399", i: "✅" }, { l: "มีปัญหา", v: stats.problems, c: "#f87171", i: "⚠️" }, ...(perm.viewCOD ? [{ l: "COD รวม", v: `฿${stats.codTotal.toLocaleString()}`, c: "#a78bfa", i: "💰" }] : [])].map((s, i) => <div key={i} style={{ background: "rgba(255,255,255,.06)", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(255,255,255,.07)" }}><div style={{ fontSize: 10, color: "rgba(255,255,255,.45)", marginBottom: 2 }}>{s.i} {s.l}</div><div style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.v}</div></div>)}
          </div>
        </div>
      </div>
      {/* BODY */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200, position: "relative" }}><span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: .4 }}>🔍</span><input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="ค้นหา..." style={{ width: "100%", padding: "11px 12px 11px 42px", border: "1.5px solid #e2e8f0", borderRadius: 12, fontSize: 14, outline: "none", fontFamily: "inherit", background: "#fff" }} /></div>
          <button onClick={loadParcels} style={{ padding: "11px 16px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>🔄</button>
        </div>
        <div style={{ display: "flex", gap: 0, marginBottom: 14, overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0" }}>
          {[{ key: "ALL", label: "ทั้งหมด", icon: "📋", color: "#475569" }, ...STATUSES].map(s => { const cnt = s.key === "ALL" ? parcels.length : parcels.filter(p => p.status === s.key).length; const active = statusFilter === s.key; return <button key={s.key} onClick={() => { setStatusFilter(s.key); setPage(0); }} style={{ padding: "9px 12px", border: "none", borderBottom: active ? `3px solid ${s.color}` : "3px solid transparent", background: "transparent", color: active ? s.color : cnt ? "#475569" : "#cbd5e1", fontSize: 11, fontWeight: active ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", minWidth: 68 }}>{s.icon} {s.label}{cnt > 0 && <span style={{ marginLeft: 3, background: active ? s.color : "#e2e8f0", color: active ? "#fff" : "#64748b", padding: "1px 5px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{cnt}</span>}</button>; })}
        </div>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {loading ? <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>⏳ กำลังโหลด...</div> : !paged.length ? <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}><div style={{ fontSize: 40 }}>📭</div><div style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>ไม่พบพัสดุ</div></div> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>{["เลขพัสดุ", "ผู้รับ", "จังหวัด", "Tracking", "สถานะ", ...(perm.viewCOD ? ["COD"] : []), "ผู้สร้าง", "จัดการ"].map((h, i) => <th key={i} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                <tbody>{paged.map((p, i) => { const st = getStatus(p.status); return (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 ? "#fafafa" : "#fff" }}>
                    <td style={{ padding: "10px 12px" }}><div style={{ cursor: "pointer", fontFamily: "monospace", fontWeight: 600, fontSize: 12 }} onClick={() => setViewParcel(p)}>{p.parcel_no}</div><div style={{ fontSize: 10, color: "#94a3b8" }}>{new Date(p.created_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</div></td>
                    <td style={{ padding: "10px 12px" }}><div style={{ fontWeight: 600 }}>{p.receiver_name}</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{p.receiver_phone}</div></td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{p.receiver_province || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{p.flash_pno ? <span style={{ fontFamily: "monospace", fontSize: 11, background: "#eef2ff", color: "#4f46e5", padding: "3px 7px", borderRadius: 6, fontWeight: 600 }}>{p.flash_pno}</span> : <span style={{ fontSize: 11, color: "#cbd5e1" }}>—</span>}</td>
                    <td style={{ padding: "10px 12px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, background: st.bg, color: st.color, fontSize: 11, fontWeight: 600 }}>{st.icon} {st.label}</span></td>
                    {perm.viewCOD && <td style={{ padding: "10px 12px" }}>{p.cod_enabled ? <span style={{ fontWeight: 700, color: "#d97706" }}>฿{Number(p.cod_amount || 0).toLocaleString()}</span> : <span style={{ fontSize: 11, color: "#cbd5e1" }}>—</span>}</td>}
                    <td style={{ padding: "10px 12px", fontSize: 11, color: "#64748b" }}>{p.created_by_name || "—"}</td>
                    <td style={{ padding: "10px 8px" }}><div style={{ display: "flex", gap: 3 }}>
                      {perm.status && <button title="สถานะ" onClick={() => setStatusParcel(p)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🔄</button>}
                      {perm.edit && <button title="แก้ไข" onClick={() => { setEditParcel(p); setShowForm(true); }} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>}
                      {perm.print && <button title="ปริ้น" onClick={() => { setPrintParcel(p); if (!p.label_printed) markPrinted(p); }} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🖨️</button>}
                      {perm.delete && <button title="ลบ" onClick={() => handleDelete(p)} style={{ width: 30, height: 30, border: "1px solid #fca5a5", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑️</button>}
                    </div></td>
                  </tr>); })}</tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: 12, borderTop: "1px solid #f1f5f9" }}><button disabled={!page} onClick={() => setPage(p => p - 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: !page ? "not-allowed" : "pointer", opacity: !page ? .4 : 1 }}>◀</button><span style={{ fontSize: 12, color: "#64748b" }}>{page + 1}/{totalPages}</span><button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? .4 : 1 }}>▶</button></div>}
        </div>
      </div>
      {/* DETAIL */}
      {viewParcel && <div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setViewParcel(null)}><div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 520, width: "95%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📦 รายละเอียด</h3><button onClick={() => setViewParcel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button></div>
        {[["เลขพัสดุ", viewParcel.parcel_no], ["Tracking", viewParcel.flash_pno || "—"], ["Sort Code", viewParcel.flash_sort_code || "—"], ["สถานะ", `${getStatus(viewParcel.status).icon} ${getStatus(viewParcel.status).label}`], ["── ผู้ส่ง ──", ""], ["ชื่อ", viewParcel.sender_name], ["เบอร์", viewParcel.sender_phone], ["── ผู้รับ ──", ""], ["ชื่อ", viewParcel.receiver_name], ["เบอร์", viewParcel.receiver_phone], ["ที่อยู่", `${viewParcel.receiver_address || ""} ${viewParcel.receiver_subdistrict || ""} ${viewParcel.receiver_district || ""} ${viewParcel.receiver_province || ""} ${viewParcel.receiver_postal || ""}`], ["── พัสดุ ──", ""], ["น้ำหนัก", `${viewParcel.weight || 1} kg`], ["สินค้า", viewParcel.item_desc || "—"], ...(perm.viewCOD ? [["COD", viewParcel.cod_enabled ? `฿${Number(viewParcel.cod_amount || 0).toLocaleString()}` : "ไม่มี"]] : []), ["ผู้สร้าง", viewParcel.created_by_name || "—"], ["สร้างเมื่อ", new Date(viewParcel.created_at).toLocaleString("th-TH")]].map(([l, v], i) => v === "" ? <div key={i} style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", padding: "10px 0 4px", borderBottom: "1px solid #f1f5f9" }}>{l}</div> : <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f8fafc" }}><span style={{ fontSize: 13, color: "#64748b" }}>{l}</span><span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", textAlign: "right", maxWidth: "60%", wordBreak: "break-word" }}>{v}</span></div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {perm.edit && <button onClick={() => { setEditParcel(viewParcel); setShowForm(true); setViewParcel(null); }} style={{ flex: 1, padding: 11, background: "#e53e3e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>✏️ แก้ไข</button>}
          {perm.status && <button onClick={() => { setStatusParcel(viewParcel); setViewParcel(null); }} style={{ flex: 1, padding: 11, background: "#1e293b", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🔄 สถานะ</button>}
          {perm.print && <button onClick={() => { setPrintParcel(viewParcel); setViewParcel(null); }} style={{ flex: 1, padding: 11, background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ ปริ้น</button>}
        </div>
      </div></div>}
      {/* MODALS */}
      {showForm && <ParcelForm parcel={editParcel} user={user} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadParcels(); }} />}
      {statusParcel && <StatusModal parcel={statusParcel} onClose={() => setStatusParcel(null)} onSave={() => { setStatusParcel(null); loadParcels(); }} />}
      {printParcel && <PrintLabel parcel={printParcel} onClose={() => setPrintParcel(null)} />}
      {showUsers && <UserManagement onClose={() => setShowUsers(false)} isDemo={isDemo} />}
    </div>
  );
}
