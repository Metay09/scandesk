export const pad2 = (n) => String(n).padStart(2, "0");
export const nowTs = () => new Date().toISOString();

export const fmtDate = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};

export const fmtTime = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// Returns a stable, deterministic ID for a shift: "YYYY-MM-DD_N"
// N is the 1-indexed position of shiftLabel inside shiftList (0 if not found)
export const makeShiftId = (date, shiftLabel, shiftList) => {
  const list = Array.isArray(shiftList) && shiftList.length
    ? shiftList
    : ["00:00/08:00", "08:00/16:00", "16:00/24:00"];
  const idx = list.indexOf(shiftLabel);
  const no  = idx >= 0 ? idx + 1 : 0;
  return `${date}_${no}`;
};

export const getDefaultShift = (shiftList) => {
  const list = Array.isArray(shiftList) && shiftList.length ? shiftList : ["00:00/08:00","08:00/16:00","16:00/24:00"];
  const h = new Date().getHours();
  if (h < 8) return list[0];
  if (h < 16) return list[1] ?? list[0];
  return list[2] ?? list[list.length-1];
};

export async function hashPassword(plain, saltHex) {
  const salt = saltHex
    ? new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(plain), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    keyMaterial, 256
  );
  const hashHex  = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  const saltHexOut = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2:${saltHexOut}:${hashHex}`;
}

export async function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2:")) {
    const parts = stored.split(":");
    const saltHex = parts[1];
    const recomputed = await hashPassword(plain, saltHex);
    return recomputed === stored;
  }
  // legacy: plaintext stored before hashing was introduced
  return plain === stored;
}

export function playBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 1900; osc.type = "square";
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
    osc.start(); osc.stop(ctx.currentTime + 0.11);
  } catch {}
}
