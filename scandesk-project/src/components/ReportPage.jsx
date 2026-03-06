import { useState } from "react";
import { Ic, I } from "./Icon";

function groupBy(arr, key) {
  const m = {};
  arr.forEach(r => {
    const k = r[key] || "(Bilinmiyor)";
    if (!m[k]) m[k] = 0;
    m[k]++;
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function BarCard({ title, icon, color, entries }) {
  const max = entries[0]?.[1] || 1;
  return (
    <div style={{ background: "var(--s1)", border: "1.5px solid var(--brd)", borderRadius: "var(--r2)", padding: "14px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ color }}><Ic d={icon} s={16} /></div>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--tx2)" }}>{entries.length} çeşit</span>
      </div>
      {entries.length === 0 ? (
        <div style={{ color: "var(--tx3)", fontSize: 12 }}>Veri yok</div>
      ) : (
        entries.slice(0, 10).map(([label, count]) => (
          <div key={label} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color, flexShrink: 0 }}>{count}</span>
            </div>
            <div style={{ height: 6, background: "var(--s3)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(count / max) * 100}%`, background: color, borderRadius: 3, transition: "width .4s" }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function ReportPage({ records, fields }) {
  const [range, setRange] = useState("all");

  const now = new Date();
  const filtered = records.filter(r => {
    if (range === "all") return true;
    const d = new Date(r.timestamp);
    if (range === "today") return d.toDateString() === now.toDateString();
    if (range === "week") {
      // Monday of current week
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);
      return d >= weekStart;
    }
    if (range === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    return true;
  });

  const byDate     = groupBy(filtered, "date");
  const byShift    = groupBy(filtered, "shift");
  const byCustomer = groupBy(filtered, "customer");
  const byUser     = groupBy(filtered, "scanned_by");
  const uniqueBarcodes = new Set(filtered.map(r => r.barcode)).size;

  return (
    <div className="page">
      {/* Summary stats */}
      <div className="stats-row" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 12 }}>
        <div className="stat"><div className="stat-val" style={{ color: "var(--acc)" }}>{filtered.length}</div><div className="stat-lbl">Kayıt</div></div>
        <div className="stat"><div className="stat-val" style={{ color: "var(--ok)" }}>{uniqueBarcodes}</div><div className="stat-lbl">Benzersiz</div></div>
        <div className="stat"><div className="stat-val" style={{ color: "var(--inf)" }}>{byCustomer.length}</div><div className="stat-lbl">Müşteri</div></div>
        <div className="stat"><div className="stat-val" style={{ color: "var(--pur)" }}>{byUser.length}</div><div className="stat-lbl">Personel</div></div>
      </div>

      {/* Date range filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[["all","Tümü"],["today","Bugün"],["week","Bu Hafta"],["month","Bu Ay"]].map(([v, label]) => (
          <button key={v} className={`btn btn-sm ${range === v ? "btn-info" : "btn-ghost"}`} onClick={() => setRange(v)}>{label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state"><Ic d={I.report} s={40} /><p style={{ marginTop: 10, fontSize: 14 }}>Bu aralıkta kayıt yok</p></div>
      ) : (
        <>
          <BarCard title="Müşteri Bazlı"  icon={I.group}  color="var(--inf)" entries={byCustomer} />
          <BarCard title="Vardiya Bazlı"  icon={I.scan}   color="var(--ok)"  entries={byShift} />
          <BarCard title="Personel Bazlı" icon={I.users}  color="var(--pur)" entries={byUser} />
          <BarCard title="Tarih Bazlı"    icon={I.data}   color="var(--acc)" entries={byDate} />
        </>
      )}
    </div>
  );
}
