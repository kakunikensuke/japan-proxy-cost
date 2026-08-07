/**
 * 計算エンジンが、料金データ収集メモ.md に手計算で載せた試算表を再現できるか検証する。
 * 実行: node scripts/verify-calc.mjs
 */
import proxies from "../data/proxies.json" with { type: "json" };
import ems from "../data/shipping-ems.json" with { type: "json" };
import importTax from "../data/import-tax.json" with { type: "json" };
import { calculateAll } from "../src/lib/calc.mjs";

const yen = (n) => "¥" + n.toLocaleString("ja-JP");

// メルカリでフィギュア1点 ¥8,000 / 梱包後1kg / 米国向けEMS / 国内送料は¥700と仮定
const baseInput = {
  source: "mercari",
  itemPriceJpy: 8000,
  itemCount: 1,
  weightG: 1000,
  destination: "US",
  domesticShippingJpy: 700,
  carrier: "ems",
};

// 2026-08-07 更新: ZenMarket の Deposit Fee を 1% → 3.5%(gross-up) に修正したため
// 当初の手計算値 ¥6,948 は誤り。公式FAQに基づく正しい値は ¥7,337。
//   基準額 8,000+800+700+5,300 = 14,800
//   手数料 14,800 × 3.5/(100-3.5) = 537
//   合計   800 + 700 + 5,300 + 537 = 7,337
const expected = {
  "fromjapan:light": 6500,
  "buyee:light": 6500,
  "neokyo:light": 6850,
  "zenmarket:light": 7337,
  "buyee:standard": 7000,
};

let failures = 0;

for (const plan of ["light", "standard"]) {
  const { shipping, results } = calculateAll({ ...baseInput, buyeePlan: plan }, { proxies, ems, importTax });

  console.log(`\n=== Buyeeプラン: ${plan} / EMS第${shipping.zone}地帯 ${yen(shipping.amount)}（${shipping.appliedWeightG}g帯適用） ===`);
  console.log("順位 サービス          手数料  プラン  梱包   国内   国際   決済   合計");

  results.forEach((r, i) => {
    const get = (k) => r.payNow.lines.find((l) => l.key === k)?.amount ?? 0;
    console.log(
      `${String(i + 1).padStart(2)}   ${r.name.padEnd(16)} ` +
      ["service", "plan", "packing", "domestic", "intl", "payment"]
        .map((k) => String(get(k)).padStart(5)).join("  ") +
      `  ${yen(r.proxyFeesOnly)}`
    );

    const key = `${r.proxyId}:${plan}`;
    if (expected[key] != null) {
      if (expected[key] === r.proxyFeesOnly) {
        console.log(`     ✅ 期待値 ${yen(expected[key])} と一致`);
      } else {
        console.log(`     ❌ 期待値 ${yen(expected[key])} / 実際 ${yen(r.proxyFeesOnly)}`);
        failures++;
      }
    }
  });

  const warned = results.filter((r) => r.warnings.length > 0);
  if (warned.length) {
    console.log("\n  [未確認データの警告]");
    warned.forEach((r) => r.warnings.forEach((w) => console.log(`   ⚠ ${w}`)));
  }
}

console.log(failures === 0 ? "\n✅ 手計算の試算表をすべて再現できました" : `\n❌ ${failures}件が不一致`);
process.exit(failures === 0 ? 0 : 1);
