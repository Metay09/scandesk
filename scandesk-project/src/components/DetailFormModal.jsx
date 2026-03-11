import { useEffect, useRef } from "react";
import { Ic, I } from "./Icon";
import Modal from "./Modal";
import FieldInput from "./FieldInput";
import CustomerPicker from "./CustomerPicker";

export default function DetailFormModal({ barcode, fields, extras, onExtrasChange, note, onNoteChange, customer, onCustomerChange, customerList, onCustomerAdd, onCustomerRemove, canManageCustomers, onSave, onClose }) {
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
      if (fieldIndex < fields.length) {
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
      {/* Note field (styled like customer) */}
      <div style={{ width: "100%" }}>
        <label className="lbl" style={{ marginBottom: 4, fontSize: 12 }}>Not</label>
        <input
          ref={firstFieldRef}
          type="text"
          value={note || ""}
          onChange={(e) => onNoteChange(e.target.value)}
          onKeyDown={(e) => handleFieldKeyDown(e, -1)}
          placeholder="Not girin..."
          style={{
            width: "100%",
            height: 40,
            borderRadius: 10,
            padding: "0 12px",
            background: "var(--s2)",
            color: "var(--tx)",
            border: "1.5px solid var(--brd)",
            fontSize: 13,
            fontWeight: 700,
          }}
        />
      </div>
      {fields.map((f, i) => (
        <div key={f.id}>
          <label className="lbl">{f.label}{f.required ? " *" : ""}</label>
          <FieldInput
            field={f}
            value={extras[f.id] || ""}
            onChange={(v) => onExtrasChange(f.id, v)}
            onKeyDown={(e) => handleFieldKeyDown(e, i)}
          />
        </div>
      ))}
      {customerList && (
        <div>
          <CustomerPicker
            label="Müşteri"
            customers={customerList}
            value={customer || ""}
            onChange={onCustomerChange}
            canManage={canManageCustomers}
            onAdd={canManageCustomers ? onCustomerAdd : undefined}
            onRemove={canManageCustomers ? onCustomerRemove : undefined}
          />
        </div>
      )}
    </Modal>
  );
}
