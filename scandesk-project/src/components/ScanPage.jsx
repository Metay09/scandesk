import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import { Ic, I } from "./Icon";
import { genId } from "../constants";
import { fmtDate, fmtTime, nowTs, playBeep, getCurrentShift, FIXED_SHIFTS, getCustomerList } from "../utils";
import { supabaseInsert, sheetsInsert } from "../services/integrations";
import EditRecordModal from "./EditRecordModal";
import CustomerPicker from "./CustomerPicker";
import ShiftInheritModal from "./ShiftInheritModal";
import ShiftTakeoverPrompt from "./ShiftTakeoverPrompt";
import FieldInput from "./FieldInput";

const SCAN_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
  BarcodeFormat.AZTEC,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

export default function ScanPage({ fields, onSave, onEdit, records, lastSaved, customers, isAdmin, user, integration, scanSettings, toast, shiftExpired = false, shiftTakeovers = {}, onShiftTakeover }) {
  const customerList = getCustomerList(customers);
  const normalizeCustomer = (val) => val === "-Boş-" ? "" : val;
  const today = fmtDate();
  const inputRef  = useRef(null);
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const scanLockRef = useRef(false);
  const lockTimerRef = useRef(null);
  const lastScanRef = useRef({ value: null, ts: 0 });
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
  const [camActive, setCamActive] = useState(false);
  const [camStatus, setCamStatus] = useState("idle");
  const [torchOn, setTorchOn] = useState(false);
  const [scanPulse, setScanPulse] = useState(false);
  const trackRef = useRef(null);
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
    const loginDate = fmtDate();
    const key = `${loginDate}_${loginShift}`;
    if (!(shiftTakeovers || {})[key]) {
      setShowTakeoverPrompt(true);
    }
  }, [isAdmin, shiftTakeovers]);

  const handleTakeoverAccept = () => {
    const loginShift = getCurrentShift();
    const loginDate = fmtDate();
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
  const currentShift = isAdmin ? adminShift : getCurrentShift();

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
      if (!camActive && inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus({ preventScroll: true });
      }
    }, 120);
  }, [camActive]);

  useEffect(() => { scheduleFocus(); }, [scheduleFocus]);

  const handleCustomerSelect = (val) => {
    setCustomer(normalizeCustomer(val));
    scheduleFocus();
  };

  /* ── Camera ── */
  const cleanupScanner = useCallback(() => {
    try { readerRef.current?.reset(); } catch (err) { console.warn("ZXing reset error:", err); }
    readerRef.current = null;
    scanLockRef.current = false;
    clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks()?.forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.pause?.(); } catch {}
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    trackRef.current = null;
    setCamActive(false);
    setCamStatus("idle");
    cleanupScanner();
    scheduleFocus();
  }, [cleanupScanner, scheduleFocus]);

  const startDecoding = useCallback(() => {
    if (!videoRef.current) return;

    if (!readerRef.current) {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);
      readerRef.current = new BrowserMultiFormatReader(hints);
    }

    const reader = readerRef.current;
    const cooldown = scanSettings.scanDebounceMs || 800;
    scanLockRef.current = false;

    try {
      reader.decodeFromVideoElementContinuously(videoRef.current, (res, err) => {
        if (err) {
          if (!(err instanceof NotFoundException)) console.warn("ZXing decode error:", err);
          return;
        }
        if (!res) return;

        const code = res.getText?.() || "";
        if (!code) return;

        const now = Date.now();
        const lastTs = lastScanRef.current?.ts || 0;
        if (scanLockRef.current && (now - lastTs) < cooldown) return;
        scanLockRef.current = true;
        lastScanRef.current = { value: code, ts: now };
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = setTimeout(() => { scanLockRef.current = false; }, Math.max(cooldown, 350));

        setScanPulse(true);
        setTimeout(() => setScanPulse(false), 220);

        if (addDetailAfterScanRef.current) {
          setPendingBc(code);
          setBarcode(code);
        } else {
          onBarcodeRef.current?.(code);
        }
      });
    } catch (err) {
      console.error("ZXing start error:", err);
      toast("Kamera başlatılırken hata oluştu: " + (err?.message || err), "var(--err)");
      stopCamera();
    }
  }, [scanSettings, stopCamera, toast]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("Bu tarayıcı kamera erişimini desteklemiyor.", "var(--err)");
      setCamStatus("error: unsupported");
      return;
    }
    if (camActive) return;

    setCamStatus("modal-opened");
    setCamActive(true);

    try {
      setCamStatus("requesting-camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      streamRef.current = stream;
      trackRef.current = stream.getVideoTracks ? (stream.getVideoTracks()[0] || null) : null;
      setTorchOn(false);
      setCamStatus("stream-acquired");
    } catch (e) {
      console.error('Camera error:', e);
      const msg = e?.message || e;
      setCamStatus("error: " + msg);
      toast("Kamera izni alınamadı: " + msg, "var(--err)");
    }
  }, [camActive, toast]);

  useEffect(() => {
    if (!camActive) return;
    let cancelled = false;

    const tryAttach = async () => {
      if (cancelled) return;
      const videoEl = videoRef.current;
      const stream = streamRef.current;
      if (!videoEl || !stream) {
        requestAnimationFrame(tryAttach);
        return;
      }
      try {
        videoEl.srcObject = stream;
        setCamStatus((prev) => prev.startsWith("error") ? prev : "video-attached");
        await videoEl.play();
        if (cancelled) return;
        setCamStatus((prev) => prev.startsWith("error") ? prev : "playing");
        startDecoding();
      } catch (err) {
        if (cancelled) return;
        console.error("Video play error:", err);
        const msg = err?.message || err;
        setCamStatus("error: " + msg);
        toast("Kamera akışı başlatılamadı: " + msg, "var(--err)");
      }
    };

    tryAttach();
    return () => { cancelled = true; };
  }, [camActive, startDecoding, toast]);

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

  useEffect(() => {
    return () => {
      stopCamera();
      clearTimeout(focusTimer.current);
      clearTimeout(lockTimerRef.current);
    };
  }, [stopCamera]);

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
  // Keep ref always pointing at latest onBarcode so ZXing callback avoids stale closure
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
    const row = {
      id: genId(), timestamp: now.toISOString(), date: dateStr, time: fmtTime(now),
      barcode: bc, customer: customer || "",
      shift,
      inheritedFromShift: "",
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
  }, [customer, extras, fields, user, onSave, scheduleFocus, vibration, beep, integration, toast, records, isAdmin, adminShift, shiftExpired]);

  const doSave = useCallback(() => {
    if (pendingBc) doSaveCode(pendingBc, extras);
    else doSaveCode(barcode, extras);
  }, [pendingBc, barcode, extras, doSaveCode]);

  const copyFromShift = useCallback((sourceShift, selectedIds) => {
    const todayStr = fmtDate();
    // Admin: seçilen vardiyaya kopyalar; normal kullanıcı: saate göre otomatik
    const targetShift = isAdmin ? adminShift : getCurrentShift();
    const selectedSet = new Set(selectedIds);
    const currentBarcodes = new Set(
      (records || []).filter(r => r.shift === targetShift && r.date === todayStr).map(r => r.barcode)
    );
    const toCopy = (records || []).filter(r =>
      r.shift === sourceShift &&
      r.date === todayStr &&
      selectedSet.has(r.id) &&
      !currentBarcodes.has(r.barcode)
    );
    const now = new Date();
    const copyDateStr = fmtDate(now);
    toCopy.forEach(r => {
      onSave({
        ...r,
        id: genId(),
        timestamp: now.toISOString(),
        date: copyDateStr,
        time: fmtTime(now),
        shift: targetShift,
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

  // BUG FIX: derive torchSupported from track capabilities
  const torchSupported = !!trackRef.current?.getCapabilities?.()?.torch;

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
        }}>{fmtDate(nowTs())}</span>
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
          canManage={isAdmin}
          onAdd={customers.add}
          onRemove={customers.remove}
        />
      </div>

      {/* Status */}
      <div className={`status-bar ${flash === "saved" ? "s-saved" : camActive ? "s-cam" : "s-ready"}`}>
        {flash === "saved" ? <><Ic d={I.check} s={16} /> Kaydedildi!</>
         : camActive       ? <><div className="pulse" style={{ background: "var(--inf)", color: "var(--inf)" }} /> Kamera aktif</>
         : <><div className="pulse" style={{ color: "var(--ok)" }} /> {autoSave ? "Hazır — okutun" : "Okutun, ardından Kaydet'e basın"}</>}
      </div>

      {/* Camera */}
      {camActive && (
        <div className="overlay cam-overlay-shell">
          <div className="cam-modal">
            <div className="cam-box cam-full">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="cam-video"
                style={{ minHeight: "55vh" }}
              />

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
                      style={{ background: torchOn ? 'rgba(255,220,0,.75)' : 'rgba(0,0,0,.55)' }}
                    >
                      <Ic d={I.zap} s={16} />
                    </button>
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

            <div className="cam-debug">
              <div className="cam-debug-label">Kamera Durumu:</div>
              {["modal-opened", "requesting-camera", "stream-acquired", "video-attached", "playing"].map(step => (
                <span key={step} className={`cam-debug-chip ${camStatus === step ? "active" : ""}`}>
                  {camStatus === step ? "●" : "○"} {step}
                </span>
              ))}
              {camStatus.startsWith("error") && (
                <span className="cam-debug-chip err">{camStatus}</span>
              )}
              {camStatus === "idle" && <span className="cam-debug-chip">idle</span>}
            </div>
          </div>
        </div>
      )}

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
            <button
              type="button"
              onClick={camActive ? stopCamera : startCamera}
              disabled={shiftExpired && !isAdmin}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "none",
                background: camActive ? "var(--err)" : "var(--inf2)",
                color: camActive ? "#fff" : "var(--inf)",
                cursor: shiftExpired && !isAdmin ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: shiftExpired && !isAdmin ? 0.5 : 1
              }}
              title={camActive ? "Kamerayı Kapat" : "Kamerayı Aç"}
            >
              {camActive ? <Ic d={I.x} s={18} /> : <Ic d={I.camera} s={18} />}
            </button>
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
        <span>İmza: <b>{user.name}</b> ({user.username})</span>
        {autoSave && <span style={{ opacity: .7 }}>· otomatik kayıt</span>}
        {integration.active && <span style={{ marginLeft: "auto", opacity: .7, fontSize: 11 }}>→ {integration.type === "supabase" ? "Supabase" : "Sheets"}</span>}
      </div>

      {/* Son Okutmalar */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--tx2)', fontWeight: 800, marginBottom: 6 }}>Son Okutmalar</div>

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
                    <button className="btn btn-info btn-sm" style={{ height: 32, padding: "0 8px" }} onClick={() => setEditDupRec(r)}><Ic d={I.edit} s={12} /></button>
                  </div>
                ))
              )}
            </div>
          );
        })()}
      </div>

      {editDupRec && <EditRecordModal record={editDupRec} fields={fields} customers={customers} canManageCustomers={isAdmin} onSave={(r)=>{ onEdit(r); setEditDupRec(null); }} onClose={()=>setEditDupRec(null)} />}

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
