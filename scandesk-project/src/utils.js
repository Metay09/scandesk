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

export const getDefaultShift = (shiftList) => {
  const list = Array.isArray(shiftList) && shiftList.length ? shiftList : ["00:00/08:00","08:00/16:00","16:00/24:00"];
  const h = new Date().getHours();
  if (h < 8) return list[0];
  if (h < 16) return list[1] ?? list[0];
  return list[2] ?? list[list.length-1];
};

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
