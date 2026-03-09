import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import { Ic, I } from "./Icon";
import { playBeep } from "../utils";

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

export default function CameraScannerScreen({
  isOpen,
  onClose,
  onBarcodeScanned,
  scanSettings = {},
  customer = "",
  bulkMode = false,
  closeOnScan = false,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const trackRef = useRef(null);
  const scanLockRef = useRef(false);
  const lockTimerRef = useRef(null);
  const lastScanRef = useRef({ value: null, ts: 0 });

  const [torchOn, setTorchOn] = useState(false);
  const [scanPulse, setScanPulse] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [camStatus, setCamStatus] = useState("idle");
  const [scannedBarcodes, setScannedBarcodes] = useState([]);

  const { vibration = true, beep = true, scanDebounceMs = 800 } = scanSettings;

  const cleanupScanner = useCallback(() => {
    try {
      readerRef.current?.reset();
    } catch (err) {
      console.warn("ZXing reset error:", err);
    }
    readerRef.current = null;
    scanLockRef.current = false;
    clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks()?.forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      try {
        videoRef.current.pause?.();
      } catch {}
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    trackRef.current = null;
    setCamStatus("idle");
    setCameraLoading(false);
    cleanupScanner();
  }, [cleanupScanner]);

  const handleBarcodeDetected = useCallback(
    (code) => {
      const now = Date.now();
      const lastTs = lastScanRef.current?.ts || 0;
      const cooldown = scanDebounceMs || 800;

      if (scanLockRef.current && now - lastTs < cooldown) return;

      scanLockRef.current = true;
      lastScanRef.current = { value: code, ts: now };
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        scanLockRef.current = false;
      }, Math.max(cooldown, 350));

      // Visual feedback: green frame flash
      setScanPulse(true);
      setTimeout(() => setScanPulse(false), 220);

      // Haptic feedback
      if (vibration && navigator.vibrate) {
        navigator.vibrate([25, 15, 25]);
      }

      // Audio feedback
      if (beep) {
        playBeep();
      }

      // Add to scanned list
      setScannedBarcodes((prev) => {
        // Check if already in list
        const exists = prev.some((item) => item.code === code);
        if (exists) {
          // Update timestamp and move to top
          return [
            { code, ts: new Date().toISOString(), count: prev.find(item => item.code === code).count + 1 },
            ...prev.filter((item) => item.code !== code),
          ];
        }
        return [{ code, ts: new Date().toISOString(), count: 1 }, ...prev];
      });

      // Send to parent
      if (onBarcodeScanned) {
        onBarcodeScanned(code);
      }

      // Auto-close camera in single scan mode
      if (closeOnScan && onClose) {
        // Delay close slightly to allow feedback animations to complete
        setTimeout(() => {
          onClose();
        }, 300);
      }
    },
    [scanDebounceMs, vibration, beep, onBarcodeScanned, closeOnScan, onClose]
  );

  const startDecoding = useCallback(async () => {
    if (!videoRef.current) return;

    if (!readerRef.current) {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);
      readerRef.current = new BrowserMultiFormatReader(hints);
    }

    const reader = readerRef.current;
    scanLockRef.current = false;

    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          focusMode: { ideal: "continuous" },
          advanced: [{ focusMode: "continuous" }],
        },
      };

      await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (res, err) => {
          if (err) {
            if (!(err instanceof NotFoundException))
              console.warn("ZXing decode error:", err);
            return;
          }
          if (!res) return;

          const code = res.getText?.() || "";
          if (!code) return;

          handleBarcodeDetected(code);
        }
      );
    } catch (err) {
      console.error("ZXing start error:", err);
      stopCamera();
    }
  }, [handleBarcodeDetected, stopCamera]);

  const toggleTorch = async () => {
    try {
      const track = trackRef.current;
      if (!track) return;
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (!caps.torch) return;
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (e) {
      console.error("Flash toggle error:", e);
    }
  };

  const handleClose = () => {
    stopCamera();
    setScannedBarcodes([]);
    if (onClose) onClose();
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setScannedBarcodes([]);
      return;
    }

    let cancelled = false;
    setCameraLoading(true);
    setCamStatus("requesting-camera");

    const initCamera = async () => {
      if (cancelled) return;
      const videoEl = videoRef.current;
      if (!videoEl) {
        requestAnimationFrame(initCamera);
        return;
      }

      try {
        await startDecoding();

        if (cancelled) return;

        const stream = videoEl.srcObject;
        if (stream) {
          streamRef.current = stream;
          trackRef.current = stream.getVideoTracks
            ? stream.getVideoTracks()[0] || null
            : null;
          setTorchOn(false);
          setCamStatus("playing");
          setCameraLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Camera initialization error:", err);
        setCamStatus("error: " + (err?.message || err));
        setCameraLoading(false);
      }
    };

    initCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, startDecoding, stopCamera]);

  if (!isOpen) return null;

  const torchSupported = !!trackRef.current?.getCapabilities?.()?.torch;

  return (
    <div className="camera-scanner-fullscreen">
      <div className="camera-scanner-container">
        {/* Video */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-scanner-video"
        />

        {/* Top bar */}
        <div className="camera-scanner-topbar">
          <div className="camera-scanner-top-left">
            <div className="camera-scanner-pill">{customer || "(Boş)"}</div>
            {bulkMode && (
              <div className="camera-scanner-pill camera-scanner-pill-info">
                Toplu Mod
              </div>
            )}
          </div>
          <div className="camera-scanner-top-right">
            {torchSupported && (
              <button
                type="button"
                className="camera-scanner-btn"
                onClick={toggleTorch}
                title="Flaş"
                style={{
                  background: torchOn
                    ? "rgba(255,220,0,.85)"
                    : "rgba(0,0,0,.65)",
                }}
              >
                <Ic d={I.zap} s={20} />
              </button>
            )}
            <button
              type="button"
              className="camera-scanner-btn camera-scanner-close"
              onClick={handleClose}
              title="Kapat"
            >
              <Ic d={I.x} s={24} />
            </button>
          </div>
        </div>

        {/* Camera overlay with corner guides */}
        <div className="camera-scanner-overlay">
          {cameraLoading && (
            <div className="camera-scanner-loading">
              <div
                className="pulse"
                style={{ background: "var(--inf)", color: "var(--inf)" }}
              />
              <span>Kamera açılıyor...</span>
            </div>
          )}
          <div
            className={`camera-scanner-frame ${
              scanPulse ? "camera-scanner-frame-success" : ""
            } ${scanSettings.scanBoxShape === "rect" ? "rect" : "square"}`}
            style={{
              width: `${Math.round((scanSettings.scanBoxSize || 0.72) * 100)}%`,
              aspectRatio:
                scanSettings.scanBoxShape === "rect" ? "16 / 9" : "1 / 1",
            }}
          >
            {/* Corner guides */}
            <div className="camera-scanner-corner camera-scanner-corner-tl" />
            <div className="camera-scanner-corner camera-scanner-corner-tr" />
            <div className="camera-scanner-corner camera-scanner-corner-bl" />
            <div className="camera-scanner-corner camera-scanner-corner-br" />
          </div>
        </div>

        {/* Scanned barcodes list */}
        {scannedBarcodes.length > 0 && (
          <div className="camera-scanner-list">
            <div className="camera-scanner-list-header">
              <Ic d={I.barcode} s={16} />
              <span>Okunan Barkodlar ({scannedBarcodes.length})</span>
            </div>
            <div className="camera-scanner-list-items">
              {scannedBarcodes.map((item, index) => (
                <div key={index} className="camera-scanner-list-item">
                  <div className="camera-scanner-list-item-code">
                    {item.code}
                  </div>
                  {item.count > 1 && (
                    <div className="camera-scanner-list-item-count">
                      {item.count}x
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
