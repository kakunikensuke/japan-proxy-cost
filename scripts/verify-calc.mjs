/**
 * 計算エンジンが、料金データ収集メモ.md に手計算で載せた試算表を再現できるか検証する。
 * 実行: node scripts/verify-calc.mjs
 */
import proxies from "../data/proxies.json" with { type: "json" };
import ems from "../data/shipping-ems.json" with { type: "json" };
import importTax from "../data/import-tax.json" with { type: "json" };
import restrictions from "../data/restrictions.json" with { type: "json" };
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
  // attributes を渡さない = 属性なしの商品（トレカ等）。
  // 配送不可判定を足しても既存の期待値が1円も変わらないことをここで担保する。
  const { shipping, results } = calculateAll(
    { ...baseInput, buyeePlan: plan },
    { proxies, ems, importTax, restrictions }
  );

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

// ---------------------------------------------------------------------------
// 配送不可判定の回帰テスト
//
// 料金と同じく、判定ロジックにも回帰テストを持たせる。
// とくに「送れない会社が最安として1位に出ない」ことは、
// 元のバグ（送れない商品に見積もりを出す）より悪い状態を防ぐための生命線。
// ---------------------------------------------------------------------------
console.log("\n\n=== 配送不可判定 ===");

const check = (label, ok, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const run = (extra) =>
  calculateAll({ ...baseInput, ...extra }, { proxies, ems, importTax, restrictions });

// 1. 引火性液体 × Buyee × 米国 → prohibited
{
  const { results } = run({ attributes: ["flammable_liquid"] });
  const buyee = results.find((r) => r.proxyId === "buyee");
  check(
    "模型用塗料は Buyee で prohibited になる",
    buyee.shippable.level === "prohibited",
    `level=${buyee.shippable.level}`
  );
}

// 2. prohibited の会社が1位（＝おすすめ枠）に来ない
{
  const { results, allBlocked, noneConfirmed } = run({ attributes: ["aerosol"] });
  check(
    "スプレー缶: 送れない会社が最安1位に出ない",
    results[0].shippable.level !== "prohibited" || allBlocked,
    `1位=${results[0].name}(${results[0].shippable.level})`
  );
  // FROM JAPAN は禁制品データが未取得（unknown）なので allBlocked にはならない。
  // 「1社も ok が無い」= noneConfirmed で、UIはこの場合も警告を出す。
  check(
    "スプレー缶: 公式に可と言っている会社が1社も無い",
    noneConfirmed === true,
    results.map((r) => `${r.name}:${r.shippable.level}`).join(" ")
  );
  check(
    "スプレー缶: 記載のある3社は prohibited",
    results.filter((r) => r.proxyId !== "fromjapan").every((r) => r.shippable.level === "prohibited")
  );
  void allBlocked;
}

// 3. unknown を ok に丸めていない（＝警告が出る）
{
  const { results } = run({ attributes: ["food"] });
  const buyee = results.find((r) => r.proxyId === "buyee");
  check(
    "食品: Buyee は記載がないので unknown のまま",
    buyee.shippable.level === "unknown",
    `level=${buyee.shippable.level}`
  );
  check(
    "unknown の会社は警告を出している",
    buyee.warnings.some((w) => /does not publish a rule/.test(w))
  );
  // 記載のある Neokyo は ok に振れる（unknown を一律に付けていないことの確認）
  const neokyo = results.find((r) => r.proxyId === "neokyo");
  check(
    "食品: Neokyo は対象国が明記されているので ok",
    neokyo.shippable.level === "ok",
    `level=${neokyo.shippable.level}`
  );
}

// 4. 配送先の国だけで結果が変わる（軸2が効いている）
{
  const us = run({ attributes: ["lithium_battery"], destination: "US" });
  const de = run({ attributes: ["lithium_battery"], destination: "DE" });
  check(
    "リチウム電池: 米国向けは送れる会社がある",
    us.results.some((r) => r.shippable.level !== "prohibited"),
    us.results.map((r) => `${r.name}:${r.shippable.level}`).join(" ")
  );
  check(
    "リチウム電池: ドイツ向けは日本郵便が引き受けないため全社 prohibited",
    de.allBlocked === true,
    de.results.map((r) => `${r.name}:${r.shippable.level}`).join(" ")
  );
}

// 5. 属性なしなら判定を足す前と完全に同じ（リグレッションなし）
{
  const withR = run({});
  const withoutR = calculateAll({ ...baseInput }, { proxies, ems, importTax });
  const same = withR.results.every((r, i) => r.proxyId === withoutR.results[i].proxyId && r.grandTotal === withoutR.results[i].grandTotal);
  check("属性なしのときは順位も総額も一切変わらない", same);
}

console.log(failures === 0 ? "\n✅ 手計算の試算表と配送不可判定をすべて再現できました" : `\n❌ ${failures}件が不一致`);
process.exit(failures === 0 ? 0 : 1);
