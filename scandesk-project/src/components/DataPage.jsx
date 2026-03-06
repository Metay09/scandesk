import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Ic, I } from "./Icon";
import EditRecordModal from "./EditRecordModal";
import { genId } from "../constants";

export default function DataPage({ fields, records, onDelete, onEdit, onExport, onImport, customers, settings, toast }) {
  const [q, setQ]           = useState("");
  const [grouped, setGrouped] = useState(true);
  const [editRec, setEditRec] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [shiftFilter, setShiftFilter] = useState("all");
  const importRef = useRef(null);
  const toggleSel = (id) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSel(new Set());

  // BUG FIX: derive customerList safely from customers prop
  const customerList = Array.isArray(customers) ? customers : (customers?.list || []);

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!rows.length) { toast && toast("Dosyada veri bulunamadı", "var(--acc)"); return; }
        const allF = [{ id: "barcode", label: "Barkod" }, ...fields.filter(f => f.id !== "barcode")];
        // Build label→id map for column matching
        const labelMap = {};
        allF.forEach(f => {
          labelMap[f.label.toLowerCase()] = f.id;
          labelMap[f.id.toLowerCase()] = f.id;
        });
        labelMap["müşteri"] = "customer";
        labelMap["musteri"] = "customer";
        labelMap["kaydeden"] = "scanned_by";
        labelMap["kullanıcı adı"] = "scanned_by_username";
        labelMap["kullanici adi"] = "scanned_by_username";
        labelMap["tarih"] = "date";
        labelMap["saat"] = "time";
        labelMap["vardiya"] = "shift";
        const imported = rows.map(row => {
          const rec = { id: genId(), synced: false };
          Object.entries(row).forEach(([col, val]) => {
            const fid = labelMap[col.toLowerCase().trim()];
            if (fid) rec[fid] = String(val ?? "");
          });
          if (!rec.barcode) return null;
          // Build timestamp from date+time columns if available, otherwise use now
          if (rec.date && rec.time) {
            const parsed = new Date(`${rec.date}T${rec.time}`);
            rec.timestamp = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
          } else {
            rec.timestamp = new Date().toISOString();
          }
          if (!rec.date) rec.date = rec.timestamp.slice(0, 10);
          if (!rec.time) rec.time = rec.timestamp.slice(11, 16);
          return rec;
        }).filter(Boolean);
        if (!imported.length) { toast && toast("Barkod sütunu bulunamadı", "var(--err)"); return; }
        onImport(imported);
      } catch (err) {
        toast && toast("Dosya okunamadı: " + err.message, "var(--err)");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const allF = [{ id: "barcode", label: "Barkod", type: "Metin" }, ...fields.filter(f => f.id !== "barcode")];
  const allShifts = [...new Set(records.map(r => r.shift).filter(Boolean))].sort();
  const filtered = records.filter(r => {
    if (shiftFilter !== "all" && r.shift !== shiftFilter) return false;
    if (!q) return true;
    return [...allF, { id: "customer" }, { id: "scanned_by" }, { id: "shift" }].some(f =>
      String(r[f.id] ?? "").toLowerCase().includes(q.toLowerCase())
    );
  });
  const groups = {};
  filtered.forEach(r => { const k = r.customer || "(Müşteri yok)"; if (!groups[k]) groups[k] = []; groups[k].push(r); });

  const Rows = ({ rows, showCust }) => rows.map(r => (
    <tr key={r.id}>
      <td style={{ color: "var(--tx3)", fontSize: 10 }}>{records.indexOf(r) + 1}</td>
      <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} /></td>
      {allF.map(f => (
        <td key={f.id}>
          {f.id === "barcode" ? <span className="bc">{r[f.id]}</span>
           : f.type === "Onay Kutusu" ? <span className={`badge ${r[f.id] ? "badge-ok" : ""}`} style={!r[f.id] ? { color: "var(--tx3)" } : {}}>{r[f.id] ? "✓" : "—"}</span>
           : r[f.id] || <span style={{ color: "var(--tx3)" }}>—</span>}
        </td>
      ))}
      {showCust && <td style={{ color: "var(--inf)", fontWeight: 600, fontSize: 12 }}>{r.customer || "—"}</td>}
      <td style={{ fontSize: 11, color: "var(--tx2)", whiteSpace: "nowrap" }}>{r.shift || "—"}</td>
      <td><span className="sig-cell">{r.scanned_by}</span></td>
      <td style={{ fontSize: 10, color: "var(--tx2)", fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>
        {new Date(r.timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
      </td>
      <td>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn btn-info btn-sm" style={{ height: 32, padding: "0 8px" }} onClick={() => setEditRec(r)}><Ic d={I.edit} s={12} /></button>
          <button className="btn btn-danger btn-sm" style={{ height: 32, padding: "0 8px" }} onClick={() => onDelete(r.id)}><Ic d={I.del} s={12} /></button>
        </div>
      </td>
    </tr>
  ));

  const THead = ({ showCust }) => (
    <thead><tr>
      <th>#</th>
      <th style={{ width: 34 }}><input type="checkbox" checked={sel.size>0 && filtered.length>0 && filtered.every(r=>sel.has(r.id))} onChange={e => { if (e.target.checked) setSel(new Set(filtered.map(r=>r.id))); else clearSel(); }} /></th>{allF.map(f => <th key={f.id}>{f.label}</th>)}
      {showCust && <th>Müşteri</th>}<th>Vardiya</th><th>Kaydeden</th><th>Saat</th><th></th>
    </tr></thead>
  );

  return (
    <div className="page">
      <div className="stats-row">
        <div className="stat"><div className="stat-val" style={{ color: "var(--acc)" }}>{records.length}</div><div className="stat-lbl">Kayıt</div></div>
        <div className="stat"><div className="stat-val" style={{ color: "var(--ok)" }}>{new Set(records.map(r => r.barcode)).size}</div><div className="stat-lbl">Benzersiz</div></div>
        <div className="stat"><div className="stat-val" style={{ color: "var(--inf)" }}>{new Set(records.map(r => r.customer).filter(Boolean)).size}</div><div className="stat-lbl">Müşteri</div></div>
        <div className="stat"><div className="stat-val" style={{ color: "var(--pur)" }}>{new Set(records.map(r => r.scanned_by).filter(Boolean)).size}</div><div className="stat-lbl">Personel</div></div>
      </div>

      {settings.allowExport && (
        <div className="export-row">
          <button className="btn btn-ok btn-full" onClick={() => onExport("xlsx")}><Ic d={I.xlsx} s={15} /> Excel</button>
          <button className="btn btn-ghost btn-full" onClick={() => onExport("csv")}><Ic d={I.csv} s={15} /> CSV</button>
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleImportFile} />
        <button className="btn btn-ghost btn-full btn-sm" onClick={() => importRef.current?.click()}>
          <Ic d={I.upload} s={15} /> Excel / CSV İçe Aktar
        </button>
      </div>
      {sel.size > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className="btn btn-danger btn-full" onClick={() => {
            if (!window.confirm(`Seçili ${sel.size} kayıt silinecek. Onaylıyor musunuz?`)) return;
            Array.from(sel).forEach(id => onDelete(id));
            clearSel();
          }}><Ic d={I.trash} s={15} /> Seçilenleri Sil ({sel.size})</button>
          {settings.allowExport && (
            <button className="btn btn-ok btn-full" onClick={() => { onExport("xlsx", Array.from(sel)); clearSel(); }}><Ic d={I.xlsx} s={15} /> Seçileni Excel</button>
          )}
        </div>
      )}


      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div className="srch">
          <span className="srch-ico"><Ic d={I.search} s={16} /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ara..." />
        </div>
        <select
          value={shiftFilter}
          onChange={e => setShiftFilter(e.target.value)}
          style={{ height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12, fontWeight: 600, flexShrink: 0 }}
        >
          <option value="all">Tüm Vardiyalar</option>
          {allShifts.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className={`btn btn-sm ${grouped ? "btn-info" : "btn-ghost"}`} onClick={() => setGrouped(p => !p)}>
          <Ic d={I.group} s={15} />
        </button>
      </div>

      {filtered.length === 0
        ? <div className="empty-state"><Ic d={I.data} s={36} /><p style={{ marginTop: 10, fontSize: 14 }}>Kayıt yok</p></div>
        : grouped
        ? Object.entries(groups).map(([k, rows]) => (
          <div key={k}>
            <div className="group-hd"><Ic d={I.user} s={13} />{k}<span className="group-count">{rows.length}</span></div>
            <div className="tbl-wrap" style={{ marginBottom: 6 }}>
              <table className="tbl"><THead showCust={false} /><tbody><Rows rows={rows} showCust={false} /></tbody></table>
            </div>
          </div>
        ))
        : <div className="tbl-wrap">
          <table className="tbl"><THead showCust={true} /><tbody><Rows rows={filtered} showCust={true} /></tbody></table>
        </div>
      }

      {editRec && <EditRecordModal record={editRec} fields={fields} customers={customerList}
        onSave={r => { onEdit(r); setEditRec(null); }} onClose={() => setEditRec(null)} />}
    </div>
  );
}
