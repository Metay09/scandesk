import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { App as CapApp } from "@capacitor/app";
import * as XLSX from "xlsx";

import "./index.css";
import { INITIAL_USERS, INITIAL_SETTINGS, INITIAL_FIELDS, DEFAULT_CUSTS } from "./constants";
import { isNative, loadState, saveState } from "./services/storage";
import { getCurrentShift, pad2, deriveShiftDate, getShiftDate, getShiftEndTime } from "./utils";
import { normalizeRecord, migrateRecords, flattenRecordForExport } from "./services/recordModel";
import { useToast } from "./hooks/useToast";
import { Ic, I } from "./components/Icon";
import Login from "./components/Login";
import ScanPage from "./components/ScanPage";
import DataPage from "./components/DataPage";
import ReportPage from "./components/ReportPage";
import FieldsPage from "./components/FieldsPage";
import UsersPage from "./components/UsersPage";
import SettingsPage from "./components/SettingsPage";

export default function App() {
  const [users, setUsers]         = useState(INITIAL_USERS);
  const [user, setUser]           = useState(null);
  const [page, setPage]           = useState("scan");
  const [fields, setFields]       = useState(INITIAL_FIELDS);
  const [records, setRecords]     = useState([]);
  const [lastSaved, setLastSaved] = useState(null);
  const [custList, setCustList]   = useState(DEFAULT_CUSTS);
  const [settings, setSettings]   = useState(INITIAL_SETTINGS);
  const [integration, setIntegration] = useState({
    active: false, type: "supabase",
    supabase: { url: "", key: "", table: "taramalar" },
    gsheets:  { scriptUrl: "" },
  });
  const [hydrated, setHydrated] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("scandesk_theme") || "dark");
  const [userLoginShift, setUserLoginShift] = useState(null);
  const [graceSecsLeft, setGraceSecsLeft] = useState(null);
  const [graceEndTime, setGraceEndTime] = useState(null); // Absolute timestamp when grace period ends
  const inGraceRef = useRef(false);
  const [shiftTakeovers, setShiftTakeovers] = useState({});
  const [logoutReason, setLogoutReason] = useState(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const backPressCountRef = useRef(0);
  const backPressTimerRef = useRef(null);

  const addShiftDate = useCallback((rec) => {
    if (!rec) return rec;
    const shiftDate = deriveShiftDate(rec);
    return shiftDate ? { ...rec, shiftDate } : { ...rec };
  }, []);

  const normalizeRecordsWithModel = useCallback((list) => {
    if (!Array.isArray(list)) return [];
    // Migrate records to new model (fixed fields + customFields) and add shiftDate
    return migrateRecords(list, fields).map(addShiftDate);
  }, [addShiftDate, fields]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("scandesk_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  // Back button handler (3-level navigation)
  useEffect(() => {
    let listener;

    const handleBackButton = () => {
      // Clear any existing timer
      if (backPressTimerRef.current) {
        clearTimeout(backPressTimerRef.current);
      }

      backPressCountRef.current += 1;
      const pressCount = backPressCountRef.current;

      // Reset counter after 2 seconds of inactivity
      backPressTimerRef.current = setTimeout(() => {
        backPressCountRef.current = 0;
        setShowExitConfirm(false);
      }, 2000);

      // 1st press: Navigate to scan page if not already there
      if (pressCount === 1) {
        if (page !== "scan") {
          setPage("scan");
          backPressCountRef.current = 0; // Reset after navigation
        }
        return;
      }

      // 2nd press: Show exit confirmation (only on scan page)
      if (pressCount === 2 && page === "scan") {
        setShowExitConfirm(true);
        return;
      }

      // 3rd press: Exit app (only if on scan page and confirmation shown)
      if (pressCount === 3 && page === "scan" && showExitConfirm) {
        CapApp.exitApp();
        return;
      }
    };

    // Register back button listener for native apps
    CapApp.addListener('backButton', handleBackButton).then(result => {
      listener = result;
    }).catch(() => {
      // Back button not available (web browser)
      console.log('Back button listener not available - running in browser');
    });

    return () => {
      if (listener) {
        listener.remove();
      }
      if (backPressTimerRef.current) {
        clearTimeout(backPressTimerRef.current);
      }
    };
  }, [page, showExitConfirm]);

  // Load persisted state on start
  useEffect(() => {
    (async () => {
      const st = await loadState();
      if (st && typeof st === "object") {
        if (Array.isArray(st.users) && st.users.length) setUsers(st.users);
        if (Array.isArray(st.fields) && st.fields.length) setFields(st.fields);
        // Migrate and normalize records to new structure on load
        if (Array.isArray(st.records)) setRecords(normalizeRecordsWithModel(st.records));
        if (st.lastSaved) {
          const normalized = normalizeRecord(st.lastSaved, st.fields || fields);
          setLastSaved(addShiftDate(normalized));
        }
        if (Array.isArray(st.custList) && st.custList.length) setCustList(st.custList);
        if (st.settings) {
          setSettings(st.settings);
        }
        if (st.integration) setIntegration(st.integration);
        if (st.shiftTakeovers && typeof st.shiftTakeovers === "object") setShiftTakeovers(st.shiftTakeovers);
      }
      // ensure admin exists
      setUsers(p => {
        const hasAdmin = p.some(u => u.username === "admin");
        return hasAdmin ? p : [INITIAL_USERS[0], ...p];
      });
      setHydrated(true);
    })();
  }, [addShiftDate, normalizeRecordsWithModel, fields]);

  // Persist on changes
  useEffect(() => {
    if (!hydrated) return;
    saveState({ users, fields, records, lastSaved, custList, settings, integration, shiftTakeovers });
  }, [hydrated, users, fields, records, lastSaved, custList, settings, integration, shiftTakeovers]);

  const { toasts, add: toast } = useToast();

  const isAdmin = user?.role === "admin";

  const visibleRecordsCount = useMemo(() => {
    if (isAdmin) return records.length;
    const currentShift = userLoginShift || getCurrentShift();
    const currentShiftDate = getShiftDate(undefined, currentShift);
    return records.filter(r => r.shift === currentShift && deriveShiftDate(r) === currentShiftDate).length;
  }, [isAdmin, records, userLoginShift]);

  const handleLogout = useCallback((reason = null) => {
    inGraceRef.current = false;
    setUser(null);
    setPage("scan");
    setUserLoginShift(null);
    setGraceSecsLeft(null);
    setLogoutReason(reason);
  }, []);

  const handleLogin = useCallback((u) => {
    inGraceRef.current = false;
    setUser(u);
    setPage("scan");
    setGraceSecsLeft(null);
    setLogoutReason(null);
    if (u.role !== "admin") {
      setUserLoginShift(getCurrentShift());
    } else {
      setUserLoginShift(null);
    }
  }, []);

  const GRACE_PERIOD_SECS = 300; // 5 dakika

  // Vardiya bitimi algılama — sadece normal kullanıcılar için
  useEffect(() => {
    if (!user || isAdmin || !userLoginShift) return;
    const id = setInterval(() => {
      if (inGraceRef.current) return; // grace zaten başladı, gereksiz kontrol yapma
      const current = getCurrentShift();
      if (current !== userLoginShift) {
        inGraceRef.current = true;
        // Calculate absolute end time based on shift end + grace period
        const shiftEnd = getShiftEndTime(userLoginShift);
        if (shiftEnd) {
          const endTime = shiftEnd + (GRACE_PERIOD_SECS * 1000); // Add 5 minutes grace period
          setGraceEndTime(endTime);
          // Calculate initial seconds left
          const secsLeft = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
          setGraceSecsLeft(secsLeft);
        } else {
          // Fallback to old behavior if shift end can't be calculated
          setGraceSecsLeft(GRACE_PERIOD_SECS);
        }
        setPage(prev => prev === "scan" ? "data" : prev);
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [user, isAdmin, userLoginShift]);

  // Update grace seconds left based on absolute end time
  useEffect(() => {
    if (graceEndTime === null || !user) return;

    const updateRemainingTime = () => {
      const now = Date.now();
      const secsLeft = Math.max(0, Math.floor((graceEndTime - now) / 1000));

      if (secsLeft === 0) {
        handleLogout("shift_expired");
      } else {
        setGraceSecsLeft(secsLeft);
      }
    };

    // Update immediately
    updateRemainingTime();

    // Then update every second
    const id = setInterval(updateRemainingTime, 1000);
    return () => clearInterval(id);
  }, [graceEndTime, user, handleLogout]);

  const handleSave   = useCallback(r => {
    // Normalize the record to ensure it follows the new structure
    const normalized = normalizeRecord(r, fields);
    const rec = addShiftDate(normalized);
    setRecords(p => [rec, ...p]);
    setLastSaved(rec);
  }, [addShiftDate, fields]);
  const handleSyncUpdate = useCallback(id => {
    setRecords(p => p.map(r => r.id === id ? { ...r, synced: true } : r));
  }, []);
  const handleDelete = id => { setRecords(p => p.filter(r => r.id !== id)); setLastSaved(p => (p && p.id === id ? null : p)); toast("Kayıt silindi", "var(--err)"); };
  const handleEdit   = r  => {
    // Normalize the edited record
    const normalized = normalizeRecord(r, fields);
    const rec = addShiftDate(normalized);
    // Update the updatedAt timestamp
    rec.updatedAt = new Date().toISOString();
    setRecords(p => p.map(x => x.id === rec.id ? rec : x));
    toast("Güncellendi", "var(--inf)");
  };
  const handleClear  = () => {
    if (window.confirm("Tüm kayıtlar silinecek. Onaylıyor musunuz?")) {
      setRecords([]); setLastSaved(null); toast("Tüm veriler temizlendi", "var(--err)");
    }
  };

  const handleDeleteRange = (startLocal, endLocal) => {
    const a = new Date(startLocal).toISOString();
    const b = new Date(endLocal).toISOString();
    setRecords(p => p.filter(r => !(r.timestamp >= a && r.timestamp <= b)));
    setLastSaved(p => (p && (p.timestamp >= a && p.timestamp <= b) ? null : p));
  };

  const handleExport = async (type, ids) => {
    const recs = Array.isArray(ids) && ids.length ? records.filter(r => ids.includes(r.id)) : records;
    if (!recs.length) { toast("Dışa aktarılacak kayıt yok", "var(--acc)"); return; }
    const ef = fields.filter(f => f.id !== "barcode");

    // Export includes system fields for full data preservation
    const hdr = [
      "ID", "Barkod", ...ef.map(f => f.label), "Müşteri", "Kaydeden", "Kullanıcı Adı",
      "Tarih", "Saat", "Vardiya", "Vardiya Tarihi", "Timestamp",
      "Senkronize", "Senkronizasyon Durumu", "Kaynak", "Oluşturulma", "Güncellenme"
    ];

    // Helper to safely get field value while preserving data types
    const safeValue = (val) => {
      if (val == null) return "";
      // Preserve primitives (string, number, boolean) as-is for Excel
      if (typeof val !== "object") return val;
      // Convert objects/arrays to JSON string as fallback
      return JSON.stringify(val);
    };

    // Helper to get field value from record (supports both customFields and root level)
    const getFieldValue = (record, fieldId) => {
      // Check customFields first
      if (record.customFields && fieldId in record.customFields) {
        return record.customFields[fieldId];
      }
      // Fallback to root level
      return record[fieldId];
    };

    const data = recs.map(r => {
      try {
        const d = new Date(r.timestamp);
        const isValidDate = !Number.isNaN(d.getTime());
        const dateOut = deriveShiftDate(r) || (isValidDate ? d.toLocaleDateString("tr-TR") : "");
        const timeOut = isValidDate ? d.toLocaleTimeString("tr-TR") : "";

        return [
          safeValue(r.id),
          safeValue(r.barcode),
          ...ef.map(f => safeValue(getFieldValue(r, f.id))),
          safeValue(r.customer),
          safeValue(r.scanned_by),
          safeValue(r.scanned_by_username),
          dateOut,
          timeOut,
          safeValue(r.shift),
          safeValue(r.shiftDate),
          safeValue(r.timestamp),
          safeValue(r.synced),
          safeValue(r.syncStatus),
          safeValue(r.source),
          safeValue(r.createdAt),
          safeValue(r.updatedAt)
        ];
      } catch (err) {
        console.error("Error processing record:", r, err);
        // Return a row with error indicator
        return [
          safeValue(r.barcode),
          ...ef.map(() => ""),
          "",
          "",
          "",
          "",
          ""
        ];
      }
    });
    if (type === "xlsx") {
      try {
        const ws = XLSX.utils.aoa_to_sheet([hdr, ...data]);
        ws["!cols"] = hdr.map(() => ({ wch: 20 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Taramalar");
        const filename = `scandesk_${new Date().toISOString().slice(0, 10)}.xlsx`;

        if (isNative()) {
          const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
          await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache });
          await Share.share({ title: "ScanDesk Excel", text: "Excel dosyası hazır", url: (await Filesystem.getUri({ directory: Directory.Cache, path: filename })).uri });
          toast("Excel hazır (Paylaş)", "var(--ok)");
        } else {
          XLSX.writeFile(wb, filename);
          toast("Excel indirildi", "var(--ok)");
        }
      } catch (err) {
        console.error("Excel export error:", err);
        toast("Excel dışa aktarma hatası: " + (err?.message || err), "var(--err)");
      }
    } else {
      try {
        const csv = [hdr, ...data].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
        const filename = `scandesk_${Date.now()}.csv`;
        if (isNative()) {
          await Filesystem.writeFile({ path: filename, data: "\uFEFF" + csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
          await Share.share({ title: "ScanDesk CSV", text: "CSV dosyası hazır", url: (await Filesystem.getUri({ directory: Directory.Cache, path: filename })).uri });
          toast("CSV hazır (Paylaş)", "var(--ok)");
        } else {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
          a.download = filename;
          a.click();
          toast("CSV indirildi", "var(--ok)");
        }
      } catch (err) {
        console.error("CSV export error:", err);
        toast("CSV dışa aktarma hatası: " + (err?.message || err), "var(--err)");
      }
    }
  };

  const handleImport = (imported) => {
    if (!imported.length) { toast("İçe aktarılacak veri yok", "var(--acc)"); return; }
    // Migrate imported records to new structure
    const normalized = normalizeRecordsWithModel(imported);
    setRecords(p => [...normalized, ...p]);
    toast(`✓ ${normalized.length} kayıt içe aktarıldı`, "var(--ok)");
  };

  const customers = {
    list: custList,
    add:    name => { if (!custList.includes(name)) setCustList(p => [...p, name]); },
    remove: name => setCustList(p => p.filter(c => c !== name)),
  };

  const NAV = [
    { id: "scan",     label: "Tara",      icon: I.scan },
    { id: "data",     label: "Veriler",   icon: I.data },
    { id: "report",   label: "Rapor",     icon: I.report },
    { id: "fields",   label: "Alanlar",   icon: I.fields },
    { id: "users",    label: "Kullanıcı", icon: I.users,    adminOnly: true },
    { id: "settings", label: "Ayarlar",   icon: I.settings },
  ].filter(n => !n.adminOnly || isAdmin);

  const handleMigratePassword = (userId, hashed) => {
    setUsers(p => p.map(u => u.id === userId ? { ...u, password: hashed } : u));
  };

  const handleShiftTakeover = useCallback((shift, date) => {
    if (!user) return;
    const key = `${date}_${shift}`;
    setShiftTakeovers(p => ({
      ...p,
      [key]: { user: user.name, userId: user.id, ts: new Date().toISOString() },
    }));
  }, [user]);

  if (!hydrated) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 12, color: "var(--tx2)" }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--brd)", borderTopColor: "var(--acc)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <span style={{ fontSize: 13 }}>Yükleniyor...</span>
    </div>
  );

  if (!user) return <Login users={users} onLogin={handleLogin} onMigratePassword={handleMigratePassword} logoutReason={logoutReason} />;

  return (
    <div className="shell">
      {/* TOPBAR (mobile) */}
      <div className="topbar">
        <div className="logo-icon" style={{ width: 28, height: 28, borderRadius: 7 }}><Ic d={I.barcode} s={14} /></div>
        <span style={{ fontSize: 15, fontWeight: 800 }}>ScanDesk</span>
        <span style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--tx2)" }}>
          {NAV.find(n => n.id === page)?.label}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          style={{ width: 36, height: 36, padding: 0, flexShrink: 0 }}
          onClick={toggleTheme}
          title={theme === "dark" ? "Açık tema" : "Koyu tema"}
        >
          <Ic d={theme === "dark" ? I.sun : I.moon} s={16} />
        </button>
        <div className="user-pill">
          <div className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>{user.name[0]}</div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{user.name}</span>
          {isAdmin && <span className="badge badge-acc">ADM</span>}
        </div>
      </div>

      {/* SIDEBAR (desktop) */}
      <div className="side-nav">
        <div className="side-logo">
          <div className="logo-icon" style={{ width: 30, height: 30, borderRadius: 8 }}><Ic d={I.barcode} s={14} /></div>
          ScanDesk
        </div>
        {NAV.map(n => (
          <button key={n.id} className={`side-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <Ic d={n.icon} s={15} />{n.label}
            {n.id === "data" && visibleRecordsCount > 0 && <span className="nav-badge" style={{ marginLeft: "auto" }}>{visibleRecordsCount}</span>}
            {n.id === "settings" && integration.active && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", marginLeft: "auto" }} />}
          </button>
        ))}
        <div className="side-footer">
          <div className="user-pill" style={{ borderRadius: "var(--r)", gap: 8 }}>
            <div className="avatar" style={{ width: 30, height: 30 }}>{user.name[0]}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{user.name}</div>
              <div style={{ fontSize: 10, color: "var(--tx2)" }}>@{user.username} · {isAdmin ? "Admin" : "Kullanıcı"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="scroll-area">
        {page === "scan"     && <ScanPage fields={fields} onSave={handleSave} onEdit={handleEdit} onSyncUpdate={handleSyncUpdate} records={records} lastSaved={lastSaved} customers={customers} isAdmin={isAdmin} user={user} integration={integration} scanSettings={settings} toast={toast} shiftExpired={graceSecsLeft !== null && !isAdmin} shiftTakeovers={shiftTakeovers} onShiftTakeover={handleShiftTakeover} />}
        {page === "data"     && <DataPage     fields={fields} records={records} onDelete={handleDelete} onEdit={handleEdit} onExport={handleExport} onImport={handleImport} customers={customers} settings={settings} toast={toast} isAdmin={isAdmin} currentShift={userLoginShift || getCurrentShift()} user={user} />}
        {page === "report"   && <ReportPage   records={records} fields={fields} isAdmin={isAdmin} currentShift={userLoginShift || getCurrentShift()} />}
        {page === "fields"   && <FieldsPage   fields={fields} setFields={setFields} isAdmin={isAdmin} settings={settings} />}
        {page === "users"    && isAdmin && <UsersPage users={users} setUsers={setUsers} currentUser={user} toast={toast} />}
        {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} integration={integration} setIntegration={setIntegration} isAdmin={isAdmin} onClearData={handleClear} onDeleteRange={handleDeleteRange} records={records} toast={toast} user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />}
      </div>

      {/* BOTTOM NAV (mobile) */}
      <nav className="bot-nav">
        {NAV.map(n => (
          <button key={n.id} className={`nav-btn ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <Ic d={n.icon} s={21} />{n.label}
            {n.id === "data" && visibleRecordsCount > 0 && <span className="nav-badge">{visibleRecordsCount}</span>}
          </button>
        ))}
      </nav>

      {/* GRACE PERIOD BANNER */}
      {graceSecsLeft !== null && !isAdmin && (
        <div style={{
          position: "fixed", bottom: 56, left: 0, right: 0, zIndex: 9000,
          background: "var(--err)", color: "#fff",
          padding: "10px 16px", display: "flex", alignItems: "center",
          gap: 10, fontSize: 13, fontWeight: 700,
          boxShadow: "0 -2px 12px rgba(0,0,0,.4)"
        }}>
          <Ic d={I.lock} s={16} />
          <span style={{ flex: 1 }}>
            Vardiya süresi doldu — çıkışa {Math.floor(graceSecsLeft / 60)}:{pad2(graceSecsLeft % 60)} kaldı
          </span>
          <button
            className="btn btn-sm"
            style={{ background: "rgba(255,255,255,.2)", color: "#fff", border: "1px solid rgba(255,255,255,.4)" }}
            onClick={handleLogout}
          >
            <Ic d={I.logout} s={14} /> Çıkış Yap
          </button>
        </div>
      )}

      {/* EXIT CONFIRMATION MODAL */}
      {showExitConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20
        }}>
          <div style={{
            background: "var(--card)", borderRadius: "var(--r)",
            border: "1.5px solid var(--brd)", padding: 20,
            maxWidth: 360, width: "100%",
            boxShadow: "0 8px 32px rgba(0,0,0,.4)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Ic d={I.warning} s={20} />
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Uygulamadan Çık</h3>
            </div>
            <p style={{ fontSize: 14, color: "var(--tx2)", marginBottom: 20 }}>
              Uygulamayı kapatmak istediğinizden emin misiniz? Geri tuşuna bir kez daha basın.
            </p>
            <button
              className="btn btn-ghost btn-full"
              onClick={() => {
                setShowExitConfirm(false);
                backPressCountRef.current = 0;
              }}
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {/* TOASTS */}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className="toast" style={{ borderColor: t.color, color: t.color }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
