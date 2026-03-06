import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Ic, I } from "./Icon";
import { genId } from "../constants";
import { fmtDate, fmtTime, nowTs, playBeep } from "../utils";
import { supabaseInsert, sheetsInsert } from "../services/integrations";
import EditRecordModal from "./EditRecordModal";
import CustomerModal from "./CustomerModal";
import ShiftInheritModal from "./ShiftInheritModal";

export default function ScanPage({ fields, onSave, onEdit, records, lastSaved, customers, isAdmin, user, integration, scanSettings, toast, currentShift, setCurrentShift, shiftList }) {
  const customerList = Array.isArray(customers) ? customers : (customers?.list || []);
  const today = fmtDate();
  const inputRef  = useRef(null);
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const detRef    = useRef(null);
  const rafRef    = useRef(null);
  const focusTimer = useRef(null);

  const [barcode, setBarcode]     = useState("");
  const [extras, setExtras]       = useState({});
  const [flash, setFlash]         = useState("ready");
  const [custModal, setCustModal] = useState(false);
  const [customer, setCustomer]   = useState(customerList[0] || "");
  const [camActive, setCamActive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [scanPulse, setScanPulse] = useState(false);
  const trackRef = useRef(null);
  const [pendingBc, setPendingBc] = useState(null);

  const [bulkMode, setBulkMode]   = useState(false);
  const [bulkList, setBulkList]   = useState([]);
  const [editDupRec, setEditDupRec] = useState(null);
  const [inheritModal, setInheritModal] = useState(false);
  const recentRef = useRef(new Map());

  const { autoSave, addDetailAfterScan, vibration, beep, recentLimit = 10 } = scanSettings;

  useEffect(() => {
    if (customerList.length && !customer) setCustomer(customerList[0]);
  }, [customerList]);

  useEffect(() => {
    if (typeof BarcodeDetector !== "undefined") {
      BarcodeDetector.getSupportedFormats().then(fmts => {
        detRef.current = new BarcodeDetector({ formats: fmts });
      }).catch(() => {
        detRef.current = new BarcodeDetector();
      });
    }
    return () => { stopCamera(); clearTimeout(focusTimer.current); };
  }, []);

  const scheduleFocus = useCallback(() => {
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      if (!camActive && inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus({ preventScroll: true });
      }
    }, 120);
  }, [camActive]);

  useEffect(() => { scheduleFocus(); }, [scheduleFocus]);

  /* ── Camera ── */
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { toast("Bu tarayıcı kamera erişimini desteklemiyor.", "var(--err)"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      trackRef.current = stream.getVideoTracks ? (stream.getVideoTracks()[0] || null) : null;
      setTorchOn(false);
      setCamActive(true);
      if (detRef.current) requestAnimationFrame(detectFrame);
      else toast("Bu tarayıcı otomatik barkod tespitini desteklemiyor. Manuel giriş yapın.", "var(--acc)");
    } catch (e) {
      toast("Kamera izni alınamadı: " + e.message, "var(--err)");
    }
  };

  const toggleTorch = async () => {
    try {
      const track = trackRef.current;
      if (!track) return toast('Flash desteklenmiyor', 'var(--mut)');
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (!caps.torch) return toast('Flash desteklenmiyor', 'var(--mut)');
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (e) {
      toast('Flash açılamadı: ' + (e?.message || e), 'var(--err)');
    }
  };

  // ZXing fallback
  useEffect(() => {
    if (!camActive) return;
    if (detRef.current) return;
    const reader = new BrowserMultiFormatReader();
    let active = true;
    (async () => {
      try {
        if (!videoRef.current) return;
        await reader.decodeFromVideoDevice(undefined, videoRef.current, (res, err) => {
          if (!active) return;
          if (res) onBarcode(res.getText());
        });
      } catch (e) {
        // ignore
      }
    })();
    return () => { active = false; try { reader.reset(); } catch {} };
  }, [camActive]);

  const detectFrame = async () => {
    if (!videoRef.current || !detRef.current || !streamRef.current) return;
    try {
      const barcodes = await detRef.current.detect(videoRef.current);
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue;
        setScanPulse(true);
        setTimeout(() => setScanPulse(false), 220);
        if (!bulkMode) stopCamera();
        if (addDetailAfterScan) { setPendingBc(code); setBarcode(code); }
        else onBarcode(code);
        return;
      }
    } catch {}
    rafRef.current = requestAnimationFrame(detectFrame);
  };

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setTorchOn(false);
    trackRef.current = null;
    setCamActive(false);
    scheduleFocus();
  };

  /* ── Helpers ── */
  const normalizeCode = (c) => String(c ?? "").trim();
  const findExistingRec = (bc) => (records || []).find(r => {
    const rBc = String(r.barcode ?? "").trim();
    const rShift = String(r.shift ?? "");
    const rDate = fmtDate(r.timestamp || r.date || "");
    return rBc === bc && rShift === String(currentShift ?? "") && rDate === today;
  });
  const canAcceptCode = (bc) => {
    if (!bc) return { ok:false, msg:null };
    const now = Date.now();
    const last = recentRef.current.get(bc);
    if (last && (now - last) < (scanSettings.scanDebounceMs || 800)) return { ok:false, msg:"⚠ Çift okuma engellendi" };
    recentRef.current.set(bc, now);
    if (findExistingRec(bc)) return { ok:false, msg:"⚠ Bu barkod bu vardiyada zaten var", dup:true };
    if (bulkMode && bulkList.some(x => x.code === bc)) return { ok:false, msg:"⚠ Bu kod zaten listede" };
    return { ok:true, msg:null };
  };

  const onBarcode = (code) => {
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

  /* ── Save ── */
  const doSaveCode = useCallback((code, extrasOverride) => {
    const bc = (code || "").trim();
    if (!bc) { scheduleFocus(); return; }
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
    const row = {
      id: genId(), timestamp: now.toISOString(), date: fmtDate(now), time: fmtTime(now),
      barcode: bc, customer: customer || "",
      shift: currentShift || "", inheritedFromShift: "",
      scanned_by: user.name, scanned_by_username: user.username, synced: false,
    };
    extraFields.forEach(f => {
      const v = (extrasOverride ?? extras)[f.id];
      row[f.id] = (f.type === "Tarih" && !v) ? now.toISOString().slice(0, 10) : (v ?? "");
    });

    onSave(row);
    setBarcode(""); setExtras({}); setPendingBc(null);
    setFlash("saved");
    setTimeout(() => { setFlash("ready"); scheduleFocus(); }, 700);
    if (vibration && navigator.vibrate) navigator.vibrate([25, 15, 25]);
    if (beep) playBeep();

    if (integration.active) {
      const ef = fields.filter(f => f.id !== "barcode");
      const headers = ["Barkod", ...ef.map(f => f.label), "Müşteri", "Kaydeden", "Kullanıcı Adı", "Tarih", "Saat"];
      const rowArr  = [bc, ...ef.map(f => row[f.id] ?? ""), row.customer, row.scanned_by, row.scanned_by_username, now.toLocaleDateString("tr-TR"), now.toLocaleTimeString("tr-TR")];
      if (integration.type === "supabase") supabaseInsert(integration.supabase, { ...row, id: undefined }).catch(e => toast("Supabase hatası: " + e.message, "var(--err)"));
      else sheetsInsert(integration.gsheets, headers, rowArr).catch(e => toast("Sheets hatası: " + e.message, "var(--err)"));
    }
  }, [customer, extras, fields, user, onSave, scheduleFocus, vibration, beep, integration, toast, currentShift, records]);

  const doSave = useCallback(() => {
    if (pendingBc) doSaveCode(pendingBc, extras);
    else doSaveCode(barcode, extras);
  }, [pendingBc, barcode, extras, doSaveCode]);

  const copyFromShift = useCallback((sourceShift, selectedIds) => {
    const todayStr = fmtDate();
    const selectedSet = new Set(selectedIds);
    const currentBarcodes = new Set(
      (records || []).filter(r => r.shift === currentShift && r.date === todayStr).map(r => r.barcode)
    );
    const toCopy = (records || []).filter(r =>
      r.shift === sourceShift &&
      r.date === todayStr &&
      selectedSet.has(r.id) &&
      !currentBarcodes.has(r.barcode)
    );
    const now = new Date();
    toCopy.forEach(r => {
      onSave({
        ...r,
        id: genId(),
        timestamp: now.toISOString(),
        date: fmtDate(now),
        time: fmtTime(now),
        shift: currentShift,
        inheritedFromShift: sourceShift,
        synced: false,
      });
    });
    setInheritModal(false);
    if (toCopy.length > 0) {
      toast(`✓ ${toCopy.length} kayıt ${sourceShift} vardiyasından kopyalandı`, "var(--ok)");
    } else {
      toast("Kopyalanacak kayıt bulunamadı", "var(--acc)");
    }
  }, [records, currentShift, onSave, toast]);

  const handleKey = e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const bc = barcode.trim();
    if (addDetailAfterScan && bc && !pendingBc) { setPendingBc(bc); return; }
    if (pendingBc) { doSave(); return; }
    if (autoSave) onBarcode(bc);
  };

  const extraFields = fields.filter(f => f.id !== "barcode");

  // BUG FIX: derive torchSupported from track capabilities
  const torchSupported = !!trackRef.current?.getCapabilities?.()?.torch;

  return (
    <div className="page">
      {/* Müşteri */}
      <div className="cust-bar">
        <Ic d={I.group} s={15} />
        <span style={{ fontSize: 12, color: "var(--tx2)", fontWeight: 600, flexShrink: 0 }}>Müşteri:</span>
        <button type="button" className="cust-btn" onClick={() => setCustModal(true)}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--inf)", flexShrink: 0 }} />
          <span className="cust-name">{customer || "Seçilmedi"}</span>
          <Ic d={I.chevD} s={13} />
        </button>
      </div>

      {/* Status */}
      <div className={`status-bar ${flash === "saved" ? "s-saved" : camActive ? "s-cam" : "s-ready"}`}>
        {flash === "saved" ? <><Ic d={I.check} s={16} /> Kaydedildi!</>
         : camActive       ? <><div className="pulse" style={{ background: "var(--inf)", color: "var(--inf)" }} /> Kamera aktif</>
         : <><div className="pulse" style={{ color: "var(--ok)" }} /> {autoSave ? "Hazır — okutun" : "Okutun, ardından Kaydet'e basın"}</>}
      </div>

      {/* Camera */}
      {camActive && (
        <div className="cam-box cam-full">
          <video ref={videoRef} autoPlay playsInline muted className="cam-video" />

          <div className="cam-topbar">
            <div className="cam-top-left">
              <div className="cam-pill">{customer || "(Boş)"}</div>
              {bulkMode ? <div className="cam-pill cam-pill-info">Toplu Mod</div> : <div className="cam-pill">Tekli</div>}
            </div>
            <div className="cam-top-right">
              {torchSupported && (
                <button
                  type="button"
                  className="cam-ic"
                  onClick={() => toggleTorch()}
                  title="Flaş"
                >⚡</button>
              )}
              <button type="button" className="cam-ic" onClick={stopCamera} title="Kapat">✕</button>
            </div>
          </div>

          <div className="cam-overlay">
            <div
              className={`cam-frame ${scanSettings.scanBoxShape === "rect" ? "rect" : "square"}`}
              style={{
                width: `${Math.round((scanSettings.scanBoxSize || 0.72) * 100)}%`,
                aspectRatio: scanSettings.scanBoxShape === "rect" ? "16 / 9" : "1 / 1",
              }}
            >
              <div className="cam-line" />
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {!camActive
          ? <button type="button" className="btn btn-ghost btn-full btn-sm" onClick={startCamera}><Ic d={I.camera} s={16} /> Kamerayı Aç</button>
          : <button type="button" className="btn btn-danger btn-full btn-sm" onClick={stopCamera}><Ic d={I.camOff} s={16} /> Kapat</button>}
      </div>

      {/* Detail form */}
      {pendingBc && addDetailAfterScan ? (
        <div className="detail-form">
          <div><label className="lbl">Taranan Barkod</label><div className="detail-bc">{pendingBc}</div></div>
          {extraFields.map(f => (
            <div key={f.id}>
              <label className="lbl">{f.label}{f.required ? " *" : ""}</label>
              {f.type === "Onay Kutusu"
                ? <label className="chk-row" style={{ height: 48, border: "1.5px solid var(--brd)", borderRadius: "var(--r)", padding: "0 14px", background: "var(--s2)" }}>
                    <input type="checkbox" checked={!!extras[f.id]} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.checked }))} /><span>{f.label}</span>
                  </label>
                : f.type === "Tarih" ? <input type="date" value={extras[f.id] || ""} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.value }))} />
                : f.type === "Sayı"  ? <input type="number" inputMode="numeric" placeholder="0" value={extras[f.id] || ""} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.value }))} />
                : <input type="text" placeholder={f.label + "..."} value={extras[f.id] || ""} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.value }))} autoFocus />}
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
              placeholder="Barkod okutun veya girin..."
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

          {/* Extra fields (visible only if no addDetailAfterScan) */}
          {!addDetailAfterScan && extraFields.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
              {extraFields.map(f => (
                <div key={f.id}>
                  <label className="lbl">{f.label}{f.required ? " *" : ""}</label>
                  {f.type === "Onay Kutusu"
                    ? <label className="chk-row" style={{ height: 48, border: "1.5px solid var(--brd)", borderRadius: "var(--r)", padding: "0 14px", background: "var(--s2)" }}>
                        <input type="checkbox" checked={!!extras[f.id]} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.checked }))} /><span>{f.label}</span>
                      </label>
                    : f.type === "Tarih" ? <input type="date" value={extras[f.id] || ""} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.value }))} />
                    : f.type === "Sayı"  ? <input type="number" inputMode="numeric" placeholder="0" value={extras[f.id] || ""} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.value }))} />
                    : <input type="text" placeholder={f.label + "..."} value={extras[f.id] || ""} onChange={e => setExtras(p => ({ ...p, [f.id]: e.target.value }))} />}
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
        <span>İmza: <b>{user.name}</b> ({user.username})</span>
        {autoSave && <span style={{ opacity: .7 }}>· otomatik kayıt</span>}
        {integration.active && <span style={{ marginLeft: "auto", opacity: .7, fontSize: 11 }}>→ {integration.type === "supabase" ? "Supabase" : "Sheets"}</span>}
      </div>

      {/* Son Okutmalar */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--tx2)', fontWeight: 800 }}>Son Okutmalar</div>
            {currentShift && <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 2 }}>{currentShift}</div>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ height: 26, fontSize: 11 }}
              onClick={() => setInheritModal(true)}
              title="Önceki vardiyadan kayıt kopyala"
            >
              <Ic d={I.upload} s={13} /> Devral
            </button>
            <select
              value={currentShift}
              onChange={e => setCurrentShift(e.target.value)}
              style={{ height: 26, borderRadius: 10, padding: '0 8px', background: 'var(--s2)', color: 'var(--tx)', border: '1.5px solid var(--brd)', fontSize: 11, fontWeight: 700 }}
            >
              {shiftList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="chip">{fmtDate(nowTs())}</span>
          </div>
        </div>

        {(() => {
          const todayNow = fmtDate(nowTs());
          const all = (records || []).filter(r => r.shift === currentShift && r.date === todayNow).slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
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
                      </div>
                    </div>
                    <button className="btn btn-sm" style={{ height: 28 }} onClick={() => setEditDupRec(r)}><Ic d={I.edit} s={14} /> Düzenle</button>
                  </div>
                ))
              )}
            </div>
          );
        })()}
      </div>

      {editDupRec && <EditRecordModal record={editDupRec} fields={fields} customers={customerList} onSave={(r)=>{ onEdit(r); setEditDupRec(null); }} onClose={()=>setEditDupRec(null)} />}

      {inheritModal && <ShiftInheritModal shiftList={shiftList} currentShift={currentShift} records={records} onCopy={copyFromShift} onClose={() => setInheritModal(false)} />}

      {custModal && <CustomerModal customers={customerList} selected={customer}
        onSelect={v => { setCustomer(v); scheduleFocus(); }} onClose={() => { setCustModal(false); scheduleFocus(); }}
        onAdd={customers.add} onRemove={customers.remove} isAdmin={isAdmin} />}
    </div>
  );
}
