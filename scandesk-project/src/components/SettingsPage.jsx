import { useState } from "react";
import { Ic, I } from "./Icon";
import Toggle from "./Toggle";
import PasswordInput from "./PasswordInput";

export default function SettingsPage({ settings, setSettings, integration, setIntegration, isAdmin, onClearData, onDeleteRange, records, toast, user, onLogout, theme, onToggleTheme }) {
  const set = (k, v) => setSettings(p => ({ ...p, [k]: v }));
  const [sbOpen, setSbOpen] = useState(false);
  const [gsOpen, setGsOpen] = useState(false);
  const [sb, setSb] = useState({ ...integration.supabase });
  const [gs, setGs] = useState({ ...integration.gsheets });
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const Row = ({ icon, label, sub, children, onClick }) => (
    <div className={`s-row ${onClick ? "clickable" : ""}`} onClick={onClick}>
      {icon && <div style={{ color: "var(--tx2)", flexShrink: 0 }}><Ic d={icon} s={17} /></div>}
      <div style={{ flex: 1 }}>
        <div className="s-label">{label}</div>
        {sub && <div className="s-sub">{sub}</div>}
      </div>
      <div className="s-val">{children}</div>
    </div>
  );

  return (
    <div className="page" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div className="section-hd">Tarama</div>
      <div className="s-card">
        <Row icon={I.save} label="Otomatik Kaydet" sub="Her okumada Enter'la otomatik kaydeder"><Toggle value={settings.autoSave} onChange={v => set("autoSave", v)} /></Row>
        <Row icon={I.edit} label="Taramadan Sonra Detay Ekle" sub="Önce barkod taranır, sonra diğer alanlar doldurulur"><Toggle value={settings.addDetailAfterScan} onChange={v => set("addDetailAfterScan", v)} /></Row>
        <Row icon={I.vib} label="Titreşim"><Toggle value={settings.vibration} onChange={v => set("vibration", v)} /></Row>
        <Row icon={I.bell} label="Bip Sesi"><Toggle value={settings.beep} onChange={v => set("beep", v)} /></Row>
        <Row icon={I.data} label="Son Okutmalar" sub="Aktif vardiyada gösterilecek son kayıt sayısı">
          <select
            value={String(settings.recentLimit ?? 10)}
            onChange={e => set('recentLimit', parseInt(e.target.value, 10))}
            style={{ height: 34, borderRadius: 10, padding: '0 10px', background: 'var(--s2)', color: 'var(--tx)', border: '1.5px solid var(--brd)' }}
          >
            {[5,10,20,50,100,200].map(n => <option key={n} value={String(n)}>{n}</option>)}
            <option value="0">Full</option>
          </select>
        </Row>
        <Row icon={I.barcode} label="Barkod Uzunluk Kontrolü" sub="İlk okutulan barkod uzunluğu ile devam eder, yanlış okumayı önler"><Toggle value={settings.enforceBarcodeLengthMatch} onChange={v => set("enforceBarcodeLengthMatch", v)} /></Row>
      </div>

      {isAdmin && <>
        <div className="section-hd">Güvenlik & İzinler</div>
        <div className="s-card">
          <Row icon={I.xlsx}  label="Dışa Aktarmaya İzin Ver"><Toggle value={settings.allowExport}     onChange={v => set("allowExport", v)} /></Row>
          <Row icon={I.upload}  label="İçe Aktarmaya İzin Ver"><Toggle value={settings.allowImport}     onChange={v => set("allowImport", v)} /></Row>
          <Row icon={I.trash} label="Verileri Temizlemeye İzin Ver"><Toggle value={settings.allowClearData}  onChange={v => set("allowClearData", v)} /></Row>
          <Row icon={I.plus}  label="Alan Eklemeye İzin Ver"><Toggle value={settings.allowAddField}    onChange={v => set("allowAddField", v)} /></Row>
          <Row icon={I.edit}  label="Alan Düzenlemeye İzin Ver"><Toggle value={settings.allowEditField}   onChange={v => set("allowEditField", v)} /></Row>
          <Row icon={I.del}   label="Alan Silmeye İzin Ver"><Toggle value={settings.allowDeleteField}  onChange={v => set("allowDeleteField", v)} /></Row>
        </div>
        <div className="section-hd">Veri Temizleme (Aralık)</div>
        <div className="s-card">
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--tx2)" }}>Tarih/Saat aralığı seçin. Seçilen aralıktaki kayıtlar silinir.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="lbl">Başlangıç</label>
                <input type="datetime-local" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="lbl">Bitiş</label>
                <input type="datetime-local" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
              </div>
            </div>
            <button className="btn btn-danger" disabled={!rangeStart || !rangeEnd} onClick={() => {
              if (!rangeStart || !rangeEnd) { toast("Aralık seçin", "var(--acc)"); return; }
              const a = new Date(rangeStart).toISOString();
              const b = new Date(rangeEnd).toISOString();
              const n = records.filter(r => r.timestamp >= a && r.timestamp <= b).length;
              if (!n) { toast("Bu aralıkta kayıt yok", "var(--acc)"); return; }
              if (!window.confirm(`${n} kayıt silinecek (seçilen aralık). Onaylıyor musunuz?`)) return;
              onDeleteRange(rangeStart, rangeEnd);
              toast(`${n} kayıt silindi`, "var(--err)");
              setRangeStart(""); setRangeEnd("");
            }}><Ic d={I.trash} s={16} /> Seçilen Aralığı Sil</button>
          </div>
        </div>

        <div className="section-hd">Entegrasyon</div>
        {integration.active && (
          <div style={{ margin: "0 0 10px", padding: "10px 12px", background: "var(--ok2)", border: "1.5px solid var(--ok3)", borderRadius: "var(--r)", fontSize: 12, color: "var(--ok)", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
            Aktif: {integration.type === "supabase" ? "Supabase (PostgreSQL)" : "Google Sheets"}
            <button className="btn btn-danger btn-sm" style={{ marginLeft: "auto", height: 30 }} onClick={() => setIntegration(p => ({ ...p, active: false }))}>Durdur</button>
          </div>
        )}
        {/* Supabase */}
        <div className="int-card">
          <div className={`int-hd ${sbOpen ? "open" : ""}`} onClick={() => setSbOpen(p => !p)}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(62,207,142,.15)", border: "1.5px solid rgba(62,207,142,.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic d={I.cloud} s={17} /></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>Supabase (PostgreSQL)</div><div style={{ fontSize: 12, color: "var(--tx2)" }}>Gerçek zamanlı veritabanı</div></div>
            {integration.active && integration.type === "supabase" && <span className="badge badge-ok">AKTİF</span>}
            <Ic d={I.chevD} s={14} />
          </div>
          {sbOpen && (
            <div className="int-bd">
              <div className="info-box inf" style={{ fontSize: 12 }}>
                <b>1.</b> supabase.com → yeni proje oluştur<br />
                <b>2.</b> Project Settings → API → URL ve anon key kopyala<br />
                <b>3.</b> SQL Editor'de şu komutu çalıştır:<br />
                <textarea readOnly rows={5} style={{ marginTop: 8, fontSize: 10, fontFamily: "var(--mono)", background: "rgba(0,0,0,.3)", border: "1px solid var(--brd)", borderRadius: "var(--r)", padding: 8, color: "var(--tx)" }}
                  value={`CREATE TABLE taramalar (\n  barcode text,\n  customer text,\n  scanned_by text,\n  scanned_by_username text,\n  timestamp timestamptz,\n  qty text, note text\n);`} />
              </div>
              <div><label className="lbl">Project URL</label><input placeholder="https://xxxx.supabase.co" value={sb.url} onChange={e => setSb(p => ({ ...p, url: e.target.value }))} /></div>
              <div><label className="lbl">Anon Key</label><PasswordInput value={sb.key} onChange={e => setSb(p => ({ ...p, key: e.target.value }))} placeholder="eyJhbGci..." /></div>
              <div><label className="lbl">Tablo Adı</label><input placeholder="taramalar" value={sb.table} onChange={e => setSb(p => ({ ...p, table: e.target.value }))} /></div>
              <button className="btn btn-ok btn-full" onClick={() => { if (!sb.url || !sb.key || !sb.table) { toast("Tüm alanları doldurun", "var(--err)"); return; } setIntegration({ type: "supabase", active: true, supabase: sb, gsheets: gs }); toast("Supabase aktif edildi"); setSbOpen(false); }}><Ic d={I.check} s={15} /> Aktif Et</button>
            </div>
          )}
        </div>
        {/* Google Sheets */}
        <div className="int-card">
          <div className={`int-hd ${gsOpen ? "open" : ""}`} onClick={() => setGsOpen(p => !p)}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(34,197,94,.15)", border: "1.5px solid rgba(34,197,94,.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic d={I.sheets} s={17} /></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>Google Sheets</div><div style={{ fontSize: 12, color: "var(--tx2)" }}>Apps Script ile doğrudan e-tabloya yaz</div></div>
            {integration.active && integration.type === "gsheets" && <span className="badge badge-ok">AKTİF</span>}
            <Ic d={I.chevD} s={14} />
          </div>
          {gsOpen && (
            <div className="int-bd">
              <div className="info-box inf" style={{ fontSize: 12, lineHeight: 1.7 }}>
                <b>1.</b> Google E-Tablolar'da yeni tablo aç<br />
                <b>2.</b> Uzantılar → Apps Script → şu kodu yapıştır:
                <textarea readOnly rows={8} style={{ marginTop: 8, fontSize: 10, fontFamily: "var(--mono)", background: "rgba(0,0,0,.3)", border: "1px solid var(--brd)", borderRadius: "var(--r)", padding: 8, color: "var(--tx)" }}
                  value={`const SHEET_ID = "BURAYA_SHEET_ID_YAPI\u015ATIR";\n\nfunction doPost(e) {\n  const d = JSON.parse(e.postData.contents);\n  const ss = SpreadsheetApp.openById(SHEET_ID);\n  const sh = ss.getSheetByName("Taramalar")\n    || ss.insertSheet("Taramalar");\n  if (sh.getLastRow() === 0) sh.appendRow(d.headers);\n  sh.appendRow(d.row);\n  return ContentService.createTextOutput("OK");\n}`} />
                <b>3.</b> Dağıt → Web uygulaması → Erişim: <b>Herkes</b><br />
                <b>4.</b> Oluşan URL'yi aşağıya yapıştır
              </div>
              <div><label className="lbl">Web App URL</label><input placeholder="https://script.google.com/macros/s/..." value={gs.scriptUrl} onChange={e => setGs(p => ({ ...p, scriptUrl: e.target.value }))} /></div>
              <button className="btn btn-ok btn-full" onClick={() => { if (!gs.scriptUrl) { toast("URL gerekli", "var(--err)"); return; } setIntegration({ type: "gsheets", active: true, supabase: sb, gsheets: gs }); toast("Google Sheets aktif edildi"); setGsOpen(false); }}><Ic d={I.check} s={15} /> Aktif Et</button>
            </div>
          )}
        </div>

        {settings.allowClearData && (
          <>
            <div className="section-hd">Veri</div>
            <div className="s-card">
              <Row icon={I.trash} label="Tüm Kayıtları Temizle" sub="Bu işlem geri alınamaz" onClick={onClearData}>
                <span style={{ color: "var(--err)", fontWeight: 700 }}>Temizle</span><Ic d={I.chevR} s={14} />
              </Row>
            </div>
          </>
        )}
      </>}

      <div className="section-hd">Hesap</div>
      <div className="s-card">
        {user && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--brd)" }}>
            <div className="avatar" style={{ width: 32, height: 32, fontSize: 14, flexShrink: 0 }}>{(user.name || user.username || "?")[0].toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{user.name}</div>
              <div style={{ fontSize: 11, color: "var(--tx2)" }}>@{user.username} · {user.role === "admin" ? "Admin" : "Kullanıcı"}</div>
            </div>
          </div>
        )}
        <Row icon={theme === "dark" ? I.sun : I.moon} label={theme === "dark" ? "Açık Temaya Geç" : "Koyu Temaya Geç"} sub="Uygulama görünümünü değiştir" onClick={onToggleTheme}>
          <Ic d={I.chevR} s={14} />
        </Row>
        <Row icon={I.logout} label="Çıkış Yap" sub="Oturumu kapat" onClick={onLogout}>
          <Ic d={I.chevR} s={14} />
        </Row>
      </div>
    </div>
  );
}
