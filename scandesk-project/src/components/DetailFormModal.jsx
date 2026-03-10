import { useEffect, useRef } from "react";
import { Ic, I } from "./Icon";
import Modal from "./Modal";
import FieldInput from "./FieldInput";

export default function DetailFormModal({ barcode, fields, extras, onExtrasChange, onSave, onClose }) {
  const firstFieldRef = useRef(null);

  // Auto-focus first field when modal opens
  useEffect(() => {
    if (firstFieldRef.current) {
      setTimeout(() => {
        firstFieldRef.current?.focus();
      }, 100);
    }
  }, []);

  // Handle Enter key navigation between fields
  const handleFieldKeyDown = (e, fieldIndex) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (fieldIndex < fields.length - 1) {
        // Move to next field
        const nextInput = e.target.closest('.modal-bd')?.querySelectorAll('input, select, textarea')[fieldIndex + 1];
        nextInput?.focus();
      } else {
        // Last field - save
        onSave();
      }
    }
  };

  const footer = (
    <>
      <button className="btn btn-ok" style={{ flex: 1 }} onClick={onSave}>
        <Ic d={I.save} s={16} /> Kaydet
      </button>
      <button className="btn btn-ghost" style={{ width: 88 }} onClick={onClose}>İptal</button>
    </>
  );

  return (
    <Modal title="Detay Ekle" icon={I.edit} onClose={onClose} footer={footer}>
      <div>
        <label className="lbl">Taranan Barkod</label>
        <div style={{
          padding: "10px 12px",
          background: "var(--s2)",
          border: "1.5px solid var(--brd)",
          borderRadius: "var(--r)",
          fontFamily: "var(--mono)",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--acc)"
        }}>
          {barcode}
        </div>
      </div>
      {fields.map((f, i) => (
        <div key={f.id}>
          <label className="lbl">{f.label}{f.required ? " *" : ""}</label>
          <FieldInput
            ref={i === 0 ? firstFieldRef : null}
            field={f}
            value={extras[f.id] || ""}
            onChange={(v) => onExtrasChange(f.id, v)}
            onKeyDown={(e) => handleFieldKeyDown(e, i)}
          />
        </div>
      ))}
    </Modal>
  );
}
