import { useState } from "react";
import { Ic, I } from "./Icon";
import EditRecordModal from "./EditRecordModal";

export default function DataPage({ fields, records, onDelete, onEdit, onExport, customers, settings }) {
  const [q, setQ]           = useState("");
  const [grouped, setGrouped] = useState(true);
  const [editRec, setEditRec] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const toggleSel = (id) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSel(new Set());

  // BUG FIX: derive customerList safely from customers prop
  const customerList = Array.isArray(customers) ? customers : (customers?.list || []);

  const allF = [{ id: "barcode", label: "Barkod", type: "Metin" }, ...fields.filter(f => f.id !== "barcode")];
  const filtered = records.filter(r =>
    [...allF, { id: "customer" }, { id: "scanned_by" }].some(f =>
      String(r[f.id] ?? "").toLowerCase().includes(q.toLowerCase())
    )
  );
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
      {showCust && <th>Müşteri</th>}<th>Kaydeden</th><th>Saat</th><th></th>
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
