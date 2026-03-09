import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Ic, I } from "./Icon";
import EditRecordModal from "./EditRecordModal";
import Modal from "./Modal";
import { genId } from "../constants";
import { toggleSetMember, getCustomerList, deriveShiftDate, getShiftDate } from "../utils";

export default function DataPage({ fields, records, onDelete, onEdit, onExport, onImport, customers, settings, toast, isAdmin, currentShift, user }) {
  const [q, setQ]           = useState("");
  const [grouped, setGrouped] = useState(true);
  const [editRec, setEditRec] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [shiftFilter, setShiftFilter] = useState("all");
  const [dateFilter, setDateFilter]   = useState("");   // "YYYY-MM-DD" ya da ""
  const [userFilter, setUserFilter]   = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [showShiftCol, setShowShiftCol] = useState(false); // Vardiya kolonu varsayılan gizli
  const [pendingImport, setPendingImport] = useState(null); // Admin approval için bekleyen import
  const importRef = useRef(null);
  const toggleSel = (id) => setSel(p => toggleSetMember(p, id));
  const clearSel = () => setSel(new Set());

  const customerList = getCustomerList(customers);
  const currentShiftDate = getShiftDate(undefined, currentShift);

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
        labelMap["vardiya id"] = "shiftId";
        labelMap["shiftid"] = "shiftId";
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
          rec.shiftDate = getShiftDate(rec.timestamp || rec.date, rec.shift);
          return rec;
        }).filter(Boolean);
        if (!imported.length) { toast && toast("Barkod sütunu bulunamadı", "var(--err)"); return; }

        // Check for duplicates (barcode only - not shift/date)
        const existingBarcodes = new Set(records.map(r => String(r.barcode ?? "").trim()));
        const newRecords = [];
        const duplicates = [];

        imported.forEach(rec => {
          const key = String(rec.barcode ?? "").trim();
          if (existingBarcodes.has(key)) {
            duplicates.push(rec);
          } else {
            newRecords.push(rec);
            existingBarcodes.add(key); // Prevent duplicates within the file itself
          }
        });

        // Show import summary - both admin and regular users can see it
        const totalCount = imported.length;
        const duplicateCount = duplicates.length;
        const newCount = newRecords.length;

        if (duplicateCount > 0) {
          toast && toast(`${totalCount} kayıt bulundu: ${newCount} yeni, ${duplicateCount} tekrar`, "var(--inf)");
        }

        // Auto-skip duplicates, only import new records
        if (newCount === 0) {
          toast && toast("Tüm kayıtlar sistemde zaten mevcut", "var(--acc)");
          return;
        }

        // Show analysis panel to all users (both admin and regular)
        setPendingImport({
          records: newRecords,
          duplicates,
          total: totalCount,
          newCount,
          duplicateCount
        });
      } catch (err) {
        toast && toast("Dosya okunamadı: " + err.message, "var(--err)");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleApproveImport = () => {
    if (pendingImport) {
      // Only import new records (duplicates are auto-skipped)
      onImport(pendingImport.records);
      toast && toast(`${pendingImport.newCount} yeni kayıt içe aktarıldı`, "var(--ok)");
      setPendingImport(null);
    }
  };

  const handleCancelImport = () => {
    setPendingImport(null);
    toast && toast("İçe aktarma iptal edildi", "var(--acc)");
  };

  const allF = [{ id: "barcode", label: "Barkod", type: "Metin" }, ...fields.filter(f => f.id !== "barcode")];
  // Admin tüm kayıtları görebilir; normal kullanıcılar sadece kendi vardiyalarındaki kayıtları görür
  const visibleRecords = isAdmin
    ? records
    : records.filter(r => r.shift === currentShift && deriveShiftDate(r) === currentShiftDate);
  const allShifts = isAdmin ? [...new Set(visibleRecords.map(r => r.shift).filter(Boolean))].sort() : [];
  const allUsers  = [...new Set(visibleRecords.map(r => r.scanned_by_username).filter(Boolean))].sort();
  const allCustomers = [...new Set(visibleRecords.map(r => r.customer).filter(Boolean))].sort();
  const filtered = visibleRecords.filter(r => {
    if (isAdmin && shiftFilter !== "all" && r.shift !== shiftFilter) return false;
    if (dateFilter && deriveShiftDate(r) !== dateFilter) return false;
    if (userFilter !== "all" && r.scanned_by_username !== userFilter) return false;
    if (customerFilter !== "all" && r.customer !== customerFilter) return false;
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
      {showShiftCol && <td style={{ fontSize: 11, color: "var(--tx2)", whiteSpace: "nowrap" }}>{r.shift || "—"}</td>}
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
      {showCust && <th>Müşteri</th>}{showShiftCol && <th>Vardiya</th>}<th>Kaydeden</th><th>Saat</th><th></th>
    </tr></thead>
  );

  return (
    <div className="page">

      {/* Export/Import buttons in one row - all same size */}
      {(settings.allowExport || settings.allowImport) && (
        <div className="export-row">
          {settings.allowExport && (
            <>
              <button className="btn btn-ok btn-full" onClick={() => onExport("xlsx")}><Ic d={I.xlsx} s={15} /> Excel</button>
              <button className="btn btn-ghost btn-full" onClick={() => onExport("csv")}><Ic d={I.csv} s={15} /> CSV</button>
            </>
          )}
          {settings.allowImport && (
            <>
              <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleImportFile} />
              <button className="btn btn-ghost btn-full" onClick={() => importRef.current?.click()}>
                <Ic d={I.upload} s={15} /> İçe Aktar
              </button>
            </>
          )}
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


      <div style={{ marginBottom: 10 }}>
        {/* Search box - standalone, wider */}
        <div className="srch" style={{ width: "100%", marginBottom: 8 }}>
          <span className="srch-ico"><Ic d={I.search} s={16} /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ara..." />
        </div>

        {/* Filter dropdowns - labels inside as first option */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
            marginBottom: 6
          }}
        >
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            placeholder="Tarih"
            style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: dateFilter ? "var(--tx)" : "var(--tx2)", border: "1.5px solid var(--brd)", fontSize: 12 }}
          />
          {isAdmin && allShifts.length > 0 && (
            <select
              value={shiftFilter}
              onChange={e => setShiftFilter(e.target.value)}
              style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: shiftFilter === "all" ? "var(--tx2)" : "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12, fontWeight: shiftFilter === "all" ? 400 : 600 }}
            >
              <option value="all">Vardiya</option>
              {allShifts.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {allUsers.length > 0 && (
            <select
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
              style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: userFilter === "all" ? "var(--tx2)" : "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12, fontWeight: userFilter === "all" ? 400 : 600 }}
            >
              <option value="all">Kullanıcı</option>
              {allUsers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
          {allCustomers.length > 0 && (
            <select
              value={customerFilter}
              onChange={e => setCustomerFilter(e.target.value)}
              style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: customerFilter === "all" ? "var(--tx2)" : "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12, fontWeight: customerFilter === "all" ? 400 : 600 }}
            >
              <option value="all">Müşteri</option>
              {allCustomers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(dateFilter || (isAdmin && shiftFilter !== "all") || userFilter !== "all" || customerFilter !== "all") && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setDateFilter(""); if (isAdmin) setShiftFilter("all"); setUserFilter("all"); setCustomerFilter("all"); }}
            >
              <Ic d={I.close} s={14} /> Filtreleri Temizle
            </button>
          )}
          {isAdmin && (
            <button
              className={`btn btn-sm ${showShiftCol ? "btn-info" : "btn-ghost"}`}
              title={showShiftCol ? "Vardiya kolonunu gizle" : "Vardiya kolonunu göster"}
              onClick={() => setShowShiftCol(p => !p)}
            >
              <Ic d={I.fields} s={14} /> Vardiya
            </button>
          )}
          <button className={`btn btn-sm ${grouped ? "btn-info" : "btn-ghost"}`} onClick={() => setGrouped(p => !p)}>
            <Ic d={I.group} s={15} /> {grouped ? "Gruplu" : "Liste"}
          </button>
        </div>
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

      {editRec && <EditRecordModal record={editRec} fields={fields} customers={customers} canManageCustomers={true}
        onSave={r => { onEdit(r); setEditRec(null); }} onClose={() => setEditRec(null)} />}

      {pendingImport && (
        <Modal
          title="İçe Aktarma Analizi"
          icon={I.upload}
          onClose={handleCancelImport}
          footer={
            <>
              {settings.allowImport ? (
                <button className="btn btn-ok" style={{ flex: 1 }} onClick={handleApproveImport}>
                  <Ic d={I.check} s={16} /> İçe Aktar ({pendingImport.newCount} Yeni Kayıt)
                </button>
              ) : (
                <div style={{ flex: 1, padding: "10px", background: "var(--err2)", border: "1.5px solid var(--err3)", borderRadius: "var(--r)", fontSize: 12, color: "var(--err)", fontWeight: 600, textAlign: "center" }}>
                  İçe aktarma yetkisi yok
                </div>
              )}
              <button className="btn btn-ghost" style={{ width: 88 }} onClick={handleCancelImport}>İptal</button>
            </>
          }
        >
          <div style={{ marginBottom: 12 }}>
            {pendingImport.duplicateCount > 0 && (
              <div style={{ padding: "12px", background: "var(--acc2)", border: "1.5px solid var(--acc3)", borderRadius: "var(--r)", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Ic d={I.warning} s={16} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--acc)" }}>Tekrar Eden Kayıtlar Atlanacak</span>
                </div>
                <p style={{ fontSize: 12, color: "var(--tx2)", margin: 0 }}>
                  {pendingImport.duplicateCount} kayıt sistemde zaten mevcut (aynı barkod).
                  Bu kayıtlar otomatik olarak atlanacak.
                </p>
              </div>
            )}
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2)" }}>Toplam kayıt:</span>{" "}
              <span style={{ fontSize: 13, fontWeight: 700 }}>{pendingImport.total}</span>
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2)" }}>Tekrar eden (atlanacak):</span>{" "}
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--acc)" }}>{pendingImport.duplicateCount}</span>
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2)" }}>Yeni eklenecek:</span>{" "}
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ok)" }}>{pendingImport.newCount}</span>
            </div>
          </div>
          {pendingImport.duplicates.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--tx2)" }}>Tekrar Eden Kayıtlar (Atlanacak):</div>
              <div style={{ maxHeight: 200, overflowY: "auto", border: "1.5px solid var(--brd)", borderRadius: "var(--r)", padding: 8, background: "var(--s2)" }}>
                {pendingImport.duplicates.slice(0, 10).map((rec, idx) => (
                  <div key={idx} style={{ padding: "6px 8px", background: "var(--s1)", border: "1px solid var(--brd)", borderRadius: 6, marginBottom: 6, fontSize: 11 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span><b>Barkod:</b> {rec.barcode}</span>
                      <span className="badge" style={{ background: "var(--acc2)", color: "var(--acc)" }}>
                        Sistemde var
                      </span>
                    </div>
                    {rec.shift && <div><b>Vardiya:</b> {rec.shift} • <b>Tarih:</b> {deriveShiftDate(rec)}</div>}
                  </div>
                ))}
                {pendingImport.duplicates.length > 10 && (
                  <div style={{ fontSize: 11, color: "var(--tx3)", textAlign: "center", marginTop: 8 }}>
                    ... ve {pendingImport.duplicates.length - 10} tane daha
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
