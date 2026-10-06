/**
 * EMS の重量帯の刻み方を文にする（2026-10-06、料金表を全42段にしたときに追加）。
 * 刻み幅が同じ区間をまとめて「100 g steps up to 1 kg, 250 g steps up to 2 kg …」の形にする。
 */
const kg = (g) => (g >= 1000 ? `${+(g / 1000).toFixed(2)} kg` : `${g} g`);

export function bandSteps(rates) {
  const ws = rates.map((r) => r.weightG);
  const out = [];
  for (let i = 1; i < ws.length; i++) {
    const gap = ws[i] - ws[i - 1];
    if (out.length && out.at(-1).gap === gap) out.at(-1).to = ws[i];
    else out.push({ gap, to: ws[i] });
  }
  return `the first band ends at ${kg(ws[0])}, then ${out.map((x) => `${kg(x.gap)} steps up to ${kg(x.to)}`).join(", ")}`;
}

/** 表や文で代表として見せる重量（全段を並べるとページが長くなり、同じ地帯の国のページが似すぎる） */
export const KEY_WEIGHTS = [500, 1000, 1500, 2000, 3000, 5000, 10000, 20000, 30000];
