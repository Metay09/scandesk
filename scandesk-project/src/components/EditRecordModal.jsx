import { Ic, I } from "./Icon";
import Modal from "./Modal";
import FieldInput from "./FieldInput";
import { useFormState } from "../hooks/useFormState";

export default function EditRecordModal({ record, fields, customers, onSave, onClose }) {
  const [form, set] = useFormState({ ...record });
  const allF = [{ id: "barcode", label: "Barkod", type: "Metin" }, ...fields.filter(f => f.id !== "barcode")];

  const footer = (
    <>
      <button className="btn btn-ok" style={{ flex: 1 }} onClick={() => { onSave(form); onClose(); }}>
        <Ic d={I.save} s={16} /> Güncelle
      </button>
      <button className="btn btn-ghost" style={{ width: 88 }} onClick={onClose}>İptal</button>
    </>
  );

  return (
    <Modal title="Kaydı Düzenle" icon={I.edit} onClose={onClose} footer={footer}>
      {allF.map(f => (
        <div key={f.id}>
          <label className="lbl">{f.label}</label>
          <FieldInput field={f} value={form[f.id]} onChange={(v) => set(f.id, v)} />
        </div>
      ))}
      <div>
        <label className="lbl">Müşteri</label>
        <input
          type="text"
          list="edit-customer-suggestions"
          value={form.customer || ""}
          onChange={e => set("customer", e.target.value)}
          placeholder="Müşteri adı girin veya seçin..."
        />
        <datalist id="edit-customer-suggestions">
          <option value="-Boş-" />
          <option value="" />
          {customers.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div style={{ padding: "9px 12px", background: "var(--pur2)", border: "1.5px solid var(--pur3)", borderRadius: "var(--r)", fontSize: 12, color: "var(--pur)", display: "flex", alignItems: "center", gap: 7 }}>
        <Ic d={I.sig} s={13} /> Kaydeden: <b>{form.scanned_by}</b>
      </div>
      {form.inheritedFromShift && (
        <div style={{ padding: "9px 12px", background: "var(--s2)", border: "1.5px solid var(--brd)", borderRadius: "var(--r)", fontSize: 12, color: "var(--tx2)", display: "flex", alignItems: "center", gap: 7 }}>
          <Ic d={I.upload} s={13} /> Bu kayıt <b>{form.inheritedFromShift}</b> vardiyasından devralındı
        </div>
      )}
    </Modal>
  );
}
