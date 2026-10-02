/**
 * 自国通貨表示に使う為替レートを取得して data/fx.json に保存する（手動で実行: npm run fx）。
 *
 * ■ なぜビルド時に取りに行かないか
 * デプロイ（GitHub Actions）がネットワークの都合で落ちたり、同じコミットから違う数字が出たりしないように、
 * 日付つきのファイルとしてリポジトリに置く。表示側は必ず「いつのレートか」を併記する。
 *
 * ■ 取得元
 * - 欧州中央銀行の参照レート（EUR建て）: USD・CAD・GBP・AUD・SGD・HKD・JPY
 * - 台湾ドルは欧州中央銀行に無い。台湾銀行は自動アクセスを確認画面で弾くので回避しない。
 *   代わりに米連邦準備制度の H.10（USD建ての TWD と JPY）から、同じ日付の値で円換算する。
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "data", "fx.json");
const UA = { "User-Agent": "JapanProxyCost/1.0 (https://japanproxy.kakuni-lab.com)" };

const ecbXml = await (await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { headers: UA })).text();
const ecbDate = ecbXml.match(/time='([\d-]+)'/)?.[1];
const perEur = Object.fromEntries([...ecbXml.matchAll(/currency='([A-Z]{3})' rate='([\d.]+)'/g)].map((m) => [m[1], Number(m[2])]));
if (!ecbDate || !perEur.JPY || !perEur.USD) throw new Error("ECB のレートが読めません");

// 円/外貨 = (円/EUR) ÷ (外貨/EUR)
const jpyPer = { EUR: perEur.JPY };
for (const cur of ["USD", "CAD", "GBP", "AUD", "SGD", "HKD"]) {
  if (!perEur[cur]) throw new Error(`ECB に ${cur} がありません`);
  jpyPer[cur] = perEur.JPY / perEur[cur];
}

// H.10: 表の見出しの最後の日付と、その列の TWD・JPY（どちらも 1米ドルあたり）
const h10 = (await (await fetch("https://www.federalreserve.gov/releases/h10/current/", { headers: UA })).text())
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const head = h10.match(/COUNTRY CURRENCY ((?:[A-Z][a-z]{2}\.? \d{1,2} ?)+)/);
const dates = head ? head[1].trim().split(/ (?=[A-Z][a-z]{2})/) : [];
const lastOf = (label) => {
  const m = h10.match(new RegExp(`${label} ((?:[\\d.]+|ND) ?){1,5}`));
  const vals = m ? m[0].replace(label, "").trim().split(" ") : [];
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== "ND") return { value: Number(vals[i]), index: i };
  return null;
};
const twd = lastOf("TAIWAN DOLLAR"), jpy = lastOf("JAPAN YEN");
if (!twd || !jpy || twd.index !== jpy.index) throw new Error("H.10 の TWD/JPY が同じ日付で読めません");
jpyPer.TWD = jpy.value / twd.value;
const year = Number(ecbDate.slice(0, 4));
const fedDate = (() => {
  const d = dates[twd.index]; if (!d) return null;
  const dt = new Date(`${d.replace(".", "")} ${year} UTC`);
  if (dt > new Date(`${ecbDate}T23:59:59Z`)) dt.setUTCFullYear(year - 1);   // 年をまたぐ場合
  return dt.toISOString().slice(0, 10);
})();

const fx = {
  _meta: {
    note: "1外貨あたりの円。表示はあくまで目安で、必ず日付と出典を併記する。npm run fx で更新。",
    sources: {
      ecb: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
      fedH10: "https://www.federalreserve.gov/releases/h10/current/",
    },
    asOf: { ecb: ecbDate, fedH10: fedDate },
    fetchedAt: new Date().toISOString().slice(0, 10),
  },
  jpyPer: Object.fromEntries(Object.entries(jpyPer).map(([k, v]) => [k, Number(v.toFixed(4))])),
  currencyOf: { US: "USD", CA: "CAD", GB: "GBP", AU: "AUD", DE: "EUR", FR: "EUR", SG: "SGD", TW: "TWD", HK: "HKD" },
  symbol: { USD: "US$", CAD: "C$", GBP: "£", AUD: "A$", EUR: "€", SGD: "S$", HKD: "HK$", TWD: "NT$" },
};
fs.writeFileSync(OUT, JSON.stringify(fx, null, 2) + "\n");
console.log(`✅ data/fx.json を更新（ECB ${ecbDate} / H.10 ${fedDate}）`);
for (const [k, v] of Object.entries(fx.jpyPer)) console.log(`   1 ${k} = ¥${v}`);
