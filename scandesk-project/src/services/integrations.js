export async function supabaseInsert(cfg, row) {
  const r = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/${cfg.table}`, {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
}

export async function sheetsInsert(cfg, headers, row) {
  await fetch(cfg.scriptUrl, {
    method: "POST", mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers, row }),
  });
}
