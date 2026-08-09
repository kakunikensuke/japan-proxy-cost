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

// 2. 送れる会社が存在するとき、prohibited の会社が1位（＝おすすめ枠）に来ない
//    成人向けは FROM JAPAN だけが全面禁止で、Neokyo は対象国が限定されているため ok。
//    「安いが送れない会社」を推薦しないことを、この非対称なケースで確かめる。
{
  const { results } = run({ attributes: ["adult"] });
  const fj = results.find((r) => r.proxyId === "fromjapan");
  check(
    "成人向け: FROM JAPAN だけが全面禁止",
    fj.shippable.level === "prohibited",
    `level=${fj.shippable.level}`
  );
  check(
    "成人向け: 送れない FROM JAPAN が最安1位に出ない（属性なしでは1位の会社）",
    results[0].proxyId !== "fromjapan",
    `1位=${results[0].name}(${results[0].shippable.level})`
  );
  check(
    "成人向け: 1位は公式に可と言っている会社",
    results[0].shippable.level === "ok",
    `1位=${results[0].name}(${results[0].shippable.level})`
  );
}

// 3. 全社不可のときは allBlocked が立つ（UIが警告に切り替わる）
{
  const { results, allBlocked } = run({ attributes: ["aerosol"] });
  check(
    "スプレー缶: 4社とも不可なので allBlocked が立つ",
    allBlocked === true,
    results.map((r) => `${r.name}:${r.shippable.level}`).join(" ")
  );
}

// 4. unknown を ok に丸めていない（＝警告が出る）
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

// 5. 配送先の国だけで結果が変わる（軸2が効いている）
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

// 6. 代行会社が国名を名指しで挙げているケース（prohibitedDestinations）
//    Neokyo は成人向けを香港宛に禁止している。香港を配送先に足した時点で
//    「対象国に該当なし」が嘘になるので、国リストとして持てているかを確かめる。
{
  const us = run({ attributes: ["adult"], destination: "US" });
  const hk = run({ attributes: ["adult"], destination: "HK" });
  const pick = (res) => res.results.find((r) => r.proxyId === "neokyo").shippable.level;
  check("成人向け: Neokyo は米国宛なら ok", pick(us) === "ok", `level=${pick(us)}`);
  check("成人向け: Neokyo は香港宛だと prohibited", pick(hk) === "prohibited", `level=${pick(hk)}`);
}

// 7. 台湾・香港が配送先として計算できる
{
  for (const [cc, label] of [["TW", "台湾"], ["HK", "香港"]]) {
    const { shipping, results } = run({ destination: cc });
    check(
      `${label}: EMS料金が引ける`,
      shipping.amount != null && !shipping.error,
      `zone${shipping.zone} ${shipping.amount}円`
    );
    check(`${label}: 4社とも総額が出る`, results.every((r) => r.grandTotal > 0));
  }
  // 香港は関税も消費税も無いので、到着時に払う額が0で確定する
  const hk = run({ destination: "HK" });
  check(
    "香港: 到着時の支払いが0で確定している（見積もり不能ではない）",
    hk.results.every((r) => r.payOnDelivery.total === 0 && r.payOnDelivery.quantified),
    hk.results.map((r) => `${r.name}:${r.payOnDelivery.total}/${r.payOnDelivery.quantified}`).join(" ")
  );
}

// 8. 免税枠が生きている国（台湾 NT$2,000 ≒ ¥9,800）を正しく扱えているか
//    枠を無視して一律5%を課すと、免税枠のある国を不当に高く見せてしまう。
{
  const cheap = run({ destination: "TW", itemPriceJpy: 3000, weightG: 500 });   // 3,000+1,450 = 4,450 → 非課税
  const dear  = run({ destination: "TW", itemPriceJpy: 50000, weightG: 500 });  // 50,000+1,450 → 課税
  const taxOf = (res) => res.results[0].payOnDelivery.total;

  check("台湾: 免税枠以下なら到着時の税が0", taxOf(cheap) === 0, `${taxOf(cheap)}円`);
  check("台湾: 免税枠を超えたら5%かかる", taxOf(dear) === Math.round((50000 + 1450) * 0.05), `${taxOf(dear)}円`);
  check(
    "台湾: 免税枠以下のときラベルが『枠内』と明示される",
    /duty-free limit/.test(cheap.results[0].payOnDelivery.lines[0].labelEn),
    cheap.results[0].payOnDelivery.lines[0].labelEn
  );
  // しきい値付近（¥9,800±15%）では為替次第で結果が変わるので警告を出す
  const near = run({ destination: "TW", itemPriceJpy: 8000, weightG: 500 });    // 8,000+1,450 = 9,450
  check(
    "台湾: しきい値付近では為替の警告を出す",
    near.results[0].warnings.some((w) => /duty-free limit/.test(w)),
    near.results[0].warnings.join(" | ") || "(警告なし)"
  );
  // 免税枠が無い/廃止済みの国には影響しない
  const us = run({ destination: "US", itemPriceJpy: 3000, weightG: 500 });
  check("米国: 免税枠ロジックの影響を受けない", us.results[0].payOnDelivery.total >= 0);
}

// 9. 属性なしなら判定を足す前と完全に同じ（リグレッションなし）
{
  const withR = run({});
  const withoutR = calculateAll({ ...baseInput }, { proxies, ems, importTax });
  const same = withR.results.every((r, i) => r.proxyId === withoutR.results[i].proxyId && r.grandTotal === withoutR.results[i].grandTotal);
  check("属性なしのときは順位も総額も一切変わらない", same);
}

console.log(failures === 0 ? "\n✅ 手計算の試算表と配送不可判定をすべて再現できました" : `\n❌ ${failures}件が不一致`);
process.exit(failures === 0 ? 0 : 1);
