export async function supabaseInsert(cfg, row) {
  const r = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/${cfg.table}`, {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
}

// Note: Google Apps Script requires mode:"no-cors" which returns an opaque response.
// The promise resolves when the request is sent; server-side errors cannot be detected from the client.
export async function sheetsInsert(cfg, headers, row) {
  await fetch(cfg.scriptUrl, {
    method: "POST", mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers, row }),
  });
}
