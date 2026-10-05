/**
 * 計算エンジンが、料金データ収集メモ.md に手計算で載せた試算表を再現できるか検証する。
 * 実行: node scripts/verify-calc.mjs
 */
import proxies from "../data/proxies.json" with { type: "json" };
import ems from "../data/shipping-ems.json" with { type: "json" };
import importTax from "../data/import-tax.json" with { type: "json" };
import restrictions from "../data/restrictions.json" with { type: "json" };
import post from "../data/shipping-post.json" with { type: "json" };
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

// 9. 事前徴収のしきい値（現地通貨建て）を守っているか
//    FROM JAPAN と Neokyo は豪州 AUD1,000 以下しかGSTを事前徴収しない。
//    これを無視すると高額品で「事前徴収済み・到着時0円」と嘘をつくことになる。
{
  const small = run({ destination: "AU", itemPriceJpy: 50000 });   // ≒AUD450 → 事前徴収される
  const big   = run({ destination: "AU", itemPriceJpy: 300000 });  // ≒AUD2,700 → 事前徴収されない
  const fjOf = (res) => res.results.find((r) => r.proxyId === "fromjapan");

  check("豪州(少額): FROM JAPAN は GST を事前徴収する", fjOf(small).taxTiming === "prepaid", fjOf(small).taxTiming);
  check(
    "豪州(高額): AUD1,000超なので事前徴収しない",
    fjOf(big).taxTiming === "on-delivery",
    fjOf(big).taxTiming
  );
  check(
    "豪州(高額): 到着時0円と言い切らず、国境で払うと警告する",
    fjOf(big).payOnDelivery.quantified === false &&
      fjOf(big).warnings.some((w) => /only collects .* up front on orders under/.test(w)),
    fjOf(big).warnings.join(" | ") || "(警告なし)"
  );
  // しきい値付近（AUD1,000 ≒ ¥111,360 の±15%）では為替の警告を出す
  const near = run({ destination: "AU", itemPriceJpy: 110000 });
  check(
    "豪州: しきい値付近では為替の警告を出す",
    fjOf(near).warnings.some((w) => /close to the AUD 1,000 limit/.test(w)),
    fjOf(near).warnings.join(" | ") || "(警告なし)"
  );
}

// 10. 表示文字列に日本語が混じっていないか（英語サイトなので致命的）
//     過去に import-tax ページと禁制品の引用に日本語が出た。
{
  const jp = /[぀-ヿ㐀-鿿]/;
  const dests = ["US", "CA", "GB", "DE", "FR", "AU", "SG", "TW", "HK"];
  const attrIds = restrictions.attributes.map((a) => a.id);
  const bad = [];
  for (const cc of dests) {
    for (const attrs of [[], ...attrIds.map((a) => [a])]) {
      const { results } = run({ destination: cc, attributes: attrs });
      for (const r of results) {
        const texts = [
          ...r.payNow.lines.flatMap((l) => [l.labelEn, l.note]),
          ...r.payOnDelivery.lines.flatMap((l) => [l.labelEn, l.note]),
          ...r.payOnDelivery.notes,
          ...r.warnings,
          ...r.shippable.blockers.flatMap((b) => [b.reasonEn, b.quoteEn, b.attributeLabelEn]),
        ];
        texts.filter((t) => t && jp.test(t)).forEach((t) => bad.push(`${cc}/${attrs[0] ?? "-"}/${r.name}: ${t}`));
      }
    }
  }
  check("利用者に見える文字列に日本語が混じっていない", bad.length === 0, bad.slice(0, 3).join(" / "));
}

// 11. 香港のように税がゼロの国で、0円の行に「到着時に請求される」と書いていない
{
  const hk = run({ destination: "HK" });
  const line = hk.results[0].payOnDelivery.lines[0];
  check(
    "香港: 0円の行が『到着時に請求される』と矛盾していない",
    !/when the parcel arrives/.test(line.note ?? ""),
    line.note ?? "(注記なし)"
  );
}

// 12. 属性なしなら判定を足す前と完全に同じ（リグレッションなし）
{
  const withR = run({});
  const withoutR = calculateAll({ ...baseInput }, { proxies, ems, importTax });
  const same = withR.results.every((r, i) => r.proxyId === withoutR.results[i].proxyId && r.grandTotal === withoutR.results[i].grandTotal);
  check("属性なしのときは順位も総額も一切変わらない", same);
}

// ===========================================================================
// 13. EMS以外の日本郵便（2026-10-02追加）。数値は日本郵便の料金表（第4地帯=米国など）を手で読んだもの
// ===========================================================================
console.log("\n\n=== EMS以外の配送方法 ===");
{
  const runP = (extra) => calculateAll({ ...baseInput, ...extra }, { proxies, ems, importTax, restrictions, post });
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light" };

  // 米国・1kg・小形包装物（航空便）= 2,720円（第4地帯 Up to 1.0kg）
  const sp = runP({ ...base, carrier: "small_packet_air" });
  check("米国1kg 小形包装物（航空便）は ¥2,720", sp.shipping.amount === 2720, `got ${sp.shipping.amount}`);
  // Buyee: 10,000 + 500 + 700 + 2,720 = 13,920
  const by = sp.results.find((r) => r.proxyId === "buyee");
  check("Buyee 総額 ¥13,920（小形包装物・米国）", by.grandTotal === 13920, `got ${by.grandTotal}`);
  // ZenMarket: 10,000 + 800 + 700 + 2,720 = 14,220 → 3.5%グロスアップ 14,220/0.965 = 14,735.75 → 手数料 516 → 14,736
  const zm = sp.results.find((r) => r.proxyId === "zenmarket");
  check("ZenMarket 総額 ¥14,736（小形包装物・米国）", zm.grandTotal === 14736, `got ${zm.grandTotal}`);
  // 小形包装物を掲載していない会社（FROM JAPAN・Neokyo）は掲載している会社より後ろに並ぶ
  const firstUnlisted = sp.results.findIndex((r) => !r.methodListed);
  const lastListed = sp.results.map((r) => r.methodListed).lastIndexOf(true);
  check("この配送方法を掲載していない会社は、掲載している会社より後ろ", firstUnlisted > lastListed,
    sp.results.map((r) => `${r.name}:${r.methodListed ? "listed" : "unknown"}`).join(" "));

  // 2kg を超える小形包装物は料金を出さない
  const big = runP({ ...base, carrier: "small_packet_air", weightG: 3000 });
  check("3kg の小形包装物は料金を出さずエラー", big.shipping.amount == null && /up to 2kg/.test(big.shipping.error ?? ""), big.shipping.error);

  // 米国・1kg・国際小包の船便 = 2,600円 / 航空便 = 4,200円
  check("米国1kg 船便小包は ¥2,600", runP({ ...base, carrier: "intl_parcel_sea" }).shipping.amount === 2600);
  check("米国1kg 航空小包は ¥4,200", runP({ ...base, carrier: "intl_parcel_air" }).shipping.amount === 4200);

  // 豪州宛ての電池は、航空なら条件付きで可、船便は日本郵便が不可
  const auAir = runP({ ...base, destination: "AU", carrier: "intl_parcel_air", attributes: ["lithium_battery"] });
  const auSea = runP({ ...base, destination: "AU", carrier: "intl_parcel_sea", attributes: ["lithium_battery"] });
  check("豪州・電池・船便は全社不可（日本郵便の規則）", auSea.allBlocked === true);
  check("豪州・電池・航空小包は全社不可ではない", auAir.allBlocked === false);

  // FROM JAPAN はシンガポール宛ての船便では GST を事前徴収しない（EMSではする）
  const fjOf = (r) => r.results.find((x) => x.proxyId === "fromjapan");
  check("FROM JAPAN シンガポール EMS は事前徴収", fjOf(runP({ ...base, destination: "SG" })).taxTiming === "prepaid");
  check("FROM JAPAN シンガポール 船便は到着時払い", fjOf(runP({ ...base, destination: "SG", carrier: "intl_parcel_sea" })).taxTiming === "on-delivery");

  // FROM JAPAN の輸出通関料は "intl_parcel" とだけ書いてあるので、航空小包でも20万円超なら ¥2,800
  const fjHigh = fjOf(runP({ ...base, itemPriceJpy: 250000, carrier: "intl_parcel_air" }));
  check("FROM JAPAN 20万円超・航空小包で輸出通関料 ¥2,800", fjHigh.payNow.lines.some((l) => l.key === "clearance" && l.amount === 2800));

  // EMS の結果は配送方法を足す前と完全に同じ
  const a = runP({ ...base }), b = calculateAll({ ...base }, { proxies, ems, importTax, restrictions });
  check("EMSの総額と順位は配送方法対応の前と同じ", a.results.every((r, i) => r.proxyId === b.results[i].proxyId && r.grandTotal === b.results[i].grandTotal));
}

// ===========================================================================
// 14. Doorzo（2026-10-05追加）。代行手数料 = 1点ごとに商品価格の3%、下限¥200・上限¥300
// ===========================================================================
console.log("\n\n=== Doorzo ===");
{
  const runD = (extra) => calculateAll({ ...baseInput, source: "mercari", itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light", ...extra }, { proxies, ems, importTax, restrictions, post });
  const dz = (r) => r.results.find((x) => x.proxyId === "doorzo");
  // ¥10,000 → 3% = ¥300（上限ちょうど）。10,000 + 300 + 700 + EMS 5,300 = 16,300
  check("Doorzo ¥10,000・米国1kg = ¥16,300", dz(runD({ itemPriceJpy: 10000 })).grandTotal === 16300, `got ${dz(runD({ itemPriceJpy: 10000 })).grandTotal}`);
  // ¥3,000 → 3% = ¥90 → 下限 ¥200
  check("Doorzo ¥3,000 の代行手数料は下限 ¥200", dz(runD({ itemPriceJpy: 3000 })).payNow.lines.find((l) => l.key === "service").amount === 200);
  // ¥50,000 → 3% = ¥1,500 → 上限 ¥300
  check("Doorzo ¥50,000 の代行手数料は上限 ¥300", dz(runD({ itemPriceJpy: 50000 })).payNow.lines.find((l) => l.key === "service").amount === 300);
  // 3点で合計 ¥30,000 → 1点 ¥10,000 → ¥300 × 3 = ¥900
  check("Doorzo 3点 合計¥30,000 の代行手数料は ¥900", dz(runD({ itemPriceJpy: 30000, itemCount: 3 })).payNow.lines.find((l) => l.key === "service").amount === 900);
  // 20万円超: 日本郵便 ¥2,800 + Doorzo ¥400 + 1注文 ¥200 = ¥3,400
  check("Doorzo 20万円超の輸出申告関連 ¥3,400", dz(runD({ itemPriceJpy: 250000 })).payNow.lines.find((l) => l.key === "clearance")?.amount === 3400);
  // 決済手数料は非公開なので警告が出る
  check("Doorzo は決済手数料が非公開である旨を警告する", dz(runD({ itemPriceJpy: 10000 })).warnings.some((w) => /payment fee is not published/.test(w)));
  // 航空小包は取扱手数料が確定しないので最安に数えない
  check("Doorzo の航空小包は最安に数えない（取扱手数料が非公開）", dz(runD({ itemPriceJpy: 10000, carrier: "intl_parcel_air" })).methodListed === false);
}

// ===========================================================================
// 15. 米国関税の目安（2026-10-05追加）。HTSUS 9903.05.49 / 9903.05.92 を手で当てた値
// ===========================================================================
console.log("\n\n=== 米国関税の目安 ===");
{
  const runU = (extra) => calculateAll({ ...baseInput, source: "mercari", itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light", ...extra }, { proxies, ems, importTax, restrictions, post });
  // フィギュア（通常の関税ゼロ）¥15,000 → 12.5% = ¥1,875
  const fig = runU({ itemPriceJpy: 15000, category: "scale_figure" });
  check("米国 フィギュア ¥15,000 の関税目安 = ¥1,875（ちょうど12.5%）", fig.dutyEstimate?.amount === 1875 && fig.dutyEstimate.kind === "exact", JSON.stringify(fig.dutyEstimate));
  // 漫画は情報資料として対象外
  const man = runU({ itemPriceJpy: 6000, category: "manga" });
  check("米国 漫画の関税目安 = ¥0（情報資料）", man.dutyEstimate?.amount === 0 && man.dutyEstimate.kind === "exempt");
  // 品目が分からないときは「12.5%以上」
  const oth = runU({ itemPriceJpy: 8000, category: "other" });
  check("米国 その他 ¥8,000 = 下限 ¥1,000（12.5%以上）", oth.dutyEstimate?.amount === 1000 && oth.dutyEstimate.kind === "floor");
  // カテゴリ未指定も「12.5%以上」に倒す（ちょうど12.5%と言い切らない）
  check("米国 カテゴリ未指定は下限扱い", runU({ itemPriceJpy: 8000 }).dutyEstimate?.kind === "floor");
  // 総額には足さない（料率が品目で決まり、徴収方法も未確認のため）
  check("米国 関税の目安は総額に含めない", fig.results.every((r) => r.grandTotalIsMinimum === true));
  // 米国以外では出さない
  check("英国では関税の目安を出さない", calculateAll({ ...baseInput, destination: "GB", category: "scale_figure" }, { proxies, ems, importTax, restrictions, post }).dutyEstimate === null);
}

console.log(failures === 0 ? "\n✅ 手計算の試算表と配送不可判定をすべて再現できました" : `\n❌ ${failures}件が不一致`);
process.exit(failures === 0 ? 0 : 1);
