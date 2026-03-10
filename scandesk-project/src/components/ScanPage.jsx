import { useState, useEffect, useRef, useCallback } from "react";
import { Ic, I } from "./Icon";
import { genId } from "../constants";
import { fmtDate, fmtTime, nowTs, playBeep, getCurrentShift, FIXED_SHIFTS, getCustomerList, getShiftDate, deriveShiftDate } from "../utils";
import { supabaseInsert, sheetsInsert } from "../services/integrations";
import { getDynamicFieldValue, toDbPayload } from "../services/recordModel";
import EditRecordModal from "./EditRecordModal";
import CustomerPicker from "./CustomerPicker";
import ShiftInheritModal from "./ShiftInheritModal";
import ShiftTakeoverPrompt from "./ShiftTakeoverPrompt";
import FieldInput from "./FieldInput";

export default function ScanPage({ fields, onSave, onEdit, onSyncUpdate, records, lastSaved, customers, isAdmin, user, integration, scanSettings, toast, shiftExpired = false, shiftTakeovers = {}, onShiftTakeover }) {
  const customerList = getCustomerList(customers);
  const normalizeCustomer = (val) => val === "-Boş-" ? "" : val;
  const inputRef  = useRef(null);
  const focusTimer = useRef(null);
  const bulkModeRef = useRef(false);
  const addDetailAfterScanRef = useRef(false);

  const [barcode, setBarcode]     = useState("");
  const [extras, setExtras]       = useState({});
  const [flash, setFlash]         = useState("ready");
  const [customer, setCustomer]   = useState(() => {
    // Load from localStorage, default to empty string
    try {
      const saved = localStorage.getItem("scandesk_default_customer") || "";
      return normalizeCustomer(saved);
    } catch {
      return "";
    }
  });
  const [pendingBc, setPendingBc] = useState(null);

  const [bulkMode, setBulkMode]   = useState(false);
  const [bulkList, setBulkList]   = useState([]);
  const [editDupRec, setEditDupRec] = useState(null);
  const [inheritModal, setInheritModal] = useState(false);
  const recentRef = useRef(new Map());
  const onBarcodeRef = useRef(null);
  const firstFieldRef = useRef(null);
  const expectedBarcodeLength = useRef(null);

  // Vardiya devralma: giriş anında kontrol
  const [showTakeoverPrompt, setShowTakeoverPrompt] = useState(false);
  const takeoverChecked = useRef(false);
  useEffect(() => {
    if (takeoverChecked.current || isAdmin) return;
    takeoverChecked.current = true;
    const loginShift = getCurrentShift();
    const loginDate = getShiftDate(undefined, loginShift);
    const key = `${loginDate}_${loginShift}`;
    if (!(shiftTakeovers || {})[key]) {
      setShowTakeoverPrompt(true);
    }
  }, [isAdmin, shiftTakeovers]);

  const handleTakeoverAccept = () => {
    const loginShift = getCurrentShift();
    const loginDate = getShiftDate(undefined, loginShift);
    onShiftTakeover?.(loginShift, loginDate);
    setShowTakeoverPrompt(false);
    setInheritModal(true);
  };

  const handleTakeoverCancel = () => {
    setShowTakeoverPrompt(false);
  };

  const { autoSave, addDetailAfterScan, vibration, beep, recentLimit = 10 } = scanSettings;

  // Admin: vardiya seçebilir; normal kullanıcı: saate göre otomatik
  const [adminShift, setAdminShift] = useState(() => getCurrentShift());
  const [userShift, setUserShift] = useState(() => getCurrentShift());

  // Update user shift periodically for non-admin users
  useEffect(() => {
    if (isAdmin) return;
    const interval = setInterval(() => {
      setUserShift(getCurrentShift());
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [isAdmin]);

  const currentShift = isAdmin ? adminShift : userShift;
  const currentShiftDate = getShiftDate(undefined, currentShift);

  useEffect(() => { bulkModeRef.current = bulkMode; }, [bulkMode]);
  useEffect(() => { addDetailAfterScanRef.current = addDetailAfterScan; }, [addDetailAfterScan]);

  // Persist customer selection to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("scandesk_default_customer", customer);
    } catch (e) {
      console.error("Failed to save customer to localStorage:", e);
    }
  }, [customer]);

  const scheduleFocus = useCallback(() => {
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus({ preventScroll: true });
      }
    }, 120);
  }, []);

  useEffect(() => { scheduleFocus(); }, [scheduleFocus]);

  // Auto-save when barcode length matches expected length
  useEffect(() => {
    if (!autoSave) return; // Auto-save must be enabled
    if (!scanSettings.enforceBarcodeLengthMatch) return; // Length enforcement must be enabled
    if (expectedBarcodeLength.current === null) return; // Expected length must be set
    if (pendingBc) return; // Don't trigger if detail form is shown
    if (addDetailAfterScan) return; // Don't trigger if detail form is configured

    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return; // Empty barcode
    if (trimmedBarcode.length !== expectedBarcodeLength.current) return; // Length doesn't match

    // All conditions met - auto-save the barcode
    onBarcode(trimmedBarcode);
  }, [barcode, autoSave, scanSettings.enforceBarcodeLengthMatch, expectedBarcodeLength, pendingBc, addDetailAfterScan]);

  const handleCustomerSelect = (val) => {
    setCustomer(normalizeCustomer(val));
    scheduleFocus();
  };

  /* ── Helpers ── */
  const normalizeCode = (c) => String(c ?? "").trim();
  const findExistingRec = (bc) => (records || []).find(r => {
    const rBc = String(r.barcode ?? "").trim();
    const rShift = String(r.shift ?? "");
    const rDate = deriveShiftDate(r);
    return rBc === bc && rShift === String(currentShift ?? "") && rDate === currentShiftDate;
  });
  const canAcceptCode = (bc) => {
    if (!bc) return { ok:false, msg:null };

    // Barcode length validation
    if (scanSettings.enforceBarcodeLengthMatch) {
      if (expectedBarcodeLength.current === null) {
        // First barcode - set the expected length
        expectedBarcodeLength.current = bc.length;
      } else if (bc.length !== expectedBarcodeLength.current) {
        // Length mismatch
        return {
          ok: false,
          msg: `⚠ Barkod uzunluğu ${expectedBarcodeLength.current} olmalı (okunan: ${bc.length})`
        };
      }
    }

    const now = Date.now();
    const last = recentRef.current.get(bc);
    if (last && (now - last) < (scanSettings.scanDebounceMs || 800)) return { ok:false, msg:"⚠ Çift okuma engellendi" };
    recentRef.current.set(bc, now);
    if (findExistingRec(bc)) return { ok:false, msg:"⚠ Bu barkod bu vardiyada zaten var", dup:true };
    if (bulkMode && bulkList.some(x => x.code === bc)) return { ok:false, msg:"⚠ Bu kod zaten listede" };
    return { ok:true, msg:null };
  };

  const onBarcode = (code) => {
    if (shiftExpired && !isAdmin) { toast("Vardiya sona erdi — okutma devre dışı", "var(--err)"); return false; }
    const bc = normalizeCode(code);
    const chk = canAcceptCode(bc);
    if (!chk.ok) {
      if (chk.dup) {
        const ex = findExistingRec(bc);
        if (ex) setEditDupRec(ex);
      }
      if (chk.msg) toast(chk.msg, "var(--err)");
      if (scanSettings.vibration && navigator.vibrate) navigator.vibrate([120, 80, 120]);
      if (scanSettings.beep) playBeep();
      scheduleFocus();
      return false;
    }

    if (bulkMode) {
      setBulkList(p => [{ code: bc, ts: new Date().toISOString() }, ...p]);
      setBarcode("");
      setFlash("saved");
      setTimeout(() => { setFlash("ready"); scheduleFocus(); }, 500);
      if (scanSettings.vibration && navigator.vibrate) navigator.vibrate([25, 15, 25]);
      if (scanSettings.beep) playBeep();
      toast("➕ Listeye eklendi", "var(--inf)");
      return true;
    }

    doSaveCode(bc, {});
    return true;
  };
  onBarcodeRef.current = onBarcode;

  /* ── Save ── */
  const doSaveCode = useCallback((code, extrasOverride) => {
    const bc = (code || "").trim();
    if (!bc) { scheduleFocus(); return; }
    if (shiftExpired && !isAdmin) {
      toast("Vardiya sona erdi — okutma devre dışı", "var(--err)");
      scheduleFocus();
      return;
    }
    const ex = findExistingRec(bc);
    if (ex) {
      setEditDupRec(ex);
      toast("⚠ Bu barkod bu vardiyada zaten var", "var(--err)");
      if (vibration && navigator.vibrate) navigator.vibrate([120, 80, 120]);
      if (beep) playBeep();
      scheduleFocus();
      return;
    }
    const now = new Date();
    const extraFields = fields.filter(f => f.id !== "barcode");
    const dateStr = fmtDate(now);
    // Admin: seçilen vardiyayı kullan; normal kullanıcı: saate göre otomatik
    const shift = isAdmin ? adminShift : getCurrentShift();
    const shiftDate = getShiftDate(now, shift);

    // Create customFields object for dynamic fields
    const customFields = {};
    extraFields.forEach(f => {
      const v = (extrasOverride ?? extras)[f.id];
      customFields[f.id] = (f.type === "Tarih" && !v) ? now.toISOString().slice(0, 10) : (v ?? "");
    });

    // Build record with fixed fields + customFields
    const row = {
      id: genId(),
      barcode: bc,
      timestamp: now.toISOString(),
      date: dateStr,
      time: fmtTime(now),
      shift,
      shiftDate,
      customer: customer || "",
      scanned_by: user.name,
      scanned_by_username: user.username,
      synced: false,
      syncStatus: "pending",
      syncError: "",
      source: "scan",
      inheritedFromShift: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      customFields,
    };

    onSave(row);
    setBarcode(""); setExtras({}); setPendingBc(null);
    setFlash("saved");
    setTimeout(() => { setFlash("ready"); scheduleFocus(); }, 700);
    if (vibration && navigator.vibrate) navigator.vibrate([25, 15, 25]);
    if (beep) playBeep();

    if (integration.active) {
      const ef = fields.filter(f => f.id !== "barcode");
      const headers = ["Barkod", ...ef.map(f => f.label), "Müşteri", "Kaydeden", "Kullanıcı Adı", "Tarih", "Saat"];
      // Flatten customFields for sync payload
      const rowArr  = [row.id, bc, ...ef.map(f => row.customFields[f.id] ?? ""), row.customer, row.scanned_by, row.scanned_by_username, now.toLocaleDateString("tr-TR"), now.toLocaleTimeString("tr-TR")];
      if (integration.type === "supabase") {
        // Convert camelCase to snake_case for PostgreSQL compatibility
        const dbPayload = toDbPayload(row);
        supabaseInsert(integration.supabase, dbPayload)
          .then(() => onSyncUpdate?.(row.id))
          .catch(e => toast("Supabase hatası: " + e.message, "var(--err)"));
      } else {
        // no-cors: fetch resolves with opaque response regardless of server outcome;
        // synced:true means the request was sent, not that the server confirmed it.
        sheetsInsert(integration.gsheets, headers, rowArr)
          .then(() => onSyncUpdate?.(row.id))
          .catch(e => toast("Sheets hatası: " + e.message, "var(--err)"));
      }
    }
  }, [customer, extras, fields, user, onSave, onSyncUpdate, scheduleFocus, vibration, beep, integration, toast, records, isAdmin, adminShift, shiftExpired]);

  const doSave = useCallback(() => {
    if (pendingBc) doSaveCode(pendingBc, extras);
    else doSaveCode(barcode, extras);
  }, [pendingBc, barcode, extras, doSaveCode]);

  const copyFromShift = useCallback((sourceShift, selectedIds) => {
    const targetShift = isAdmin ? adminShift : getCurrentShift();
    const todayStr = getShiftDate(undefined, targetShift);
    // Admin: seçilen vardiyaya kopyalar; normal kullanıcı: saate göre otomatik
    const selectedSet = new Set(selectedIds);
    const currentBarcodes = new Set(
      (records || []).filter(r => r.shift === targetShift && deriveShiftDate(r) === todayStr).map(r => r.barcode)
    );
    const toCopy = (records || []).filter(r =>
      r.shift === sourceShift &&
      deriveShiftDate(r) === todayStr &&
      selectedSet.has(r.id) &&
      !currentBarcodes.has(r.barcode)
    );
    const now = new Date();
    const copyDateStr = getShiftDate(now, targetShift);
    toCopy.forEach(r => {
      // Create new record maintaining customFields structure
      const newRecord = {
        ...r,
        id: genId(),
        timestamp: now.toISOString(),
        date: copyDateStr,
        time: fmtTime(now),
        shift: targetShift,
        shiftDate: copyDateStr,
        inheritedFromShift: sourceShift,
        synced: false,
        syncStatus: "pending",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        // Preserve customFields
        customFields: r.customFields || {}
      };
      onSave(newRecord);
    });
    setInheritModal(false);
    if (toCopy.length > 0) {
      toast(`✓ ${toCopy.length} kayıt ${sourceShift} vardiyasından kopyalandı`, "var(--ok)");
    } else {
      toast("Kopyalanacak kayıt bulunamadı", "var(--acc)");
    }
  }, [records, onSave, toast, isAdmin, adminShift]);

  const handleKey = e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const bc = barcode.trim();
    // Show detail form if setting is enabled, otherwise use autoSave behavior
    if (addDetailAfterScan && bc && !pendingBc) {
      setPendingBc(bc);
      return;
    }
    if (pendingBc) {
      doSave();
      return;
    }
    if (autoSave) onBarcode(bc);
  };

  const extraFields = fields.filter(f => f.id !== "barcode");

  // Auto-focus first field when detail form appears
  useEffect(() => {
    if (pendingBc && firstFieldRef.current) {
      setTimeout(() => {
        firstFieldRef.current?.focus();
      }, 100);
    }
  }, [pendingBc]);

  // Handle Enter key navigation in detail form
  const handleFieldKeyDown = (e, fieldIndex) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (fieldIndex < extraFields.length - 1) {
        // Move to next field
        const nextInput = e.target.closest('.detail-form')?.querySelectorAll('input, select, textarea')[fieldIndex + 1];
        nextInput?.focus();
      } else {
        // Last field - save
        doSave();
      }
    }
  };

  return (
    <div className="page">
      {/* Vardiya Bilgisi — admin seçebilir, kullanıcı sadece görür */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "7px 12px", background: "var(--card)", border: "1.5px solid var(--brd)", borderRadius: "var(--r)", fontSize: 12 }}>
        <Ic d={I.fields} s={14} />
        <span style={{ color: "var(--tx2)", fontWeight: 600 }}>Vardiya:</span>
        {isAdmin ? (
          <div style={{ display: "flex", gap: 4, flex: 1 }}>
            {FIXED_SHIFTS.map(s => (
              <button
                key={s.label}
                type="button"
                className={`btn btn-sm ${adminShift === s.label ? "btn-info" : "btn-ghost"}`}
                style={{ flex: 1, fontSize: 12, fontWeight: adminShift === s.label ? 800 : 500 }}
                onClick={() => setAdminShift(s.label)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <span style={{ fontWeight: 800, color: "var(--acc)" }}>{currentShift}</span>
        )}
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--tx)",
          background: "var(--s2)",
          border: "1.5px solid var(--brd)",
          borderRadius: 8,
          padding: "4px 10px"
        }}>{currentShiftDate}</span>
        <span style={{ color: "var(--tx3)", fontFamily: "var(--mono)", fontSize: 11 }}>{fmtTime()}</span>
      </div>

      {/* Vardiya sona erdi uyarısı */}
      {shiftExpired && !isAdmin && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
          padding: "10px 14px", background: "var(--err)", borderRadius: "var(--r)",
          color: "#fff", fontSize: 13, fontWeight: 700
        }}>
          <Ic d={I.lock} s={16} /> Vardiyanız sona erdi. Okutma devre dışı — verilerinizi dışa aktarabilirsiniz.
        </div>
      )}

      {/* Müşteri */}
      <div className="cust-bar">
        <CustomerPicker
          customers={customerList}
          value={customer}
          onChange={handleCustomerSelect}
          onClose={scheduleFocus}
          canManage={true}
          onAdd={customers.add}
          onRemove={customers.remove}
        />
      </div>

      {/* Status */}
      <div className={`status-bar ${flash === "saved" ? "s-saved" : "s-ready"}`}>
        {flash === "saved" ? <><Ic d={I.check} s={16} /> Kaydedildi!</>
         : <><div className="pulse" style={{ color: "var(--ok)" }} /> {autoSave ? "Hazır — okutun" : "Okutun, ardından Kaydet'e basın"}</>}
      </div>

      {/* Detail form */}
      {pendingBc && addDetailAfterScan ? (
        <div className="detail-form">
          <div><label className="lbl">Taranan Barkod</label><div className="detail-bc">{pendingBc}</div></div>
          {extraFields.map((f, i) => (
            <div key={f.id}>
              <label className="lbl">{f.label}{f.required ? " *" : ""}</label>
              <FieldInput
                ref={i === 0 ? firstFieldRef : null}
                field={f}
                value={extras[f.id]}
                onChange={(v) => setExtras(p => ({ ...p, [f.id]: v }))}
                onKeyDown={(e) => handleFieldKeyDown(e, i)}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ok" style={{ flex: 1 }} onClick={doSave}><Ic d={I.save} s={16} /> Kaydet</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPendingBc(null); setBarcode(""); setExtras({}); scheduleFocus(); }}>İptal</button>
          </div>
        </div>
      ) : (
        <>
          {/* Barcode input */}
          <div className="bc-wrap">
            <span className="bc-icon"><Ic d={I.barcode} s={22} /></span>
            <input
              ref={inputRef}
              className="barcode-input"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              onKeyDown={handleKey}
              placeholder={shiftExpired && !isAdmin ? "Vardiya sona erdi — okutma devre dışı" : "Barkod okutun veya girin..."}
              disabled={shiftExpired && !isAdmin}
              autoComplete="off" autoCorrect="off"
              autoCapitalize="none" spellCheck={false} inputMode="text"
            />
          </div>

          {/* Toplu Mod */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
            <button type="button" className={`btn btn-sm ${bulkMode ? "btn-info" : "btn-ghost"}`} onClick={() => {
              if (bulkMode) {
                const n = bulkList.length;
                setBulkMode(false);
                setBulkList([]);
                toast(n ? `⚠ Kaydedilmemiş ${n} barkod vardı. Toplu mod kapatıldı.` : "Toplu mod kapandı", "var(--inf)");
              } else {
                setBulkMode(true);
                toast("Toplu mod açıldı", "var(--inf)");
              }
            }}>
              <Ic d={I.group} s={14} /> Toplu Mod
            </button>
            {bulkMode && (
              <>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setBulkList([])}><Ic d={I.trash} s={14} /> Temizle</button>
                <button type="button" className="btn btn-ok btn-sm" onClick={() => {
                  if (!bulkList.length) { toast("Kaydedilecek veri yok", "var(--acc)"); return; }
                  const list = [...bulkList].reverse();
                  list.forEach(x => doSaveCode(x.code, extras));
                  setBulkList([]);
                  setBulkMode(false);
                  toast(`✓ ${list.length} kayıt kaydedildi. Toplu mod kapatıldı.`, "var(--ok)");
                }}>
                  <Ic d={I.save} s={14} /> Toplu Kaydet ({bulkList.length})
                </button>
              </>
            )}
          </div>

          {bulkMode && bulkList.length > 0 && (
            <div style={{ marginBottom: 10, maxHeight: 160, overflow: "auto", border: "1.5px solid var(--brd)", borderRadius: "var(--r)", padding: 8, background: "var(--card)" }}>
              {bulkList.map((x, i) => (
                <div key={x.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: i === bulkList.length - 1 ? "none" : "1px solid var(--brd)" }}>
                  <span className="bc" style={{ flex: 1 }}>{x.code}</span>
                  <button className="btn btn-danger btn-sm" style={{ height: 28 }} onClick={() => setBulkList(p => p.filter(y => y.code !== x.code))}><Ic d={I.del} s={12} /></button>
                </div>
              ))}
            </div>
          )}

          {!autoSave && (
            <button className="btn btn-ok btn-full btn-lg" style={{ marginBottom: 10 }} onClick={doSave}>
              <Ic d={I.save} s={20} /> Kaydet
            </button>
          )}
        </>
      )}

      {/* Signature bar */}
      <div className="sig-bar">
        <Ic d={I.sig} s={14} />
        <span><span style={{ color: 'var(--acc)' }}>İmza:</span> <b>{user.name}</b> ({user.username})</span>
        {autoSave && <span style={{ opacity: .7 }}>· otomatik kayıt</span>}
        {integration.active && <span style={{ marginLeft: "auto", opacity: .7, fontSize: 11 }}>→ {integration.type === "supabase" ? "Supabase" : "Sheets"}</span>}
      </div>

      {/* Son Okutmalar */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--tx2)', fontWeight: 800, marginBottom: 6 }}>Son Okutmalar</div>

        {(() => {
          const todayShift = currentShiftDate;
          const all = (records || []).filter(r => r.shift === currentShift && deriveShiftDate(r) === todayShift).slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
          const lim = scanSettings.recentLimit;
          const view = (lim === 0 || lim === "0" || lim === "full") ? all : all.slice(0, Number(lim || 10));
          return (
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1.5px solid var(--brd)', borderRadius: 'var(--r)', padding: 8, background: 'var(--card)' }}>
              {view.length === 0 ? (
                <div style={{ color: 'var(--tx3)', fontSize: 12 }}>Henüz kayıt yok</div>
              ) : (
                view.map((r, i) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: i === view.length - 1 ? 'none' : '1px solid var(--brd)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div className="bc" style={{ fontWeight: 900 }}>{r.barcode}</div>
                        {r.inheritedFromShift && (
                          <span style={{ fontSize: 9, color: 'var(--tx3)', background: 'var(--s2)', border: '1px solid var(--brd)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                            devralındı
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 2 }}>
                        {(r.scanned_by || '—')} · {(r.customer || '—')} &nbsp; {r.time || ''}
                        {/* Show custom field preview if available */}
                        {r.customFields && Object.keys(r.customFields).length > 0 && (
                          <span style={{ marginLeft: 8, opacity: 0.7 }}>
                            {Object.entries(r.customFields).slice(0, 2).map(([k, v]) => v && `${k}: ${v}`).filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <button className="btn btn-info btn-sm" style={{ height: 32, padding: "0 8px" }} onClick={() => setEditDupRec(r)}><Ic d={I.edit} s={12} /></button>
                  </div>
                ))
              )}
            </div>
          );
        })()}
      </div>

      {editDupRec && <EditRecordModal record={editDupRec} fields={fields} customers={customers} canManageCustomers={true} onSave={(r)=>{ onEdit(r); setEditDupRec(null); }} onClose={()=>setEditDupRec(null)} />}

      {inheritModal && <ShiftInheritModal currentShift={currentShift} records={records} onCopy={copyFromShift} onClose={() => setInheritModal(false)} />}

      {showTakeoverPrompt && !isAdmin && (
        <ShiftTakeoverPrompt
          shift={currentShift}
          onTakeover={handleTakeoverAccept}
          onCancel={handleTakeoverCancel}
        />
      )}
    </div>
  );
}
