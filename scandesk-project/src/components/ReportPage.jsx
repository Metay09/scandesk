import { useState } from "react";
import { Ic, I } from "./Icon";
import { deriveShiftDate, getShiftDate } from "../utils";

function groupBy(arr, key) {
  const m = {};
  arr.forEach(r => {
    const k = typeof key === "function" ? key(r) : (r[key] || "(Bilinmiyor)");
    const keyVal = k || "(Bilinmiyor)";
    if (!m[keyVal]) m[keyVal] = 0;
    m[keyVal]++;
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

export default function ReportPage({ records, fields, isAdmin, currentShift }) {
  const [dateFilter, setDateFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");

  const currentShiftDate = getShiftDate(undefined, currentShift);

  const visibleRecords = isAdmin
    ? records
    : records.filter(r => r.shift === currentShift && deriveShiftDate(r) === currentShiftDate);

  // Filter records based on selected filters
  const filtered = visibleRecords.filter(r => {
    if (dateFilter && deriveShiftDate(r) !== dateFilter) return false;
    if (isAdmin && shiftFilter !== "all" && r.shift !== shiftFilter) return false;
    if (customerFilter !== "all" && r.customer !== customerFilter) return false;
    if (userFilter !== "all" && r.scanned_by_username !== userFilter) return false;
    return true;
  });

  const byDate     = groupBy(filtered, (r) => deriveShiftDate(r));
  const byShift    = groupBy(filtered, "shift");
  const byCustomer = groupBy(filtered, "customer");
  const byUser     = groupBy(filtered, "scanned_by");

  const allShifts = [...new Set(visibleRecords.map(r => r.shift).filter(Boolean))].sort();
  const allCustomers = [...new Set(visibleRecords.map(r => r.customer).filter(Boolean))].sort();
  const allUsers = [...new Set(visibleRecords.map(r => r.scanned_by_username).filter(Boolean))].sort();

  return (
    <div className="page">
      {/* Advanced filtering */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 140px", minWidth: 120 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx2)", marginBottom: 4 }}>Tarih</label>
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12 }}
            />
          </div>
          {isAdmin && allShifts.length > 0 && (
            <div style={{ flex: "1 1 140px", minWidth: 120 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx2)", marginBottom: 4 }}>Vardiya</label>
              <select
                value={shiftFilter}
                onChange={e => setShiftFilter(e.target.value)}
                style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12, fontWeight: 600 }}
              >
                <option value="all">Tümü</option>
                {allShifts.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          {allCustomers.length > 0 && (
            <div style={{ flex: "1 1 140px", minWidth: 120 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx2)", marginBottom: 4 }}>Müşteri</label>
              <select
                value={customerFilter}
                onChange={e => setCustomerFilter(e.target.value)}
                style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12, fontWeight: 600 }}
              >
                <option value="all">Tümü</option>
                {allCustomers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {allUsers.length > 0 && (
            <div style={{ flex: "1 1 140px", minWidth: 120 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx2)", marginBottom: 4 }}>Kullanıcı</label>
              <select
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
                style={{ width: "100%", height: 40, borderRadius: 10, padding: "0 10px", background: "var(--s2)", color: "var(--tx)", border: "1.5px solid var(--brd)", fontSize: 12, fontWeight: 600 }}
              >
                <option value="all">Tümü</option>
                {allUsers.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          )}
        </div>
        {(dateFilter || (isAdmin && shiftFilter !== "all") || customerFilter !== "all" || userFilter !== "all") && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setDateFilter(""); if (isAdmin) setShiftFilter("all"); setCustomerFilter("all"); setUserFilter("all"); }}
          >
            <Ic d={I.close} s={14} /> Filtreleri Temizle
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state"><Ic d={I.report} s={40} /><p style={{ marginTop: 10, fontSize: 14 }}>Bu filtrelere uygun kayıt yok</p></div>
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
