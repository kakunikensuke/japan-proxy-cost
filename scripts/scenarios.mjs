/**
 * ①今払う額 / ②到着時に払う額 / ③最終総額 の3段構造が
 * 利用者にそのまま見せられる形になっているかを確認する。
 * ここで出た文言がそのまま画面のコピーになる。
 *
 * 実行: node scripts/scenarios.mjs
 */
import proxies from "../data/proxies.json" with { type: "json" };
import ems from "../data/shipping-ems.json" with { type: "json" };
import importTax from "../data/import-tax.json" with { type: "json" };
import { calculateAll } from "../src/lib/calc.mjs";

const yen = (n) => "¥" + n.toLocaleString("en-US");

const scenarios = [
  { label: "Mercari figure ¥8,000 / 1kg → United States", input: { source: "mercari", itemPriceJpy: 8000, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700 } },
  { label: "5 items from one shop ¥20,000 / 2.5kg → United States", input: { source: "other_shop", itemPriceJpy: 20000, itemCount: 5, weightG: 2500, destination: "US", domesticShippingJpy: 700, sameShop: true } },
  { label: "Recommended store ¥5,000 / 500g → United Kingdom", input: { source: "recommended", itemPriceJpy: 5000, itemCount: 1, weightG: 500, destination: "GB", domesticShippingJpy: 600 } },
  { label: "Yahoo Auction ¥250,000 / 3kg → United States", input: { source: "yahoo_auction", itemPriceJpy: 250000, itemCount: 1, weightG: 3000, destination: "US", domesticShippingJpy: 900 } },
  { label: "3 separate auctions ¥30,000 / 2kg → Germany", input: { source: "yahoo_auction", itemPriceJpy: 30000, itemCount: 3, weightG: 2000, destination: "DE", domesticShippingJpy: 1500 } },
];

// ---- 1件だけ、利用者に見せる完全な形で出す ----
const demo = scenarios[2];
const { results: demoResults, country } = calculateAll({ ...demo.input, buyeePlan: "light" }, { proxies, ems, importTax });

console.log("=".repeat(72));
console.log("USER-FACING VIEW  /  " + demo.label);
console.log("=".repeat(72));
if (country?.displayEn) console.log(`\n[!] ${country.displayEn.headline}\n    ${country.displayEn.body}`);

demoResults.slice(0, 2).forEach((r, i) => {
  console.log(`\n${"-".repeat(72)}\n#${i + 1}  ${r.name}   TOTAL ${yen(r.grandTotal)}${r.grandTotalIsMinimum ? " (minimum — see notes)" : ""}`);
  console.log(`\n  ① ${r.payNow.labelEn}: ${yen(r.payNow.total)}`);
  r.payNow.lines.forEach((l) => console.log(`      ${l.labelEn.padEnd(42)} ${yen(l.amount).padStart(10)}`));

  console.log(`\n  ② ${r.payOnDelivery.labelEn}: ${r.payOnDelivery.quantified ? yen(r.payOnDelivery.total) : "not estimated"}`);
  r.payOnDelivery.lines.forEach((l) => console.log(`      ${l.labelEn.padEnd(42)} ${yen(l.amount).padStart(10)}`));
  if (!r.payOnDelivery.lines.length && r.taxTiming === "prepaid") {
    console.log(`      ${"Nothing — tax already collected up front".padEnd(42)} ${yen(0).padStart(10)}`);
  }
  r.payOnDelivery.notes.forEach((n) => console.log(`      note: ${n}`));

  console.log(`\n  ③ Final total: ${yen(r.grandTotal)}`);
  if (r.warnings.length) r.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
});

// ---- 全シナリオの順位 ----
console.log("\n\n" + "=".repeat(72));
console.log("RANKING ACROSS SCENARIOS (by final total)");
console.log("=".repeat(72));

const winners = {};
for (const { label, input } of scenarios) {
  const { results } = calculateAll({ ...input, buyeePlan: "light" }, { proxies, ems, importTax });
  console.log(`\n${label}`);
  results.forEach((r, i) => {
    const gap = i === 0 ? "" : ` (+${yen(r.grandTotal - results[0].grandTotal)})`;
    const tax = r.taxTiming === "prepaid" ? " [tax prepaid]" : r.taxTiming === "on-delivery" ? " [tax on delivery]" : "";
    console.log(`  ${i === 0 ? "🏆" : "  "} ${i + 1}. ${r.name.padEnd(12)} ${yen(r.grandTotal).padStart(10)}${gap}${tax}`);
  });
  winners[label] = results[0].name;
}

const counts = {};
Object.values(winners).forEach((w) => { counts[w] = (counts[w] ?? 0) + 1; });
console.log("\n最安の分布:");
Object.entries(counts).forEach(([n, c]) => console.log(`  ${n}: ${c}`));
console.log(Object.keys(counts).length >= 2
  ? `\n✅ ${Object.keys(counts).length}社が条件次第で最安になる`
  : `\n⚠ 1社が全シナリオで最安。比較ツールとしての価値を再検討すること`);
