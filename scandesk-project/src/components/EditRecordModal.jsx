import { useState } from "react";
import { Ic, I } from "./Icon";

export default function EditRecordModal({ record, fields, customers, onSave, onClose }) {
  const [form, setForm] = useState({ ...record });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const allF = [{ id: "barcode", label: "Barkod", type: "Metin" }, ...fields.filter(f => f.id !== "barcode")];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <span className="modal-title"><Ic d={I.edit} s={16} />Kaydı Düzenle</span>
          <button className="x-btn" onClick={onClose}><Ic d={I.x} s={15} /></button>
        </div>
        <div className="modal-bd">
          {allF.map(f => (
            <div key={f.id}>
              <label className="lbl">{f.label}</label>
              {f.type === "Onay Kutusu"
                ? <label className="chk-row" style={{ height: 48, border: "1.5px solid var(--brd)", borderRadius: "var(--r)", padding: "0 14px", background: "var(--s2)" }}>
                    <input type="checkbox" checked={!!form[f.id]} onChange={e => set(f.id, e.target.checked)} /><span>{f.label}</span>
                  </label>
                : f.type === "Tarih" ? <input type="date" value={form[f.id] || ""} onChange={e => set(f.id, e.target.value)} />
                : f.type === "Sayı"  ? <input type="number" inputMode="numeric" value={form[f.id] || ""} onChange={e => set(f.id, e.target.value)} />
                : <input type="text" value={form[f.id] || ""} onChange={e => set(f.id, e.target.value)} />}
            </div>
          ))}
          <div>
            <label className="lbl">Müşteri</label>
            <select value={form.customer || ""} onChange={e => set("customer", e.target.value)}>
              <option value="">— Seçiniz —</option>
              {customers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ padding: "9px 12px", background: "var(--pur2)", border: "1.5px solid var(--pur3)", borderRadius: "var(--r)", fontSize: 12, color: "var(--pur)", display: "flex", alignItems: "center", gap: 7 }}>
            <Ic d={I.sig} s={13} /> Kaydeden: <b>{form.scanned_by}</b>
          </div>
        </div>
        <div className="modal-ft">
          <button className="btn btn-ok" style={{ flex: 1 }} onClick={() => { onSave(form); onClose(); }}>
            <Ic d={I.save} s={16} /> Güncelle
          </button>
          <button className="btn btn-ghost" style={{ width: 88 }} onClick={onClose}>İptal</button>
        </div>
      </div>
    </div>
  );
}
