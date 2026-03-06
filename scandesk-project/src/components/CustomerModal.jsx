import { useState } from "react";
import { Ic, I } from "./Icon";
import Modal from "./Modal";

export default function CustomerModal({ customers, onClose, onAdd, onRemove, isAdmin }) {
  const [newName, setNewName] = useState("");
  const add = () => { if (newName.trim()) { onAdd(newName.trim()); setNewName(""); } };
  return (
    <Modal title="Müşteri Yönet" icon={I.group} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="Yeni müşteri adı..." onKeyDown={e => e.key === "Enter" && add()} />
        <button className="btn btn-primary btn-sm" onClick={add}><Ic d={I.plus} s={15} /></button>
      </div>
      {customers.length === 0 && <p style={{ color: "var(--tx3)", fontSize: 13, textAlign: "center" }}>Henüz müşteri eklenmedi</p>}
      {customers.map(c => (
        <div key={c}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
            background: "var(--s2)",
            border: "1.5px solid var(--brd)",
            borderRadius: "var(--r)", marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--tx)" }}>{c}</span>
          <button className="btn btn-danger btn-sm" style={{ height: 30, padding: "0 8px" }}
            onClick={() => onRemove(c)}>
            <Ic d={I.del} s={13} />
          </button>
        </div>
      ))}
    </Modal>
  );
}
