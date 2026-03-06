import { useState } from "react";
import { Ic, I } from "./Icon";
import PasswordInput from "./PasswordInput";
import { hashPassword, verifyPassword } from "../utils";

export default function Login({ users, shiftList, onLogin, onMigratePassword }) {
  const [step, setStep]           = useState("auth"); // "auth" | "shift"
  const [u, setU]                 = useState("");
  const [p, setP]                 = useState("");
  const [err, setErr]             = useState("");
  const [authedUser, setAuthedUser] = useState(null);
  const [selectedShift, setSelectedShift] = useState(() => (shiftList && shiftList[0]) || "");

  const goAuth = async () => {
    const found = users.find(x => x.username === u && x.active !== false);
    if (!found) { setErr("Kullanıcı adı veya şifre hatalı."); return; }
    const ok = await verifyPassword(p, found.password);
    if (!ok) { setErr("Kullanıcı adı veya şifre hatalı."); return; }
    // migrate plaintext → hash if needed
    if (found.password.length < 64) {
      const hashed = await hashPassword(p);
      onMigratePassword?.(found.id, hashed);
    }
    if (found.role === "admin") {
      // Admin, vardiyasını tarama ekranında seçer
      onLogin(found, null);
    } else {
      // Normal kullanıcı: vardiya seçimi adımına geç
      setAuthedUser(found);
      setSelectedShift((shiftList && shiftList[0]) || "");
      setStep("shift");
    }
  };

  const goShift = () => {
    if (!selectedShift) return;
    onLogin(authedUser, selectedShift);
  };

  const Logo = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <div className="logo-icon" style={{ width: 42, height: 42, borderRadius: 11 }}><Ic d={I.barcode} s={21} /></div>
      <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.4px" }}>ScanDesk</span>
    </div>
  );

  if (step === "shift") {
    return (
      <div className="login-wrap">
        <div className="login-box">
          <Logo />
          <p style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 24 }}>
            Merhaba, <b>{authedUser?.name}</b> — aktif vardiyayı seçin
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {(shiftList && shiftList.length ? shiftList : ["00:00/08:00", "08:00/16:00", "16:00/24:00"]).map(s => (
              <button
                key={s}
                className={`btn btn-full ${selectedShift === s ? "btn-primary" : "btn-ghost"}`}
                style={{ justifyContent: "center", fontWeight: 700, fontSize: 15 }}
                onClick={() => setSelectedShift(s)}
              >
                {selectedShift === s && <Ic d={I.check} s={14} />} {s}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ok btn-full btn-lg"
            disabled={!selectedShift}
            onClick={goShift}
          >
            <Ic d={I.scan} s={18} /> Vardiyayı Başlat
          </button>
          <button
            className="btn btn-ghost btn-full btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => { setStep("auth"); setErr(""); }}
          >
            ← Geri
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <Logo />
        <p style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 28 }}>Barkod yönetim sistemine giriş yapın</p>
        {err && <div className="err-msg">{err}</div>}
        <div className="fg">
          <label className="lbl">Kullanıcı Adı</label>
          <input value={u} onChange={e => setU(e.target.value)} placeholder="kullanici_adi"
            autoCapitalize="none" autoCorrect="off" onKeyDown={e => e.key === "Enter" && goAuth()} />
        </div>
        <div className="fg">
          <label className="lbl">Şifre</label>
          <PasswordInput value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === "Enter" && goAuth()} />
        </div>
        <button className="btn btn-primary btn-full btn-lg" onClick={goAuth}>Giriş Yap</button>
      </div>
    </div>
  );
}
