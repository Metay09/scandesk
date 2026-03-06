import { useState } from "react";
import { Ic, I } from "./Icon";
import PasswordInput from "./PasswordInput";

export default function Login({ users, onLogin }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState("");
  const go = () => {
    const f = users.find(x => x.username === u && x.password === p && x.active !== false);
    if (f) onLogin(f);
    else setErr("Kullanıcı adı veya şifre hatalı.");
  };
  return (
    <div className="login-wrap">
      <div className="login-box">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div className="logo-icon" style={{ width: 42, height: 42, borderRadius: 11 }}><Ic d={I.barcode} s={21} /></div>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.4px" }}>ScanDesk</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 28 }}>Barkod yönetim sistemine giriş yapın</p>
        {err && <div className="err-msg">{err}</div>}
        <div className="fg">
          <label className="lbl">Kullanıcı Adı</label>
          <input value={u} onChange={e => setU(e.target.value)} placeholder="kullanici_adi"
            autoCapitalize="none" autoCorrect="off" onKeyDown={e => e.key === "Enter" && go()} />
        </div>
        <div className="fg">
          <label className="lbl">Şifre</label>
          <PasswordInput value={p} onChange={e => setP(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-full btn-lg" onClick={go}>Giriş Yap</button>
      </div>
    </div>
  );
}
