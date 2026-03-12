export async function postgresApiInsert(cfg, row) {
  const r = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}/api/taramalar`, {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`PostgreSQL API ${r.status}: ${await r.text()}`);
}

export async function postgresApiUpdate(cfg, id, row) {
  const r = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}/api/taramalar/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`PostgreSQL API ${r.status}: ${await r.text()}`);
}

export async function postgresApiDelete(cfg, id) {
  const r = await fetch(`${cfg.serverUrl.replace(/\/$/, "")}/api/taramalar/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-api-key": cfg.apiKey },
  });
  if (!r.ok) throw new Error(`PostgreSQL API ${r.status}: ${await r.text()}`);
}

// Note: Google Apps Script requires mode:"no-cors" which returns an opaque response.
// The promise resolves when the request is sent; server-side errors cannot be detected from the client.
//
// Google Sheets Integration Logic:
// - Apps Script now supports id-based upsert: if id exists, updates row; if not, inserts new row
// - headers: ["Barkod", ...fields, "Müşteri", ...] (id not included in headers, but added by Apps Script)
// - row[0] = id (first element is always the record id)
// - Apps Script manages header: ["id", ...headers] internally

export async function sheetsInsert(cfg, headers, row) {
  await fetch(cfg.scriptUrl, {
    method: "POST", mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers, row }),
  });
}

// Update existing record in Google Sheets (same as insert - Apps Script handles upsert by id)
// row[0] must be the record id; if id exists in sheet, row will be updated
export async function sheetsUpdate(cfg, headers, row) {
  await fetch(cfg.scriptUrl, {
    method: "POST", mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers, row }),
  });
}

// Delete record from Google Sheets by id
// Sends action: "delete" with the record id
export async function sheetsDelete(cfg, id) {
  await fetch(cfg.scriptUrl, {
    method: "POST", mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", id }),
  });
}

// Helper function to sync a single record to Google Sheets
// Builds the standard payload format and sends to Apps Script
// Used for create, update, and bulk sync operations
// Now includes full record structure for better data preservation
export async function syncRecordToSheets(cfg, record, fields) {
  const ef = fields.filter(f => f.id !== "barcode");
  const headers = [
    "Barkod",
    ...ef.map(f => f.label),
    "Müşteri",
    "Açıklama",
    "Kaydeden",
    "Kullanıcı Adı",
    "Tarih",
    "Saat",
    "Vardiya",
    "Vardiya Tarihi",
    "Kaynak",
    "Kaynak Kayıt ID",
    "Senkronizasyon Durumu",
    "Senkronizasyon Hatası",
    "Oluşturulma",
    "Güncellenme"
  ];

  const timestamp = new Date(record.timestamp);
  const rowArr = [
    record.id,                                          // ID for upsert (not in headers, added by Apps Script)
    record.barcode,
    ...ef.map(f => record.customFields?.[f.id] ?? ""),
    record.customer || "",
    record.aciklama || "",
    record.scanned_by,
    record.scanned_by_username,
    timestamp.toLocaleDateString("tr-TR"),
    timestamp.toLocaleTimeString("tr-TR"),
    record.shift || "",
    record.shiftDate || "",
    record.source || "",
    record.sourceRecordId || "",
    record.syncStatus || "",
    record.syncError || "",
    record.createdAt || "",
    record.updatedAt || ""
  ];

  // Use sheetsUpdate for upsert behavior (Apps Script handles both create and update)
  await sheetsUpdate(cfg, headers, rowArr);
}
