import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// CONFIG — เปลี่ยนเป็นค่าจริง
// ใช้ Cloudflare Worker proxy เพื่อไม่ติด rate limit
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
// ถ้าใช้ Cloudflare Worker → เปลี่ยน BASE_URL เป็น Worker URL
// เช่น "https://supabase-proxy.YOUR_WORKER.workers.dev"
const BASE_URL = SUPABASE_URL;

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT (lightweight)
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
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  },
  select: (t, o) => sb.query(t, { ...o, method: "GET" }),
  insert: (t, b) => sb.query(t, { method: "POST", body: b }),
  update: (t, id, b) => sb.query(t, { method: "PATCH", body: b, filters: `id=eq.${id}` }),
  delete: (t, id) => sb.query(t, { method: "DELETE", filters: `id=eq.${id}` }),
  rpc: async (fn, params) => {
    const res = await fetch(`${BASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: sb.headers(), body: JSON.stringify(params),
    });
    return res.json();
  },
  realtime: (table, cb) => {
    // Supabase Realtime via WebSocket
    try {
      const wsUrl = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1/websocket?apikey=" + SUPABASE_ANON_KEY + "&vsn=1.0.0";
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ topic: `realtime:public:${table}`, event: "phx_join", payload: { config: { broadcast: { self: true }, postgres_changes: [{ event: "*", schema: "public", table }] } }, ref: "1" }));
        setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" })), 30000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "postgres_changes") cb(msg.payload);
        } catch {}
      };
      return () => ws.close();
    } catch { return () => {}; }
  },
};

// ═══════════════════════════════════════════════════════════════
// GENERATE PARCEL NUMBER — FX-YYMMDD-XXXX
// ═══════════════════════════════════════════════════════════════
function generateParcelNo() {
  const now = new Date();
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const r = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `FX-${d}-${r}${ms.slice(0, 1)}`;
}

// ═══════════════════════════════════════════════════════════════
// STATUS CONFIG
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// THAI PROVINCES
// ═══════════════════════════════════════════════════════════════
const PROVINCES = ["กรุงเทพมหานคร","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา","ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก","นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน","บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา","พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต","มหาสารคาม","มุกดาหาร","แม่ฮ่องสอน","ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี","ลพบุรี","ลำปาง","ลำพูน","เลย","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร","สระแก้ว","สระบุรี","สิงห์บุรี","สุโขทัย","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","หนองคาย","หนองบัวลำภู","อ่างทอง","อำนาจเจริญ","อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี"];

// ═══════════════════════════════════════════════════════════════
// PRINT LABEL COMPONENT — 100mm x 75mm
// ═══════════════════════════════════════════════════════════════
function PrintLabel({ parcel, onClose }) {
  const printRef = useRef();
  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open("", "_blank", "width=420,height=340");
    win.document.write(`<!DOCTYPE html><html><head><title>Label ${parcel.parcel_no}</title>
<style>
@page { size: 100mm 75mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 100mm; height: 75mm; font-family: 'Sarabun', 'Noto Sans Thai', sans-serif; }
.label { width: 100mm; height: 75mm; padding: 3mm; display: flex; flex-direction: column; border: 0.3mm solid #000; }
.header { display: flex; justify-content: space-between; align-items: center; border-bottom: 0.5mm solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
.logo { font-size: 14pt; font-weight: 900; color: #e53e3e; letter-spacing: -0.5px; }
.logo-sub { font-size: 6pt; color: #666; }
.barcode-area { text-align: center; margin: 1.5mm 0; }
.barcode-text { font-size: 11pt; font-weight: 700; font-family: monospace; letter-spacing: 1.5px; }
.sort-code { font-size: 18pt; font-weight: 900; text-align: center; background: #000; color: #fff; padding: 1.5mm 3mm; margin: 1.5mm 0; letter-spacing: 2px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm; flex: 1; }
.info-box { border: 0.3mm solid #ccc; padding: 1.5mm 2mm; border-radius: 1mm; }
.info-label { font-size: 5.5pt; color: #888; text-transform: uppercase; margin-bottom: 0.5mm; }
.info-value { font-size: 7.5pt; font-weight: 600; line-height: 1.3; }
.info-value.large { font-size: 8.5pt; }
.cod-bar { background: #fff3cd; border: 0.5mm solid #f59e0b; text-align: center; padding: 1mm; margin-top: 1.5mm; border-radius: 1mm; }
.cod-amount { font-size: 12pt; font-weight: 900; color: #d97706; }
.footer { display: flex; justify-content: space-between; font-size: 5.5pt; color: #999; margin-top: auto; padding-top: 1mm; border-top: 0.3mm dashed #ddd; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 480, width: "95%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ตัวอย่างใบลาเบล</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>
        <div ref={printRef} style={{ border: "1px solid #ccc", borderRadius: 4, overflow: "hidden" }}>
          <div className="label" style={{ width: "100mm", height: "75mm", padding: "3mm", display: "flex", flexDirection: "column", fontFamily: "'Sarabun', sans-serif", border: "0.3mm solid #000" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "0.5mm solid #000", paddingBottom: "2mm", marginBottom: "2mm" }}>
              <div>
                <div style={{ fontSize: "14pt", fontWeight: 900, color: "#e53e3e" }}>⚡ FLASH</div>
                <div style={{ fontSize: "6pt", color: "#666" }}>EXPRESS</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "6pt", color: "#888" }}>เลขพัสดุ</div>
                <div style={{ fontSize: "8pt", fontWeight: 700, fontFamily: "monospace" }}>{parcel.parcel_no}</div>
              </div>
            </div>

            <div style={{ textAlign: "center", margin: "1.5mm 0" }}>
              <div style={{ fontSize: "11pt", fontWeight: 700, fontFamily: "monospace", letterSpacing: "1.5px" }}>
                {parcel.flash_pno || "TH-XXXX-XXXX-XXXX"}
              </div>
            </div>

            {parcel.flash_sort_code && (
              <div style={{ fontSize: "18pt", fontWeight: 900, textAlign: "center", background: "#000", color: "#fff", padding: "1.5mm 3mm", margin: "1.5mm 0", letterSpacing: "2px" }}>
                {parcel.flash_sort_code}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5mm", flex: 1 }}>
              <div style={{ border: "0.3mm solid #ccc", padding: "1.5mm 2mm", borderRadius: "1mm" }}>
                <div style={{ fontSize: "5.5pt", color: "#888", marginBottom: "0.5mm" }}>ผู้ส่ง</div>
                <div style={{ fontSize: "7.5pt", fontWeight: 600, lineHeight: 1.3 }}>{parcel.sender_name}</div>
                <div style={{ fontSize: "6.5pt", color: "#555" }}>{parcel.sender_phone}</div>
              </div>
              <div style={{ border: "0.3mm solid #ccc", padding: "1.5mm 2mm", borderRadius: "1mm" }}>
                <div style={{ fontSize: "5.5pt", color: "#888", marginBottom: "0.5mm" }}>ผู้รับ</div>
                <div style={{ fontSize: "8.5pt", fontWeight: 700, lineHeight: 1.3 }}>{parcel.receiver_name}</div>
                <div style={{ fontSize: "7pt", fontWeight: 600, color: "#333" }}>{parcel.receiver_phone}</div>
              </div>
              <div style={{ border: "0.3mm solid #ccc", padding: "1.5mm 2mm", borderRadius: "1mm", gridColumn: "1/3" }}>
                <div style={{ fontSize: "5.5pt", color: "#888", marginBottom: "0.5mm" }}>ที่อยู่ผู้รับ</div>
                <div style={{ fontSize: "7pt", fontWeight: 600, lineHeight: 1.4 }}>
                  {parcel.receiver_address} {parcel.receiver_subdistrict} {parcel.receiver_district} {parcel.receiver_province} {parcel.receiver_postal}
                </div>
              </div>
            </div>

            {parcel.cod_enabled && (
              <div style={{ background: "#fff3cd", border: "0.5mm solid #f59e0b", textAlign: "center", padding: "1mm", marginTop: "1.5mm", borderRadius: "1mm" }}>
                <span style={{ fontSize: "7pt" }}>COD เก็บเงินปลายทาง </span>
                <span style={{ fontSize: "12pt", fontWeight: 900, color: "#d97706" }}>฿{Number(parcel.cod_amount || 0).toLocaleString()}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "5.5pt", color: "#999", marginTop: "auto", paddingTop: "1mm", borderTop: "0.3mm dashed #ddd" }}>
              <span>{parcel.parcel_no}</span>
              <span>{parcel.weight || 1} kg</span>
              <span>{new Date(parcel.created_at || Date.now()).toLocaleDateString("th-TH")}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={handlePrint} style={{ flex: 1, padding: "12px", background: "#e53e3e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            🖨️ ปริ้นลาเบล
          </button>
          <button onClick={onClose} style={{ padding: "12px 24px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARCEL FORM MODAL
// ═══════════════════════════════════════════════════════════════
function ParcelForm({ parcel, onSave, onClose }) {
  const isEdit = !!parcel?.id;
  const [form, setForm] = useState(parcel || {
    sender_name: "", sender_phone: "", sender_address: "", sender_province: "", sender_district: "", sender_subdistrict: "", sender_postal: "",
    receiver_name: "", receiver_phone: "", receiver_address: "", receiver_province: "", receiver_district: "", receiver_subdistrict: "", receiver_postal: "",
    weight: 1, item_desc: "", quantity: 1, cod_enabled: false, cod_amount: 0, remark: "",
  });
  const [saving, setSaving] = useState(false);
  const [useSavedSender, setUseSavedSender] = useState(!isEdit);

  useEffect(() => {
    if (!isEdit && useSavedSender) {
      sb.select("fx_settings", { filters: 'key=eq.default_sender' }).then(d => {
        if (d?.[0]?.value) {
          const s = d[0].value;
          setForm(f => ({ ...f, sender_name: s.name || "", sender_phone: s.phone || "", sender_address: s.address || "", sender_province: s.province || "", sender_district: s.district || "", sender_subdistrict: s.subdistrict || "", sender_postal: s.postal || "" }));
        }
      }).catch(() => {});
    }
  }, [isEdit, useSavedSender]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.receiver_name || !form.receiver_phone) { alert("กรุณากรอกชื่อ+เบอร์ผู้รับ"); return; }
    setSaving(true);
    try {
      const data = { ...form };
      delete data.id; delete data.created_at; delete data.updated_at;
      if (isEdit) {
        await sb.update("fx_parcels", parcel.id, data);
      } else {
        data.parcel_no = generateParcelNo();
        data.status = "draft";
        await sb.insert("fx_parcels", data);
      }
      onSave();
    } catch (e) {
      alert("Error: " + e.message);
    }
    setSaving(false);
  };

  const inputStyle = { width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit", transition: "border .2s" };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 };

  const Field = ({ label, k, ph, type = "text", span }) => (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={form[k] || ""} onChange={e => set(k, type === "number" ? +e.target.value : e.target.value)} placeholder={ph} style={inputStyle} onFocus={e => e.target.style.borderColor = "#e53e3e"} onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
    </div>
  );

  const SelectProvince = ({ k, label }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <select value={form[k] || ""} onChange={e => set(k, e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
        <option value="">-- เลือกจังหวัด --</option>
        {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 30, overflowY: "auto" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 680, marginBottom: 40, overflow: "hidden", boxShadow: "0 25px 60px rgba(0,0,0,.2)" }}>
        <div style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)", padding: "20px 24px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{isEdit ? "✏️ แก้ไขพัสดุ" : "📦 สร้างพัสดุใหม่"}</h2>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: 10, fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
          {isEdit && <div style={{ fontSize: 13, opacity: .8, marginTop: 4 }}>เลขพัสดุ: {parcel.parcel_no}</div>}
        </div>
        <div style={{ padding: 24, maxHeight: "70vh", overflowY: "auto" }}>
          {/* ผู้ส่ง */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1e293b" }}>📤 ข้อมูลผู้ส่ง</h3>
              {!isEdit && <label style={{ fontSize: 12, color: "#64748b", cursor: "pointer" }}><input type="checkbox" checked={useSavedSender} onChange={e => setUseSavedSender(e.target.checked)} style={{ marginRight: 4 }} />ใช้ข้อมูลที่บันทึกไว้</label>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="ชื่อผู้ส่ง" k="sender_name" ph="ชื่อร้าน/ผู้ส่ง" />
              <Field label="เบอร์โทร" k="sender_phone" ph="08X-XXX-XXXX" />
              <Field label="ที่อยู่" k="sender_address" ph="บ้านเลขที่ ถนน ซอย" span={2} />
              <SelectProvince k="sender_province" label="จังหวัด" />
              <Field label="รหัสไปรษณีย์" k="sender_postal" ph="XXXXX" />
            </div>
          </div>

          {/* ผู้รับ */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 12 }}>📥 ข้อมูลผู้รับ</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="ชื่อผู้รับ *" k="receiver_name" ph="ชื่อ-สกุล" />
              <Field label="เบอร์โทร *" k="receiver_phone" ph="08X-XXX-XXXX" />
              <Field label="ที่อยู่" k="receiver_address" ph="บ้านเลขที่ ถนน ซอย" span={2} />
              <Field label="ตำบล/แขวง" k="receiver_subdistrict" ph="ตำบล" />
              <Field label="อำเภอ/เขต" k="receiver_district" ph="อำเภอ" />
              <SelectProvince k="receiver_province" label="จังหวัด" />
              <Field label="รหัสไปรษณีย์" k="receiver_postal" ph="XXXXX" />
            </div>
          </div>

          {/* รายละเอียดพัสดุ */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 12 }}>📦 รายละเอียดพัสดุ</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="น้ำหนัก (kg)" k="weight" type="number" />
              <Field label="จำนวน" k="quantity" type="number" />
              <Field label="รายละเอียด" k="item_desc" ph="สินค้าอะไร" />
            </div>
          </div>

          {/* COD */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1e293b" }}>💰 COD เก็บเงินปลายทาง</h3>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <div onClick={() => set("cod_enabled", !form.cod_enabled)} style={{ width: 44, height: 24, borderRadius: 12, background: form.cod_enabled ? "#059669" : "#d1d5db", transition: ".2s", cursor: "pointer", position: "relative" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 10, background: "#fff", position: "absolute", top: 2, left: form.cod_enabled ? 22 : 2, transition: ".2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                </div>
              </label>
            </div>
            {form.cod_enabled && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="จำนวนเงิน COD (บาท)" k="cod_amount" type="number" />
              </div>
            )}
          </div>

          {/* หมายเหตุ */}
          <div>
            <label style={labelStyle}>หมายเหตุ</label>
            <textarea value={form.remark || ""} onChange={e => set("remark", e.target.value)} placeholder="หมายเหตุเพิ่มเติม..." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: 14, background: saving ? "#94a3b8" : "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "กำลังบันทึก..." : isEdit ? "💾 บันทึกการแก้ไข" : "📦 สร้างพัสดุ"}
          </button>
          <button onClick={onClose} style={{ padding: "14px 28px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATUS UPDATE MODAL
// ═══════════════════════════════════════════════════════════════
function StatusModal({ parcel, onSave, onClose }) {
  const [selected, setSelected] = useState(parcel.status);
  const [flashPno, setFlashPno] = useState(parcel.flash_pno || "");
  const [sortCode, setSortCode] = useState(parcel.flash_sort_code || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = { status: selected };
      if (flashPno) updates.flash_pno = flashPno;
      if (sortCode) updates.flash_sort_code = sortCode;
      if (selected === "created" && !parcel.flash_pno && flashPno) {
        updates.status = "created";
      }
      await sb.update("fx_parcels", parcel.id, updates);
      onSave();
    } catch (e) { alert("Error: " + e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 480, width: "95%", boxShadow: "0 25px 60px rgba(0,0,0,.2)" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>🔄 อัพเดตสถานะ</h3>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>{parcel.parcel_no} — {parcel.receiver_name}</div>

        {/* Flash Tracking */}
        <div style={{ marginBottom: 16, padding: 14, background: "#fef2f2", borderRadius: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", marginBottom: 6, display: "block" }}>⚡ เลข Tracking Flash</label>
          <input value={flashPno} onChange={e => setFlashPno(e.target.value)} placeholder="TH..." style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #fca5a5", borderRadius: 8, fontSize: 14, fontFamily: "monospace", outline: "none" }} />
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", marginBottom: 4, display: "block" }}>Sort Code</label>
            <input value={sortCode} onChange={e => setSortCode(e.target.value)} placeholder="BKK-01-A" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #fca5a5", borderRadius: 8, fontSize: 14, fontFamily: "monospace", outline: "none" }} />
          </div>
        </div>

        {/* Status Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
          {STATUSES.map(s => (
            <button key={s.key} onClick={() => setSelected(s.key)} style={{ padding: "10px 12px", border: selected === s.key ? `2px solid ${s.color}` : "2px solid #e2e8f0", borderRadius: 10, background: selected === s.key ? s.bg : "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: ".15s" }}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <span style={{ fontSize: 13, fontWeight: selected === s.key ? 700 : 500, color: selected === s.key ? s.color : "#475569" }}>{s.label}</span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: 13, background: saving ? "#94a3b8" : "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            {saving ? "กำลังบันทึก..." : "✅ บันทึก"}
          </button>
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
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editParcel, setEditParcel] = useState(null);
  const [statusParcel, setStatusParcel] = useState(null);
  const [printParcel, setPrintParcel] = useState(null);
  const [viewParcel, setViewParcel] = useState(null);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const PER_PAGE = 20;

  // Demo mode detection
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    if (SUPABASE_URL.includes("YOUR_PROJECT")) setIsDemo(true);
  }, []);

  // DEMO DATA
  const demoData = useMemo(() => [
    { id: "d1", parcel_no: "FX-260404-00011", sender_name: "ร้าน ABC Shop", sender_phone: "081-234-5678", sender_address: "123 สุขุมวิท", sender_province: "กรุงเทพมหานคร", receiver_name: "สมชาย ใจดี", receiver_phone: "089-111-2222", receiver_address: "456 ม.5 ต.บ้านนา", receiver_province: "นครสวรรค์", receiver_district: "เมือง", receiver_subdistrict: "ปากน้ำโพ", receiver_postal: "60000", weight: 1.5, cod_enabled: true, cod_amount: 890, status: "created", flash_pno: "TH44128DA70M5A", flash_sort_code: "NSN-01-A", item_desc: "เสื้อผ้า 2 ตัว", label_printed: true, created_at: "2026-04-04T08:30:00Z", updated_at: "2026-04-04T09:00:00Z" },
    { id: "d2", parcel_no: "FX-260404-00028", sender_name: "ร้าน ABC Shop", sender_phone: "081-234-5678", sender_address: "123 สุขุมวิท", sender_province: "กรุงเทพมหานคร", receiver_name: "วิภา แก้วงาม", receiver_phone: "085-333-4444", receiver_address: "78 ซ.รามคำแหง 24", receiver_province: "กรุงเทพมหานคร", receiver_district: "บางกะปิ", receiver_subdistrict: "หัวหมาก", receiver_postal: "10240", weight: 0.5, cod_enabled: false, cod_amount: 0, status: "in_transit", flash_pno: "TH44128DA70K4A", flash_sort_code: "BKK-24-C", item_desc: "เคสมือถือ", label_printed: true, created_at: "2026-04-04T09:15:00Z", updated_at: "2026-04-04T10:30:00Z" },
    { id: "d3", parcel_no: "FX-260404-00035", sender_name: "ร้าน ABC Shop", sender_phone: "081-234-5678", sender_address: "123 สุขุมวิท", sender_province: "กรุงเทพมหานคร", receiver_name: "นภา สุขสบาย", receiver_phone: "062-555-6666", receiver_address: "9/1 ถ.นิมมานเหมินท์", receiver_province: "เชียงใหม่", receiver_district: "เมือง", receiver_subdistrict: "สุเทพ", receiver_postal: "50200", weight: 2, cod_enabled: true, cod_amount: 1250, status: "delivered", flash_pno: "TH44128DA70J9A", flash_sort_code: "CNX-01-B", item_desc: "รองเท้า 1 คู่", label_printed: true, created_at: "2026-04-03T14:00:00Z", updated_at: "2026-04-04T11:20:00Z" },
    { id: "d4", parcel_no: "FX-260404-00042", sender_name: "ร้าน ABC Shop", sender_phone: "081-234-5678", sender_address: "123 สุขุมวิท", sender_province: "กรุงเทพมหานคร", receiver_name: "ประเสริฐ มั่งมี", receiver_phone: "091-777-8888", receiver_address: "222 ม.3 ถ.มิตรภาพ", receiver_province: "นครราชสีมา", receiver_district: "เมือง", receiver_subdistrict: "ในเมือง", receiver_postal: "30000", weight: 3.5, cod_enabled: true, cod_amount: 2100, status: "draft", flash_pno: "", flash_sort_code: "", item_desc: "เครื่องสำอาง 5 ชิ้น", label_printed: false, created_at: "2026-04-04T11:45:00Z", updated_at: "2026-04-04T11:45:00Z" },
    { id: "d5", parcel_no: "FX-260403-00019", sender_name: "ร้าน ABC Shop", sender_phone: "081-234-5678", sender_address: "123 สุขุมวิท", sender_province: "กรุงเทพมหานคร", receiver_name: "อรุณี พงษ์ไพร", receiver_phone: "083-999-0000", receiver_address: "55/3 ถ.พหลโยธิน", receiver_province: "พิษณุโลก", receiver_district: "เมือง", receiver_subdistrict: "ในเมือง", receiver_postal: "65000", weight: 1, cod_enabled: false, cod_amount: 0, status: "out_for_delivery", flash_pno: "TH44128DA70L3A", flash_sort_code: "PHS-01-A", item_desc: "หนังสือ 3 เล่ม", label_printed: true, created_at: "2026-04-03T10:00:00Z", updated_at: "2026-04-04T07:00:00Z" },
    { id: "d6", parcel_no: "FX-260403-00026", sender_name: "ร้าน ABC Shop", sender_phone: "081-234-5678", sender_address: "123 สุขุมวิท", sender_province: "กรุงเทพมหานคร", receiver_name: "ศิริพร ลาภดี", receiver_phone: "097-111-3333", receiver_address: "88 ถ.เพชรเกษม", receiver_province: "ประจวบคีรีขันธ์", receiver_district: "หัวหิน", receiver_subdistrict: "หัวหิน", receiver_postal: "77110", weight: 0.8, cod_enabled: true, cod_amount: 450, status: "returned", flash_pno: "TH44128DA70N7A", flash_sort_code: "PKN-05-B", item_desc: "กระเป๋า", label_printed: true, created_at: "2026-04-02T16:30:00Z", updated_at: "2026-04-04T12:00:00Z" },
  ], []);

  // Load data
  const loadParcels = useCallback(async () => {
    if (isDemo) { setParcels(demoData); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await sb.select("fx_parcels", { order: `${sortBy}.${sortDir}` });
      setParcels(data || []);
      setError(null);
    } catch (e) {
      setError(e.message);
      setParcels([]);
    }
    setLoading(false);
  }, [isDemo, sortBy, sortDir, demoData]);

  useEffect(() => { loadParcels(); }, [loadParcels]);

  // Realtime
  useEffect(() => {
    if (isDemo) return;
    const unsub = sb.realtime("fx_parcels", () => loadParcels());
    return unsub;
  }, [isDemo, loadParcels]);

  // Filtered data
  const filtered = useMemo(() => {
    let list = parcels;
    if (statusFilter !== "ALL") list = list.filter(p => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (p.parcel_no || "").toLowerCase().includes(q) ||
        (p.receiver_name || "").toLowerCase().includes(q) ||
        (p.receiver_phone || "").includes(q) ||
        (p.flash_pno || "").toLowerCase().includes(q) ||
        (p.receiver_province || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [parcels, statusFilter, search]);

  const paged = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  // Stats
  const stats = useMemo(() => ({
    total: parcels.length,
    draft: parcels.filter(p => p.status === "draft").length,
    inTransit: parcels.filter(p => ["in_transit", "out_for_delivery", "picked_up", "waiting_pickup"].includes(p.status)).length,
    delivered: parcels.filter(p => p.status === "delivered").length,
    problems: parcels.filter(p => ["returned", "failed", "cancelled"].includes(p.status)).length,
    codTotal: parcels.filter(p => p.cod_enabled).reduce((s, p) => s + Number(p.cod_amount || 0), 0),
  }), [parcels]);

  // Delete
  const handleDelete = async (p) => {
    if (!confirm(`ลบพัสดุ ${p.parcel_no}?`)) return;
    if (isDemo) { setParcels(prev => prev.filter(x => x.id !== p.id)); return; }
    try { await sb.delete("fx_parcels", p.id); loadParcels(); } catch (e) { alert("Error: " + e.message); }
  };

  // Mark as printed
  const markPrinted = async (p) => {
    if (isDemo) { setParcels(prev => prev.map(x => x.id === p.id ? { ...x, label_printed: true, label_printed_at: new Date().toISOString() } : x)); return; }
    try { await sb.update("fx_parcels", p.id, { label_printed: true, label_printed_at: new Date().toISOString() }); loadParcels(); } catch (e) { alert(e.message); }
  };

  // Batch print
  const handleBatchPrint = () => {
    const selected = filtered.filter(p => p.flash_pno);
    if (!selected.length) { alert("ไม่มีพัสดุที่มีเลข Tracking"); return; }
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>Batch Labels</title>
<style>
@page { size: 100mm 75mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Sarabun', sans-serif; }
.label { width: 100mm; height: 75mm; padding: 3mm; display: flex; flex-direction: column; border: 0.3mm solid #000; page-break-after: always; }
.label:last-child { page-break-after: auto; }
</style></head><body>`);
    selected.forEach(p => {
      win.document.write(`<div class="label">
<div style="display:flex;justify-content:space-between;border-bottom:0.5mm solid #000;padding-bottom:2mm;margin-bottom:2mm">
<div><div style="font-size:14pt;font-weight:900;color:#e53e3e">⚡ FLASH</div><div style="font-size:6pt;color:#666">EXPRESS</div></div>
<div style="text-align:right"><div style="font-size:6pt;color:#888">เลขพัสดุ</div><div style="font-size:8pt;font-weight:700;font-family:monospace">${p.parcel_no}</div></div></div>
<div style="text-align:center;margin:1.5mm 0"><div style="font-size:11pt;font-weight:700;font-family:monospace;letter-spacing:1.5px">${p.flash_pno || ""}</div></div>
${p.flash_sort_code ? `<div style="font-size:18pt;font-weight:900;text-align:center;background:#000;color:#fff;padding:1.5mm 3mm;margin:1.5mm 0;letter-spacing:2px">${p.flash_sort_code}</div>` : ""}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5mm;flex:1">
<div style="border:0.3mm solid #ccc;padding:1.5mm 2mm;border-radius:1mm"><div style="font-size:5.5pt;color:#888">ผู้ส่ง</div><div style="font-size:7.5pt;font-weight:600">${p.sender_name}</div><div style="font-size:6.5pt;color:#555">${p.sender_phone}</div></div>
<div style="border:0.3mm solid #ccc;padding:1.5mm 2mm;border-radius:1mm"><div style="font-size:5.5pt;color:#888">ผู้รับ</div><div style="font-size:8.5pt;font-weight:700">${p.receiver_name}</div><div style="font-size:7pt;font-weight:600">${p.receiver_phone}</div></div>
<div style="border:0.3mm solid #ccc;padding:1.5mm 2mm;border-radius:1mm;grid-column:1/3"><div style="font-size:5.5pt;color:#888">ที่อยู่ผู้รับ</div><div style="font-size:7pt;font-weight:600;line-height:1.4">${p.receiver_address || ""} ${p.receiver_subdistrict || ""} ${p.receiver_district || ""} ${p.receiver_province || ""} ${p.receiver_postal || ""}</div></div></div>
${p.cod_enabled ? `<div style="background:#fff3cd;border:0.5mm solid #f59e0b;text-align:center;padding:1mm;margin-top:1.5mm;border-radius:1mm"><span style="font-size:7pt">COD </span><span style="font-size:12pt;font-weight:900;color:#d97706">฿${Number(p.cod_amount || 0).toLocaleString()}</span></div>` : ""}
<div style="display:flex;justify-content:space-between;font-size:5.5pt;color:#999;margin-top:auto;padding-top:1mm;border-top:0.3mm dashed #ddd"><span>${p.parcel_no}</span><span>${p.weight || 1} kg</span><span>${new Date(p.created_at).toLocaleDateString("th-TH")}</span></div>
</div>`);
    });
    win.document.write("</body></html>");
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };

  // ═══ RENDER ═══
  return (
    <div style={{ minHeight: "100vh", background: "#f8f7f4", fontFamily: "'IBM Plex Sans Thai', 'Noto Sans Thai', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", padding: "20px 24px 16px", color: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ background: "linear-gradient(135deg,#e53e3e,#f56565)", padding: "6px 12px", borderRadius: 10, fontSize: 20 }}>⚡</span>
                Flash Backend
              </div>
              <div style={{ fontSize: 13, opacity: .6, marginTop: 4 }}>ระบบจัดการพัสดุขนส่งแฟลช</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleBatchPrint} style={{ padding: "10px 18px", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                🖨️ ปริ้นทั้งหมด
              </button>
              <button onClick={() => { setEditParcel(null); setShowForm(true); }} style={{ padding: "10px 20px", background: "#e53e3e", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                ＋ สร้างพัสดุ
              </button>
            </div>
          </div>

          {/* Demo Banner */}
          {isDemo && (
            <div style={{ marginTop: 12, padding: "10px 16px", background: "rgba(251,191,36,.15)", border: "1px solid rgba(251,191,36,.3)", borderRadius: 10, fontSize: 13, color: "#fbbf24" }}>
              ⚠️ โหมด Demo — ใส่ค่า SUPABASE_URL + ANON_KEY ในโค้ดเพื่อเชื่อมต่อฐานข้อมูลจริง (ใช้ Cloudflare Worker URL เพื่อ proxy)
            </div>
          )}

          {/* STATS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 16 }}>
            {[
              { label: "ทั้งหมด", value: stats.total, color: "#818cf8", icon: "📦" },
              { label: "ร่าง", value: stats.draft, color: "#94a3b8", icon: "📝" },
              { label: "กำลังส่ง", value: stats.inTransit, color: "#f59e0b", icon: "🚛" },
              { label: "สำเร็จ", value: stats.delivered, color: "#34d399", icon: "✅" },
              { label: "มีปัญหา", value: stats.problems, color: "#f87171", icon: "⚠️" },
              { label: "COD รวม", value: `฿${stats.codTotal.toLocaleString()}`, color: "#a78bfa", icon: "💰" },
            ].map((s, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,.07)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(255,255,255,.08)" }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginBottom: 4 }}>{s.icon} {s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* BODY */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px" }}>
        {/* SEARCH + FILTER */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: .4 }}>🔍</span>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="ค้นหา เลขพัสดุ, ชื่อ, เบอร์, Tracking..." style={{ width: "100%", padding: "12px 12px 12px 42px", border: "1.5px solid #e2e8f0", borderRadius: 12, fontSize: 14, outline: "none", fontFamily: "inherit", background: "#fff" }} />
          </div>
          <button onClick={loadParcels} style={{ padding: "12px 18px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>🔄 รีเฟรช</button>
        </div>

        {/* STATUS TABS */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16, overflowX: "auto", background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0" }}>
          {[{ key: "ALL", label: "ทั้งหมด", icon: "📋", color: "#475569" }, ...STATUSES].map(s => {
            const cnt = s.key === "ALL" ? parcels.length : parcels.filter(p => p.status === s.key).length;
            const active = statusFilter === s.key;
            return (
              <button key={s.key} onClick={() => { setStatusFilter(s.key); setPage(0); }} style={{
                padding: "10px 14px", border: "none", borderBottom: active ? `3px solid ${s.color}` : "3px solid transparent",
                background: "transparent", color: active ? s.color : cnt > 0 ? "#475569" : "#cbd5e1",
                fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", minWidth: 80,
              }}>
                {s.icon} {s.label}
                {cnt > 0 && <span style={{ marginLeft: 4, background: active ? s.color : "#e2e8f0", color: active ? "#fff" : "#64748b", padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{cnt}</span>}
              </button>
            );
          })}
        </div>

        {/* ERROR */}
        {error && !isDemo && (
          <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, marginBottom: 16, fontSize: 14, color: "#dc2626" }}>
            ❌ {error}
          </div>
        )}

        {/* TABLE */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: 28, marginBottom: 8, animation: "spin 1s linear infinite" }}>⏳</div>
              <div>กำลังโหลด...</div>
            </div>
          ) : paged.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>ไม่พบพัสดุ</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>ลองเปลี่ยนตัวกรองหรือสร้างพัสดุใหม่</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["เลขพัสดุ", "ผู้รับ", "จังหวัด", "Tracking", "สถานะ", "COD", "ลาเบล", "จัดการ"].map((h, i) => (
                      <th key={i} style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 12, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((p, i) => {
                    const st = getStatus(p.status);
                    return (
                      <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa", transition: ".15s" }} onMouseEnter={e => e.currentTarget.style.background = "#f8f7f4"} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafafa"}>
                        <td style={{ padding: "12px 14px", fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: "#1e293b" }}>
                          <div style={{ cursor: "pointer" }} onClick={() => setViewParcel(p)}>{p.parcel_no}</div>
                          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "inherit" }}>{new Date(p.created_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</div>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b" }}>{p.receiver_name}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.receiver_phone}</div>
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 12, color: "#64748b" }}>{p.receiver_province || "-"}</td>
                        <td style={{ padding: "12px 14px" }}>
                          {p.flash_pno ? (
                            <span style={{ fontFamily: "monospace", fontSize: 11, background: "#eef2ff", color: "#4f46e5", padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>{p.flash_pno}</span>
                          ) : (
                            <span style={{ fontSize: 11, color: "#cbd5e1" }}>— ยังไม่มี</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 20, background: st.bg, color: st.color, fontSize: 12, fontWeight: 600 }}>
                            {st.icon} {st.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          {p.cod_enabled ? (
                            <span style={{ fontWeight: 700, color: "#d97706" }}>฿{Number(p.cod_amount || 0).toLocaleString()}</span>
                          ) : (
                            <span style={{ fontSize: 11, color: "#cbd5e1" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          {p.label_printed ? (
                            <span style={{ color: "#059669", fontSize: 11, fontWeight: 600 }}>✅ ปริ้นแล้ว</span>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>⬜ ยังไม่ปริ้น</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 10px" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button title="อัพเดตสถานะ" onClick={() => setStatusParcel(p)} style={{ width: 32, height: 32, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🔄</button>
                            <button title="แก้ไข" onClick={() => { setEditParcel(p); setShowForm(true); }} style={{ width: 32, height: 32, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>
                            <button title="ปริ้นลาเบล" onClick={() => { setPrintParcel(p); if (!p.label_printed) markPrinted(p); }} style={{ width: 32, height: 32, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🖨️</button>
                            <button title="ลบ" onClick={() => handleDelete(p)} style={{ width: 32, height: 32, border: "1px solid #fca5a5", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* PAGINATION */}
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "14px", borderTop: "1px solid #f1f5f9" }}>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? .4 : 1 }}>◀ ก่อนหน้า</button>
              <span style={{ fontSize: 13, color: "#64748b" }}>หน้า {page + 1}/{totalPages} ({filtered.length} รายการ)</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? .4 : 1 }}>ถัดไป ▶</button>
            </div>
          )}
        </div>
      </div>

      {/* DETAIL MODAL */}
      {viewParcel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setViewParcel(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 520, width: "95%", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📦 รายละเอียดพัสดุ</h3>
              <button onClick={() => setViewParcel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button>
            </div>
            {[
              ["เลขพัสดุ", viewParcel.parcel_no],
              ["Tracking", viewParcel.flash_pno || "—"],
              ["Sort Code", viewParcel.flash_sort_code || "—"],
              ["สถานะ", `${getStatus(viewParcel.status).icon} ${getStatus(viewParcel.status).label}`],
              ["──── ผู้ส่ง ────", ""],
              ["ชื่อ", viewParcel.sender_name],
              ["เบอร์", viewParcel.sender_phone],
              ["ที่อยู่", `${viewParcel.sender_address || ""} ${viewParcel.sender_province || ""}`],
              ["──── ผู้รับ ────", ""],
              ["ชื่อ", viewParcel.receiver_name],
              ["เบอร์", viewParcel.receiver_phone],
              ["ที่อยู่", `${viewParcel.receiver_address || ""} ${viewParcel.receiver_subdistrict || ""} ${viewParcel.receiver_district || ""} ${viewParcel.receiver_province || ""} ${viewParcel.receiver_postal || ""}`],
              ["──── พัสดุ ────", ""],
              ["น้ำหนัก", `${viewParcel.weight || 1} kg`],
              ["สินค้า", viewParcel.item_desc || "—"],
              ["COD", viewParcel.cod_enabled ? `฿${Number(viewParcel.cod_amount || 0).toLocaleString()}` : "ไม่เก็บเงินปลายทาง"],
              ["หมายเหตุ", viewParcel.remark || "—"],
              ["สร้างเมื่อ", new Date(viewParcel.created_at).toLocaleString("th-TH")],
            ].map(([l, v], i) => v === "" ? (
              <div key={i} style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", padding: "10px 0 4px", borderBottom: "1px solid #f1f5f9" }}>{l}</div>
            ) : (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f8fafc" }}>
                <span style={{ fontSize: 13, color: "#64748b" }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", textAlign: "right", maxWidth: "60%", wordBreak: "break-word" }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={() => { setEditParcel(viewParcel); setShowForm(true); setViewParcel(null); }} style={{ flex: 1, padding: 12, background: "#e53e3e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>✏️ แก้ไข</button>
              <button onClick={() => { setStatusParcel(viewParcel); setViewParcel(null); }} style={{ flex: 1, padding: 12, background: "#1e293b", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>🔄 อัพเดตสถานะ</button>
              <button onClick={() => { setPrintParcel(viewParcel); setViewParcel(null); }} style={{ flex: 1, padding: 12, background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>🖨️ ปริ้น</button>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {showForm && <ParcelForm parcel={editParcel} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadParcels(); }} />}
      {statusParcel && <StatusModal parcel={statusParcel} onClose={() => setStatusParcel(null)} onSave={() => { setStatusParcel(null); loadParcels(); }} />}
      {printParcel && <PrintLabel parcel={printParcel} onClose={() => setPrintParcel(null)} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
