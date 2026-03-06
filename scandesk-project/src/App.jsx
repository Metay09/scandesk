import { useState, useEffect, useCallback, useRef } from "react";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import * as XLSX from "xlsx";

import "./index.css";
import { INITIAL_USERS, INITIAL_SETTINGS, INITIAL_FIELDS, DEFAULT_CUSTS } from "./constants";
import { isNative, loadState, saveState } from "./services/storage";
import { getCurrentShift, pad2 } from "./utils";
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
  const inGraceRef = useRef(false);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("scandesk_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  // Load persisted state on start
  useEffect(() => {
    (async () => {
      const st = await loadState();
      if (st && typeof st === "object") {
        if (Array.isArray(st.users) && st.users.length) setUsers(st.users);
        if (Array.isArray(st.fields) && st.fields.length) setFields(st.fields);
        if (Array.isArray(st.records)) setRecords(st.records);
        if (st.lastSaved) setLastSaved(st.lastSaved);
        if (Array.isArray(st.custList) && st.custList.length) setCustList(st.custList);
        if (st.settings) {
          setSettings(st.settings);
        }
        if (st.integration) setIntegration(st.integration);
      }
      // ensure admin exists
      setUsers(p => {
        const hasAdmin = p.some(u => u.username === "admin");
        return hasAdmin ? p : [INITIAL_USERS[0], ...p];
      });
      setHydrated(true);
    })();
  }, []);

  // Persist on changes
  useEffect(() => {
    if (!hydrated) return;
    saveState({ users, fields, records, lastSaved, custList, settings, integration });
  }, [hydrated, users, fields, records, lastSaved, custList, settings, integration]);

  const { toasts, add: toast } = useToast();

  const isAdmin = user?.role === "admin";

  const handleLogout = useCallback(() => {
    inGraceRef.current = false;
    setUser(null);
    setPage("scan");
    setUserLoginShift(null);
    setGraceSecsLeft(null);
  }, []);

  const handleLogin = useCallback((u) => {
    inGraceRef.current = false;
    setUser(u);
    setPage("scan");
    setGraceSecsLeft(null);
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
        setGraceSecsLeft(GRACE_PERIOD_SECS);
        setPage(prev => prev === "scan" ? "data" : prev);
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [user, isAdmin, userLoginShift]);

  // 5 dakika geri sayım + otomatik çıkış
  useEffect(() => {
    if (graceSecsLeft === null || !user) return;
    if (graceSecsLeft === 0) { handleLogout(); return; }
    const id = setTimeout(() => setGraceSecsLeft(s => (s !== null && s > 0) ? s - 1 : s), 1000);
    return () => clearTimeout(id);
  }, [graceSecsLeft, user, handleLogout]);

  const handleSave   = useCallback(r => { setRecords(p => [r, ...p]); setLastSaved(r); }, []);
  const handleDelete = id => { setRecords(p => p.filter(r => r.id !== id)); setLastSaved(p => (p && p.id === id ? null : p)); toast("Kayıt silindi", "var(--err)"); };
  const handleEdit   = r  => { setRecords(p => p.map(x => x.id === r.id ? r : x)); toast("Güncellendi", "var(--inf)"); };
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
    const hdr = ["Barkod", ...ef.map(f => f.label), "Müşteri", "Kaydeden", "Kullanıcı Adı", "Tarih", "Saat"];
    const data = recs.map(r => {
      const d = new Date(r.timestamp);
      return [r.barcode, ...ef.map(f => r[f.id] ?? ""), r.customer ?? "", r.scanned_by ?? "", r.scanned_by_username ?? "", d.toLocaleDateString("tr-TR"), d.toLocaleTimeString("tr-TR")];
    });
    if (type === "xlsx") {
      const ws = XLSX.utils.aoa_to_sheet([hdr, ...data]);
      ws["!cols"] = hdr.map(() => ({ wch: 20 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Taramalar");
      const filename = `scandesk_${new Date().toISOString().slice(0, 10)}.xlsx`;

      if (isNative()) {
        const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
        await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Documents });
        await Share.share({ title: "ScanDesk Excel", text: "Excel dosyası hazır", url: (await Filesystem.getUri({ directory: Directory.Documents, path: filename })).uri });
        toast("Excel hazır (Paylaş)", "var(--ok)");
      } else {
        XLSX.writeFile(wb, filename);
      }
    } else {
      const csv = [hdr, ...data].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const filename = `scandesk_${Date.now()}.csv`;
      if (isNative()) {
        await Filesystem.writeFile({ path: filename, data: "\uFEFF" + csv, directory: Directory.Documents, encoding: Encoding.UTF8 });
        await Share.share({ title: "ScanDesk CSV", text: "CSV dosyası hazır", url: (await Filesystem.getUri({ directory: Directory.Documents, path: filename })).uri });
        toast("CSV hazır (Paylaş)", "var(--ok)");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
        a.download = filename;
        a.click();
      }
    }
    toast(type.toUpperCase() + " indirildi");
  };

  const handleImport = (imported) => {
    if (!imported.length) { toast("İçe aktarılacak veri yok", "var(--acc)"); return; }
    setRecords(p => [...imported, ...p]);
    toast(`✓ ${imported.length} kayıt içe aktarıldı`, "var(--ok)");
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

  if (!user) return <Login users={users} onLogin={handleLogin} onMigratePassword={handleMigratePassword} />;

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
            {n.id === "data" && records.length > 0 && <span className="nav-badge" style={{ marginLeft: "auto" }}>{records.length}</span>}
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
        {page === "scan"     && <ScanPage fields={fields} onSave={handleSave} onEdit={handleEdit} records={records} lastSaved={lastSaved} customers={customers} isAdmin={isAdmin} user={user} integration={integration} scanSettings={settings} toast={toast} shiftExpired={graceSecsLeft !== null && !isAdmin} />}
        {page === "data"     && <DataPage     fields={fields} records={records} onDelete={handleDelete} onEdit={handleEdit} onExport={handleExport} onImport={handleImport} customers={customers} settings={settings} toast={toast} isAdmin={isAdmin} />}
        {page === "report"   && <ReportPage   records={records} fields={fields} />}
        {page === "fields"   && <FieldsPage   fields={fields} setFields={setFields} isAdmin={isAdmin} settings={settings} />}
        {page === "users"    && isAdmin && <UsersPage users={users} setUsers={setUsers} currentUser={user} toast={toast} />}
        {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} integration={integration} setIntegration={setIntegration} isAdmin={isAdmin} onClearData={handleClear} onDeleteRange={handleDeleteRange} records={records} toast={toast} user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />}
      </div>

      {/* BOTTOM NAV (mobile) */}
      <nav className="bot-nav">
        {NAV.map(n => (
          <button key={n.id} className={`nav-btn ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <Ic d={n.icon} s={21} />{n.label}
            {n.id === "data" && records.length > 0 && <span className="nav-badge">{records.length}</span>}
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
            Vardiya sona erdi — çıkışa {Math.floor(graceSecsLeft / 60)}:{pad2(graceSecsLeft % 60)} kaldı
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

      {/* TOASTS */}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className="toast" style={{ borderColor: t.color, color: t.color }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
