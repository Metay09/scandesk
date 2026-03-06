import { useState } from "react";
import { Ic, I } from "./Icon";

export default function CustomerModal({ customers, selected, onSelect, onClose, onAdd, onRemove, isAdmin }) {
  const [newName, setNewName] = useState("");
  const add = () => { if (newName.trim()) { onAdd(newName.trim()); setNewName(""); } };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <span className="modal-title"><Ic d={I.group} s={16} />Müşteri Seç</span>
          <button className="x-btn" onClick={onClose}><Ic d={I.x} s={15} /></button>
        </div>
        <div className="modal-bd">
          {isAdmin && (
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Yeni müşteri adı..." onKeyDown={e => e.key === "Enter" && add()} />
              <button className="btn btn-primary btn-sm" onClick={add}><Ic d={I.plus} s={15} /></button>
            </div>
          )}
          {customers.length === 0 && <p style={{ color: "var(--tx3)", fontSize: 13, textAlign: "center" }}>Henüz müşteri eklenmedi</p>}
          {customers.map(c => (
            <div key={c} onClick={() => { onSelect(c); onClose(); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                background: selected === c ? "var(--inf2)" : "var(--s2)",
                border: `1.5px solid ${selected === c ? "var(--inf3)" : "var(--brd)"}`,
                borderRadius: "var(--r)", cursor: "pointer" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: selected === c ? "var(--inf)" : "var(--tx3)", flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: selected === c ? "var(--inf)" : "var(--tx)" }}>{c}</span>
              {selected === c && <Ic d={I.check} s={15} />}
              {isAdmin && selected !== c && (
                <button className="btn btn-danger btn-sm" style={{ height: 30, padding: "0 8px" }}
                  onClick={e => { e.stopPropagation(); onRemove(c); }}>
                  <Ic d={I.del} s={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
