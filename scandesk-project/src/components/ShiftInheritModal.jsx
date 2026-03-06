import { useState } from "react";
import { Ic, I } from "./Icon";
import { fmtDate, FIXED_SHIFTS, toggleSetMember } from "../utils";
import Modal from "./Modal";

export default function ShiftInheritModal({ currentShift, records, onCopy, onClose }) {
  const today = fmtDate();

  const allLabels = FIXED_SHIFTS.map(s => s.label);
  const otherShifts = allLabels.filter(s => s !== currentShift);
  const defaultSrc = otherShifts[0] || currentShift;

  const [sourceShift, setSourceShift] = useState(defaultSrc);

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

  const handleSourceChange = (src) => {
    setSourceShift(src);
    const next = buildCandidates(src);
    setCandidates(next);
    setSelected(new Set(next.map(r => r.id)));
  };

  const toggle = (id) => setSelected(p => toggleSetMember(p, id));

  const allSelected = candidates.length > 0 && candidates.every(r => selected.has(r.id));

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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--tx2)" }}>
                  {candidates.length} kayıt · <b>{selected.size}</b> seçili
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(candidates.map(r => r.id)))
                }>
                  {allSelected ? "Tümünü Kaldır" : "Tümünü Seç"}
                </button>
              </div>
              <div style={{ maxHeight: 240, overflow: "auto", border: "1.5px solid var(--brd)", borderRadius: "var(--r)", padding: 4 }}>
                {candidates.map((r, i) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: i === candidates.length - 1 ? "none" : "1px solid var(--brd)", cursor: "pointer" }}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bc" style={{ fontWeight: 800 }}>{r.barcode}</div>
                      <div style={{ fontSize: 11, color: "var(--tx3)" }}>
                        {r.customer || "—"} · {r.scanned_by || "—"} · {r.time || ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
