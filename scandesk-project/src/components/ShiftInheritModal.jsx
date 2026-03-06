import { useState, useMemo } from "react";
import { Ic, I } from "./Icon";
import { fmtDate, FIXED_SHIFTS, toggleSetMember } from "../utils";
import Modal from "./Modal";

export default function ShiftInheritModal({ currentShift, records, onCopy, onClose }) {
  const today = fmtDate();

  const allLabels = FIXED_SHIFTS.map(s => s.label);
  const otherShifts = allLabels.filter(s => s !== currentShift);
  const defaultSrc = otherShifts[0] || currentShift;

  const [sourceShift, setSourceShift] = useState(defaultSrc);
  const [customerFilter, setCustomerFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const buildCandidates = (src) => {
    const currentBarcodes = new Set(
      (records || []).filter(r => r.shift === currentShift && r.date === today).map(r => r.barcode)
    );
    return (records || [])
      .filter(r => r.shift === src && r.date === today && !currentBarcodes.has(r.barcode))
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  };

  const [candidates, setCandidates] = useState(() => buildCandidates(defaultSrc));
  const [selected, setSelected]     = useState(() => new Set(buildCandidates(defaultSrc).map(r => r.id)));

  // Get unique customers from candidates
  const uniqueCustomers = useMemo(() => {
    const customers = [...new Set(candidates.map(r => r.customer).filter(Boolean))].sort();
    return customers;
  }, [candidates]);

  // Apply filters
  const filteredCandidates = useMemo(() => {
    return candidates.filter(r => {
      // Customer filter
      if (customerFilter !== "all" && r.customer !== customerFilter) return false;

      // Search query filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const barcode = String(r.barcode || "").toLowerCase();
        const customer = String(r.customer || "").toLowerCase();
        const scannedBy = String(r.scanned_by || "").toLowerCase();

        if (!barcode.includes(query) && !customer.includes(query) && !scannedBy.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [candidates, customerFilter, searchQuery]);

  const handleSourceChange = (src) => {
    setSourceShift(src);
    const next = buildCandidates(src);
    setCandidates(next);
    setSelected(new Set(next.map(r => r.id)));
    setCustomerFilter("all");
    setSearchQuery("");
  };

  const toggle = (id) => setSelected(p => toggleSetMember(p, id));

  const allFilteredSelected = filteredCandidates.length > 0 && filteredCandidates.every(r => selected.has(r.id));

  const footer = (
    <>
      <button
        className="btn btn-ok"
        style={{ flex: 1 }}
        disabled={selected.size === 0 || candidates.length === 0}
        onClick={() => onCopy(sourceShift, [...selected])}
      >
        <Ic d={I.save} s={15} /> Seçilenleri Kopyala ({selected.size})
      </button>
      <button className="btn btn-ghost" style={{ width: 88 }} onClick={onClose}>İptal</button>
    </>
  );

  return (
    <Modal title="Vardiyadan Devral" icon={I.upload} onClose={onClose} footer={footer}>
      {otherShifts.length === 0 ? (
        <div style={{ color: "var(--tx3)", fontSize: 13 }}>Başka vardiya yok.</div>
      ) : (
        <>
          <div>
            <label className="lbl">Kaynak Vardiya</label>
            <select value={sourceShift} onChange={e => handleSourceChange(e.target.value)}>
              {otherShifts.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {candidates.length === 0 ? (
            <div style={{ color: "var(--tx3)", fontSize: 13, marginTop: 12 }}>
              Bu vardiyada devralınacak kayıt yok.
              <div style={{ fontSize: 11, marginTop: 4 }}>(Mevcut vardiyada zaten var veya hiç kayıt yok.)</div>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div style={{ marginTop: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <div className="srch" style={{ flex: "1 1 140px", minWidth: 120 }}>
                    <span className="srch-ico"><Ic d={I.search} s={16} /></span>
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Ara..."
                    />
                  </div>
                  {uniqueCustomers.length > 0 && (
                    <div style={{ flex: "1 1 140px", minWidth: 120 }}>
                      <select
                        value={customerFilter}
                        onChange={e => setCustomerFilter(e.target.value)}
                        style={{
                          width: "100%",
                          height: 40,
                          borderRadius: 10,
                          padding: "0 10px",
                          background: "var(--s2)",
                          color: "var(--tx)",
                          border: "1.5px solid var(--brd)",
                          fontSize: 12,
                          fontWeight: 600
                        }}
                      >
                        <option value="all">Tüm Müşteriler</option>
                        {uniqueCustomers.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                {(customerFilter !== "all" || searchQuery) && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setCustomerFilter("all"); setSearchQuery(""); }}
                    style={{ fontSize: 11 }}
                  >
                    <Ic d={I.close} s={12} /> Filtreleri Temizle
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--tx2)" }}>
                  {filteredCandidates.length} kayıt · <b>{selected.size}</b> seçili
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() =>
                  setSelected(allFilteredSelected ? new Set() : new Set([...selected, ...filteredCandidates.map(r => r.id)]))
                }>
                  {allFilteredSelected ? "Görünenleri Kaldır" : "Görünenleri Seç"}
                </button>
              </div>

              <div style={{ maxHeight: 240, overflow: "auto", border: "1.5px solid var(--brd)", borderRadius: "var(--r)", padding: 4, background: "var(--s1)" }}>
                {filteredCandidates.length === 0 ? (
                  <div style={{ color: "var(--tx3)", fontSize: 12, padding: 12, textAlign: "center" }}>
                    Filtreye uygun kayıt bulunamadı
                  </div>
                ) : (
                  filteredCandidates.map((r, i) => (
                    <label
                      key={r.id}
                      className="chk-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 6px",
                        borderBottom: i === filteredCandidates.length - 1 ? "none" : "1px solid var(--brd)",
                        cursor: "pointer",
                        background: selected.has(r.id) ? "var(--s2)" : "transparent",
                        borderRadius: 6,
                        margin: "2px 0"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="bc" style={{ fontWeight: 800 }}>{r.barcode}</div>
                        <div style={{ fontSize: 11, color: "var(--tx3)" }}>
                          {r.customer || "—"} · {r.scanned_by || "—"} · {r.time || ""}
                        </div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
