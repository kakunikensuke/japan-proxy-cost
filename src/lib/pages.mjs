/**
 * SEO用の静的ページ定義。
 *
 * ■ 大原則
 * 機械生成の大量ページは、中身が実質同じだと Google の "scaled content abuse" に該当して
 * インデックスから外される。したがって **全ページに、そのページでしか出ない実計算値を載せる**。
 * テンプレートを言い換えただけのページは作らない。
 *
 * ■ 生成対象と件数（意図的に絞る。数千ページの無差別生成はしない）
 *   1. 代行A vs 代行B × 配送先        6組 × 9か国 = 54
 *   2. 仕入れ元 × 配送先で最安はどこか  7 × 9        = 63
 *   3. 重量 × 配送先の総額             7 × 9        = 63
 *   4. 各社の料金解説                                = 4
 *   5. 配送先ごとの輸入税ガイド                       = 9
 *   6. 属性 × 配送先「これは送れるのか」6属性 × 9か国 = 54（＋ハブ1）
 *   合計 248ページ（トップと404を足して250ファイル）
 *
 * 6 は金額より先に知る必要がある情報。送れない商品の見積もりを出すと、
 * 利用者は落札後に商品代・国内送料・キャンセル料だけ失う。
 */
import { calculateAll } from "./calc.mjs";
import {
  pairGrid, verdictBox, heatTable, driverText, gapBreakdown, marketplaceDuel, shipRulesDuel, taxTimingDuel, termsDuel,
  priceLadder, weightLadder, togetherOrApart, priceAtWeight, perServiceLines, taxLadder, thresholdsInYen,
  proxyAcrossCountries, proxyPriceCurve,
} from "./enrich.mjs";
import { buildGuides } from "./guides.mjs";
import { buildGenreGuides } from "./genres.mjs";
import { PHOTOS } from "./layout.mjs";
import { presetsAtWeight, sourcesAtWeight, refusalCost, taxAmongCountries } from "./enrich2.mjs";

/**
 * お問い合わせはサイト内のフォームで受ける。
 *
 * バックエンドを持たない方針なので、送信先は FormSubmit（登録不要の中継サービス）。
 * **メールアドレスそのものではなく、有効化後に発行されるランダムな別名を入れること。**
 * アドレスを直接書くとHTMLに個人のメールアドレスが載り、収集ボットに拾われる。
 *
 * 有効化の手順:
 *   1. 一度だけ https://formsubmit.co/kakuniadao7@gmail.com 宛に送信する
 *   2. 届いた確認メールのリンクを押す
 *   3. 表示されるランダム文字列の URL（https://formsubmit.co/xxxxxxxx）をここに入れる
 *
 * ★空のままだとビルドが落ちる（scripts/prerender.mjs の自己点検）。
 * 連絡手段の無いサイトはAdSenseの審査で落ちるので、未設定のまま本番へ出さない。
 */
export const CONTACT_FORM_ENDPOINT = "https://formsubmit.co/21c6f56659051072bab367d0af9fb0bc";

export const COUNTRY_SLUGS = {
  US: "united-states", CA: "canada", GB: "united-kingdom",
  AU: "australia", DE: "germany", FR: "france", SG: "singapore",
  TW: "taiwan", HK: "hong-kong",
};

export const SOURCE_LABELS = {
  yahoo_auction: { label: "Yahoo! Auctions", slug: "yahoo-auctions" },
  mercari: { label: "Mercari Japan", slug: "mercari" },
  rakuma: { label: "Rakuten Rakuma", slug: "rakuma" },
  amazon_jp: { label: "Amazon.co.jp", slug: "amazon-japan" },
  rakuten: { label: "Rakuten Ichiba", slug: "rakuten" },
  recommended: { label: "a ZenMarket recommended store", slug: "recommended-stores" },
  other_shop: { label: "any Japanese online shop", slug: "japanese-shops" },
};

// EMS は重量帯で課金される（500 / 1000 / 1500 / 2000 / 3000 / 5000g）。
// 以前は7商品 × 9か国 = 63本を出していたが、trading cards(60g)・manga(200g)・
// prize figure(400g) は3本とも同じ500g帯に落ちるため EMS 料金も総額も完全に同一で、
// model kit(800g) と scale figure(1000g) も同じ1000g帯だった。実質4帯しかない。
// 帯ごとに1本にし、同じ帯に入る商品は本文で列挙して検索語を拾う。
export const WEIGHTS = [
  { g: 200, label: "a manga volume", slug: "manga", band: 500, alsoCovers: ["trading cards", "a doujinshi", "a prize figure", "a CD"] },
  { g: 1000, label: "a boxed scale figure", slug: "scale-figure", band: 1000, alsoCovers: ["a model kit", "a boxed game console accessory"] },
  { g: 2000, label: "a 2kg parcel", slug: "2kg", band: 2000, alsoCovers: ["two boxed figures packed together"] },
  { g: 3000, label: "a 3kg parcel", slug: "3kg", band: 3000, alsoCovers: ["a large model kit", "a multi-item haul"] },
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");

function countryName(importTax, code) {
  return importTax.countries[code]?.name ?? code;
}

// ---------------------------------------------------------------------------
// ページ固有の解説を組み立てる部品
//
// AdSense に「有用性の低いコンテンツ」で落とされた。原因は本文が平均155語しかなく、
// しかもその多くが全ページ共通の定型文だったこと。
// 文字数を埋めるだけの水増しは同じ判定を招くので、**そのページの計算結果からしか
// 導けないこと**を書く。下の関数はどれも実数を受け取って文章を作る。
// ---------------------------------------------------------------------------

const LINE_LABELS = {
  service: "service fee",
  plan: "protection plan",
  packing: "packing charge",
  domestic: "domestic postage",
  intl: "international postage",
  clearance: "export clearance fee",
  payment: "deposit / payment fee",
  tax: "tax collected up front",
};

const lineOf = (r, k) => r.payNow.lines.find((l) => l.key === k)?.amount ?? 0;

const INCLUDE_LABELS = {
  storage60d: "60 days of free storage",
  consolidation: "consolidation of several purchases into one parcel",
  inspection: "an inspection of the item on arrival",
  international_insurance: "insurance on the international leg",
  domestic_trade_guarantee: "a guarantee on the domestic purchase",
};

/** 2社の差額がどの費目から出ているかを実数で説明する。ページごとに必ず違う文になる。 */
function gapExplanation(win, lose) {
  const diffs = Object.keys(LINE_LABELS)
    .map((k) => ({ k, d: lineOf(lose, k) - lineOf(win, k) }))
    .filter((x) => x.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  if (!diffs.length) {
    return `<p>The two come out level on this order: every line — service fee, packing, postage and tax —
    lands on the same figure. Where they differ is in what you get for it, which is covered below.</p>`;
  }

  const top = diffs[0];
  const sameService = lineOf(win, "service") === lineOf(lose, "service");
  const parts = diffs.slice(0, 3).map((x) =>
    `${esc(x.d > 0 ? lose.name : win.name)} pays ${yen(Math.abs(x.d))} more in ${LINE_LABELS[x.k]}`);

  return `<p>${sameService
    ? `The gap is not the service fee — both charge ${yen(lineOf(win, "service"))} for this marketplace.`
    : `Part of it is the service fee: ${esc(win.name)} charges ${yen(lineOf(win, "service"))} against ${esc(lose.name)}'s ${yen(lineOf(lose, "service"))}.`}
  The largest single difference on this order is the ${LINE_LABELS[top.k]}, worth ${yen(Math.abs(top.d))}.
  Line by line: ${parts.join("; ")}.</p>`;
}

/** 条件を変えたら結論が変わるかを実際に計算して書く。「場合による」で終わらせない。 */
function flipCheck(baseInput, data, ids) {
  const pick = (input) => {
    const { results } = calculateAll(input, data);
    const only = results.filter((r) => ids.includes(r.proxyId));
    return only.sort((a, b) => a.grandTotal - b.grandTotal)[0];
  };
  const base = pick(baseInput);
  const variants = [
    { label: "the parcel is 3kg rather than 1kg", input: { ...baseInput, weightG: 3000 } },
    { label: "you buy three separate items instead of one", input: { ...baseInput, itemCount: 3 } },
    { label: "the item costs ¥50,000 rather than ¥10,000", input: { ...baseInput, itemPriceJpy: 50000 } },
  ];

  const flipped = variants.map((v) => ({ ...v, win: pick(v.input) })).filter((v) => v.win.proxyId !== base.proxyId);

  if (!flipped.length) {
    return `<p>The answer is stable for this pair: ${esc(base.name)} stays ahead if the parcel is three times
    heavier, if you buy three items instead of one, or if the item costs five times as much. That is not true
    of every pairing on this site, which is why each combination is calculated separately rather than assumed.</p>`;
  }

  const f = flipped[0];
  return `<p><strong>This flips.</strong> If ${f.label}, ${esc(f.win.name)} becomes the cheaper of the two at
  ${yen(f.win.grandTotal)}. The companies charge on different units — per item, per order, by weight, or as a
  percentage of the whole transaction — so a result for one basket does not carry over to another. Change the
  figures in the calculator above and the ranking recalculates.</p>`;
}

/** EMSの重量帯の位置関係を書く。あと何gで1段上がるか、1段下げるといくら浮くか。 */
function weightBandNote(ems, cc, weightG, shipping) {
  const zone = String(shipping.zone);
  const bands = ems.rates.filter((r) => r[zone] != null).sort((a, b) => a.weightG - b.weightG);
  const idx = bands.findIndex((b) => b.weightG === shipping.appliedWeightG);
  if (idx < 0) return "";

  const cur = bands[idx];
  const next = bands[idx + 1];
  const prev = bands[idx - 1];
  const headroom = cur.weightG - weightG;

  const bits = [];
  bits.push(`At ${weightG}g you are billed at the ${cur.weightG}g band, so you are paying for
  ${headroom > 0 ? `${headroom}g you are not using` : "exactly the weight you have"}.`);
  if (next) {
    bits.push(`Going over ${cur.weightG}g moves you to the ${next.weightG}g band and adds
    ${yen(next[zone] - cur[zone])} — a single extra ${headroom > 0 ? "item" : "gram"} can cost that much.`);
  }
  if (prev && headroom > 0) {
    bits.push(`Dropping under ${prev.weightG}g would save ${yen(cur[zone] - prev[zone])}, which is worth
    knowing if you are close to the line and can leave something out of the box.`);
  }
  return `<h2>Where this sits in the EMS weight bands</h2><p>${bits.join(" ")}</p>
  <p>This is why consolidating matters in one direction and hurts in the other: putting four small purchases
  in one box usually keeps you inside a single band and saves three lots of postage, but pushing one gram over
  a boundary costs the full step.</p>`;
}

/** 課金単位の違いを、点数を変えた実計算で示す。 */
function unitOfChargeNote(baseInput, data, sourceLabel) {
  const one = calculateAll(baseInput, data);
  const three = calculateAll({ ...baseInput, itemCount: 3 }, data);
  const threeSame = calculateAll({ ...baseInput, itemCount: 3, sameShop: true }, data);

  const rows = one.results.map((r) => {
    const t3 = three.results.find((x) => x.proxyId === r.proxyId);
    const t3s = threeSame.results.find((x) => x.proxyId === r.proxyId);
    const perOrder = t3s.payNow.total !== t3.payNow.total;
    return `<tr><td>${esc(r.name)}</td><td>${yen(lineOf(r, "service"))}</td><td>${yen(lineOf(t3, "service"))}</td><td>${perOrder ? yen(lineOf(t3s, "service")) : "same"}</td></tr>`;
  }).join("");

  const bestOne = one.results[0];
  const bestThree = three.results[0];

  return `<h2>What happens when you buy more than one thing</h2>
  <p>Service fees are not charged on the same unit, so the ranking above is only the answer for a single item.
  Here is the same ${esc(sourceLabel)} order at one item, at three separate items, and at three items bought
  from the same shop:</p>
  <table>
    <thead><tr><th>Service</th><th>1 item</th><th>3 items</th><th>3 from one shop</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p>${bestOne.proxyId === bestThree.proxyId
    ? `${esc(bestOne.name)} stays cheapest at three items (${yen(bestThree.grandTotal)} in total).`
    : `<strong>The cheapest option changes at three items:</strong> ${esc(bestThree.name)} takes over at ${yen(bestThree.grandTotal)}, against ${esc(bestOne.name)}'s ${yen(three.results.find((r) => r.proxyId === bestOne.proxyId).grandTotal)}.`}
  Buying several things at once also shares one parcel and one lot of postage between them, which usually
  matters more than the service fee does.</p>`;
}

/**
 * その代行会社が「どういう買い方のときに一番安いか」を実際に計算して書く。
 * 各社ページで結論が変わるので、ページ固有性が保てる。
 */
function whenThisWins(proxy, data) {
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light" };
  const cases = [
    { label: "one ¥10,000 item, 1kg, to the United States", input: base },
    { label: "three separate items from one shop", input: { ...base, source: "amazon_jp", itemCount: 3, sameShop: true } },
    { label: "a heavy 3kg parcel", input: { ...base, weightG: 3000 } },
    { label: "an expensive ¥100,000 item", input: { ...base, itemPriceJpy: 100000 } },
    { label: "a light 200g order to Taiwan", input: { ...base, weightG: 200, destination: "TW" } },
  ];

  const rows = cases.map((c) => {
    const { results } = calculateAll(c.input, data);
    const rank = results.findIndex((r) => r.proxyId === proxy.id) + 1;
    const mine = results.find((r) => r.proxyId === proxy.id);
    return { ...c, rank, total: mine.grandTotal, winner: results[0], mine };
  });

  const wins = rows.filter((r) => r.rank === 1);
  const name = esc(proxy.shortName ?? proxy.name);

  const table = rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.rank === 1 ? "<strong>1st</strong>" : `${r.rank}${["", "st", "nd", "rd", "th"][Math.min(r.rank, 4)]}`}</td><td>${yen(r.total)}</td><td>${r.rank === 1 ? "&mdash;" : esc(r.winner.name) + " " + yen(r.winner.grandTotal)}</td></tr>`).join("");

  return `<h2>When ${name} is actually the cheapest</h2>
  <p>Fee tables do not answer that on their own, so here is the same set of orders priced through all four
  services, showing where ${name} lands:</p>
  <table>
    <thead><tr><th>Order</th><th>${name}</th><th>Total</th><th>Beaten by</th></tr></thead>
    <tbody>${table}</tbody>
  </table>
  <p>${wins.length === 0
    ? `${name} does not come out cheapest on any of these five, which does not make it a bad choice — what it bundles in for the money is covered above — but if price is the only thing you care about, the comparison pages below will show you which service to use instead.`
    : wins.length === cases.length
      ? `${name} is cheapest on all five. That is unusual, and worth checking against your own order rather than assumed.`
      : `${name} wins ${wins.length} of the five: ${wins.map((w) => esc(w.label)).join("; ")}. It loses the others, which is the whole reason this site calculates rather than recommends a single service.`}</p>`;
}

/** 輸入税ページ用の実例計算。制度の説明だけでなく金額を出す。 */
function taxWorkedExample(cc, data, cn) {
  const runs = [10000, 50000].map((price) => ({
    price,
    r: calculateAll({ source: "mercari", itemPriceJpy: price, itemCount: 1, weightG: 1000, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" }, data),
  }));

  const rows = runs.map(({ price, r }) => {
    const best = r.results[0];
    return `<tr><td>${yen(price)}</td><td>${yen(best.payNow.total)}</td><td>${best.payOnDelivery.quantified ? yen(best.payOnDelivery.total) : "not estimable"}</td><td><strong>${yen(best.grandTotal)}</strong>${best.grandTotalIsMinimum ? " +duty" : ""}</td><td>${esc(best.name)}</td></tr>`;
  }).join("");

  const notes = [...new Set(runs.flatMap(({ r }) => r.results[0].payOnDelivery.notes))];

  return `<h2>What that means in money</h2>
  <p>Two orders to ${esc(cn)} — both from Mercari Japan, both about 1&nbsp;kg packed, both with ¥700 of
  domestic postage inside Japan — priced through the cheapest service available for each:</p>
  <table>
    <thead><tr><th>Item price</th><th>Pay the proxy</th><th>Pay on arrival</th><th>Total</th><th>Cheapest via</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${notes.map((n) => `<p>${esc(n)}</p>`).join("")}`;
}

/** 比較表。ページ固有の実数値が必ずここに入る。 */
function resultsTable(results, { showTiming = true } = {}) {
  const rows = results.map((r, i) => `
      <tr${i === 0 ? ' class="best"' : ""}>
        <td>${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td>${yen(r.payNow.total)}</td>
        <td>${r.payOnDelivery.quantified ? yen(r.payOnDelivery.total) : "not estimated"}</td>
        <td><strong>${yen(r.grandTotal)}</strong>${r.grandTotalIsMinimum ? " +duty" : ""}</td>
        ${showTiming ? `<td>${r.taxTiming === "prepaid" ? "Prepaid" : "On delivery"}</td>` : ""}
      </tr>`).join("");

  return `<table>
    <thead><tr>
      <th>#</th><th>Service</th><th>Pay the proxy</th><th>Pay on delivery</th><th>Total</th>${showTiming ? "<th>Tax</th>" : ""}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function countryNotice(country) {
  if (!country?.displayEn) return "";
  return `<aside class="notice"><strong>${esc(country.displayEn.headline)}</strong><p>${esc(country.displayEn.body)}</p></aside>`;
}

function links(items) {
  return `<nav class="related"><h2>Related</h2><ul>${
    items.map((i) => `<li><a href="${i.href}">${esc(i.text)}</a></li>`).join("")
  }</ul></nav>`;
}

export function buildPages(data) {
  const { proxies, importTax, ems } = data;
  const pages = [];
  const ids = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name }));
  const countries = Object.keys(COUNTRY_SLUGS);

  // 比較ページのURLは「proxies.json の並び順で先に出てくる方が左」で生成される。
  // ここをアルファベット順で組み立てると存在しないURLを指してしまう（実際に404を2本作った）。
  const order = ids.map((p) => p.id);
  const versusPath = (x, y, cc) => {
    const [first, second] = order.indexOf(x) < order.indexOf(y) ? [x, y] : [y, x];
    return `/${first}-vs-${second}-to-${COUNTRY_SLUGS[cc]}`;
  };

  // ---- 1. 代行A vs 代行B × 配送先 ----
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      for (const cc of countries) {
        const A = ids[a], B = ids[b];   // 左が必ず配列で先に来る方（versusPath と対応）
        const input = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" };
        const { results, country } = calculateAll(input, data);
        const pair = results.filter((r) => r.proxyId === A.id || r.proxyId === B.id);
        const [win, lose] = pair.sort((x, y) => x.grandTotal - y.grandTotal);
        const diff = lose.grandTotal - win.grandTotal;
        const cn = countryName(importTax, cc);
        // 24通りの注文で2社を比べた結果（条件を変えると結論が変わるかを、ページごとに実際に計算する）
        const grid = pairGrid(input, data, A.id, B.id);
        const aRes = pair.find((r) => r.proxyId === A.id);
        const bRes = pair.find((r) => r.proxyId === B.id);

        pages.push({
          path: versusPath(A.id, B.id, cc),
          title: `${A.name} vs ${B.name} shipping to ${cn} — which is cheaper?`,
          description: `On a ¥10,000 1kg order from Mercari to ${cn}, ${win.name} lands at ${yen(win.grandTotal)} and ${lose.name} at ${yen(lose.grandTotal)}. Full fee breakdown.`,
          prefill: input,
          body: `
  <h1>${esc(A.name)} vs ${esc(B.name)}: shipping to ${esc(cn)}</h1>
  <p>Taking a typical order — a ¥10,000 item from Mercari Japan, about 1kg once packed, sent to ${esc(cn)} by EMS —
  ${diff > 0 ? `<strong>${esc(win.name)} works out cheaper by ${yen(diff)}</strong>` : `<strong>the two come out level</strong>`}.</p>
  ${verdictBox(grid, A.name, B.name, aRes, bRes, cn)}
  ${countryNotice(country)}
  ${resultsTable(pair)}
  <p>Totals include the proxy's service fee, packing, domestic shipping inside Japan, international postage,
  any deposit or payment fee, and import tax. Where a service collects tax up front it appears in the
  &ldquo;pay the proxy&rdquo; column instead of &ldquo;pay on delivery&rdquo; — the tax is the same either way.</p>

  <h2>${diff > 0 ? `Where the ${yen(diff)} actually goes` : "Line by line"}</h2>
  ${gapBreakdown(win, lose)}

  <h2>Does it hold for your order?</h2>
  <p>One example order proves little, so we priced the same pair on ${grid.cells.length} orders: four parcel weights,
  three item prices, and one item against three separate items, all from Mercari Japan to ${esc(cn)}.</p>
  ${heatTable(grid, A.name, B.name)}
  ${driverText(grid, A.name, B.name)}

  <h2>Depending on where you buy</h2>
  ${marketplaceDuel(input, data, A, B)}

  <h2>What each will ship to ${esc(cn)}</h2>
  ${shipRulesDuel(cc, cn, data, A, B)}

  <h2>When you pay the import tax</h2>
  ${taxTimingDuel(cc, cn, data, input, A, B)}

  <h2>Storage, packing and payment terms</h2>
  ${termsDuel(data, A, B)}

  <h2>What each includes for the money</h2>
  <p>${esc(win.name)}: ${win.includes.length ? esc(win.includes.map((i) => INCLUDE_LABELS[i] ?? i).join(", ")) : "no extras bundled at this plan level"}${win.planName ? ` (${esc(win.planName)})` : ""}.
  ${esc(lose.name)}: ${lose.includes.length ? esc(lose.includes.map((i) => INCLUDE_LABELS[i] ?? i).join(", ")) : "no extras bundled at this plan level"}${lose.planName ? ` (${esc(lose.planName)})` : ""}.
  A cheaper total with no inspection and no insurance is not the same product as a dearer one that includes
  both — on a second-hand auction item, where the seller's description is the only thing you have to go on,
  that difference is worth more than the gap above.</p>
  ${(win.warnings.length || lose.warnings.length)
    ? `<h2>What we could not confirm</h2>${[...new Set([...win.warnings, ...lose.warnings])].map((w) => `<p>${esc(w)}</p>`).join("")}`
    : ""}
  ${links([
    { href: `/cheapest-proxy-from-japan-to-${COUNTRY_SLUGS[cc]}`, text: `Cheapest proxy to ${cn}, by marketplace` },
    { href: `/import-tax-${COUNTRY_SLUGS[cc]}`, text: `Import tax when shipping to ${cn}` },
    { href: `/${A.id}-fees`, text: `${A.name} fees explained` },
    { href: `/${B.id}-fees`, text: `${B.name} fees explained` },
  ])}`,
        });
      }
    }
  }

  // ---- 2. 仕入れ元 × 配送先 → 配送先ごとに1本へ統合 ----
  // 仕入れ元ごとに9本ずつ割っていたが、実測すると 7つの仕入れ元は proxies.json 上で
  // 実質3パターンしかなかった（FROM JAPAN と Neokyo は仕入れ元で料金が変わらず、
  // Buyee は課金単位だけが変わり、差を作っているのは ZenMarket の 800/500/300 だけ）。
  // その結果 rakuten 版と rakuma 版は本文が94%一致していた。
  // 配送先ごとに1本へ寄せ、「仕入れ元で順位がどう入れ替わるか」を1枚の表で見せる。
  // 情報としてはこちらのほうが多い ― 以前は7本を開かないと比べられなかった。
  for (const cc of countries) {
    const cn = countryName(importTax, cc);
    const baseInput = { source: "yahoo_auction", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" };
    const { results: baseResults, country } = calculateAll(baseInput, data);

    const perSource = Object.entries(SOURCE_LABELS).map(([src, meta]) => {
      const input = { ...baseInput, source: src };
      const { results } = calculateAll(input, data);
      return { src, meta, results, best: results[0] };
    });

    const winners = [...new Set(perSource.map((r) => r.best.name))];
    const cheapest = perSource.reduce((a, b) => (b.best.grandTotal < a.best.grandTotal ? b : a));
    const dearest = perSource.reduce((a, b) => (b.best.grandTotal > a.best.grandTotal ? b : a));

    // 新品が買える仕入れ元にだけ「そもそも代行が要らない」選択肢を出す
    const storeBlock = buildStoreBlock(baseInput, data, perSource);

    const sourceRows = perSource.map((r) => `
      <tr>
        <td>${esc(r.meta.label)}</td>
        <td>${esc(r.best.name)}</td>
        <td>${yen(r.best.grandTotal)}</td>
        <td>${r.results.slice(1).map((x) => `${esc(x.name)} ${yen(x.grandTotal)}`).join(" &middot; ")}</td>
      </tr>`).join("");

    pages.push({
      path: `/cheapest-proxy-from-japan-to-${COUNTRY_SLUGS[cc]}`,
      title: `Cheapest Japan proxy service to ${cn}, by where you buy (${data.proxies._meta.updated})`,
      description: `All four proxy services priced on the same ¥10,000 1kg order to ${cn}, from seven Japanese marketplaces. ${cheapest.best.name} is cheapest at ${yen(cheapest.best.grandTotal)}${winners.length > 1 ? ", but the winner changes with the marketplace" : ""}.`,
      prefill: baseInput,
      body: `
  <h1>Cheapest proxy service from Japan to ${esc(cn)}</h1>
  <p>The same order &mdash; &yen;10,000 of goods, roughly 1kg packed, EMS to ${esc(cn)} &mdash; priced through all four
  services, from each of the seven places a proxy can buy from.
  <strong>${winners.length > 1
    ? `There is no single cheapest service: ${winners.map((w) => esc(w)).join(" and ")} each win depending on where you buy.`
    : `${esc(winners[0])} is cheapest wherever you buy${dearest.best.grandTotal > cheapest.best.grandTotal ? `, from ${yen(cheapest.best.grandTotal)} to ${yen(dearest.best.grandTotal)}` : ` &mdash; and at ${yen(cheapest.best.grandTotal)} the marketplace makes no difference to the total`}.`}</strong></p>
  ${countryNotice(country)}

  <h2>Cheapest service for each marketplace</h2>
  <table>
    <thead><tr><th>Where you buy</th><th>Cheapest</th><th>Total</th><th>The other three</th></tr></thead>
    <tbody>${sourceRows}</tbody>
  </table>
  <p>${dearest.best.grandTotal > cheapest.best.grandTotal
    ? `The spread between the best marketplace and the worst is
      <strong>${yen(dearest.best.grandTotal - cheapest.best.grandTotal)}</strong> on an identical &yen;10,000 item
      (${esc(cheapest.meta.label)} at ${yen(cheapest.best.grandTotal)} against ${esc(dearest.meta.label)} at
      ${yen(dearest.best.grandTotal)}). That gap is service fees alone &mdash; postage, packing and import tax are
      the same in every row.`
    : `The cheapest total is <strong>${yen(cheapest.best.grandTotal)}</strong> from every marketplace on this list.
      ${esc(cheapest.best.name)} charges one flat service fee regardless of where it buys, so on a single-item
      order the marketplace changes nothing. It starts to matter once you order more than one item, or once a
      service that charges per order rather than per item becomes the cheapest &mdash; the table below shows
      where the ranking actually moves.`}</p>

  ${unitOfChargeNote(baseInput, data, "Yahoo! Auctions")}

  <h2>When the item costs more, or less</h2>
  ${priceLadder(baseInput, data, cn)}

  <h2>When the parcel is heavier</h2>
  ${weightLadder(baseInput, data)}

  <h2>What the cheapest total is made of</h2>
  <p>${esc(baseResults[0].name)}'s ${yen(baseResults[0].grandTotal)} on a Yahoo! Auctions order breaks down as
  ${baseResults[0].payNow.lines.filter((l) => l.key !== "item").map((l) => `${esc(l.labelEn.toLowerCase())} ${yen(l.amount)}`).join(", ")},
  on top of the &yen;10,000 item itself${baseResults[0].payOnDelivery.quantified && baseResults[0].payOnDelivery.total > 0
    ? `, plus ${yen(baseResults[0].payOnDelivery.total)} of import tax when it arrives`
    : baseResults[0].payOnDelivery.quantified ? ", with nothing further to pay on arrival" : ", plus import charges that cannot be estimated in advance"}.
  The item is ${Math.round((10000 / baseResults[0].grandTotal) * 100)}% of what you actually spend &mdash; the rest is the cost
  of getting it out of Japan and through customs.</p>
  ${resultsTable(baseResults)}
  ${storeBlock}
  ${baseResults[0].warnings.length ? `<h2>What we could not confirm</h2>${baseResults[0].warnings.map((w) => `<p>${esc(w)}</p>`).join("")}` : ""}
  ${links([
    { href: `/import-tax-${COUNTRY_SLUGS[cc]}`, text: `Import tax when shipping to ${cn}` },
    { href: "/what-you-cannot-ship-from-japan", text: "What you cannot ship out of Japan" },
    ...ids.slice(0, 2).map((p) => ({ href: `/${p.id}-fees`, text: `${p.name} fees explained` })),
  ])}`,
    });
  }

  // ---- 3. 重量 × 配送先 ----
  for (const w of WEIGHTS) {
    for (const cc of countries) {
      const input = { source: "yahoo_auction", itemPriceJpy: 10000, itemCount: 1, weightG: w.g, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" };
      const { results, country, shipping } = calculateAll(input, data);
      const cn = countryName(importTax, cc);
      const best = results[0];

      pages.push({
        path: `/ship-${w.slug}-from-japan-to-${COUNTRY_SLUGS[cc]}`,
        title: `What it costs to ship ${w.label} from Japan to ${cn}`,
        description: `EMS postage for ${w.g}g to ${cn} is ${shipping.amount ? yen(shipping.amount) : "not published"}. With proxy fees and import tax the total comes to ${yen(best.grandTotal)} via ${best.name}.`,
        prefill: input,
        body: `
  <h1>Shipping ${esc(w.label)} from Japan to ${esc(cn)}</h1>
  <p>At ${w.g}g, Japan Post EMS charges <strong>${shipping.amount ? yen(shipping.amount) : "— (not in our data yet)"}</strong>
  to ${esc(cn)}${shipping.zone ? ` (zone ${shipping.zone})` : ""}. That is only part of the bill: the proxy's own fees and
  import tax sit on top.</p>
  ${countryNotice(country)}
  ${resultsTable(results)}

  <p>EMS charges by weight band, not by the gram, so this same
  ${shipping.amount ? yen(shipping.amount) : '—'} postage applies to anything up to ${w.band}g —
  ${w.alsoCovers.length ? w.alsoCovers.map((x) => esc(x)).join(', ') + ' all land in the same band' : 'there is no cheaper band below this one for a parcel this size'}.
  Going one gram over moves you to the next band.</p>
  ${weightBandNote(ems, cc, w.g, shipping)}

  <h2>One box or several?</h2>
  ${togetherOrApart(ems, cc, w.g, cn)}

  <h2>The same weight at different prices</h2>
  ${priceAtWeight(input, data, cn)}

  <h2>Each service, line by line</h2>
  <p>The postage is identical for all four at this weight. These are the lines that are not:</p>
  ${perServiceLines(results)}

  <h2>What can go in this box to ${esc(cn)}</h2>
  ${presetsAtWeight(w.slug, cc, cn, data)}

  <h2>Cheapest service by marketplace at this weight</h2>
  ${sourcesAtWeight(input, data)}

  <h2>How much of the bill is the weight?</h2>
  <p>On this order the postage alone is ${shipping.amount ? yen(shipping.amount) : "—"}, against a ¥10,000
  item and ${yen(best.grandTotal - 10000 - (shipping.amount ?? 0))} of everything else — service fee, packing,
  domestic postage inside Japan, payment fees and tax. ${shipping.amount && shipping.amount > 10000
    ? "Postage costs more than the item itself here, which is the usual reason a purchase from Japan stops making sense."
    : "Weight is the one input you can still change after you have chosen what to buy, by having the box packed tighter or by leaving the outer packaging behind."}</p>
  <p>The four services differ on how they treat weight. One charges for packing by weight on top of postage;
  the others fold packing into the service fee. That is why the ranking at ${w.g}g is not automatically the
  ranking at a different weight — the table above is recalculated for this weight specifically.</p>
  ${links([
    { href: `/cheapest-proxy-from-japan-to-${COUNTRY_SLUGS[cc]}`, text: `Cheapest proxy to ${cn}, by marketplace` },
    { href: `/import-tax-${COUNTRY_SLUGS[cc]}`, text: `Import tax when shipping to ${cn}` },
  ])}`,
      });
    }
  }

  // ---- 4. 各社の料金解説 ----
  for (const p of proxies.proxies) {
    const name = p.shortName ?? p.name;
    const feeRows = Object.entries(p.serviceFee.bySource).map(([src, v]) => {
      const amount = typeof v === "object" ? v.amount : v;
      const unit = typeof v === "object" ? v.unit : p.serviceFee.unit;
      return `<tr><td>${esc(SOURCE_LABELS[src]?.label ?? src)}</td><td>${yen(amount)} per ${unit}</td></tr>`;
    }).join("");

    pages.push({
      path: `/${p.id}-fees`,
      title: `${name} fees explained — every charge, ${data.proxies._meta.updated}`,
      description: `A full breakdown of what ${name} charges: service fee by marketplace, packing, storage, payment fees and import tax handling. Checked against their official pages.`,
      prefill: null,
      body: `
  <h1>${esc(name)}: what you actually pay</h1>
  <p>Checked against ${esc(name)}'s own fee pages on ${esc(data.proxies._meta.updated)}.</p>
  <h2>Service fee by marketplace</h2>
  <table><thead><tr><th>Buying from</th><th>Fee</th></tr></thead><tbody>${feeRows}</tbody></table>
  <h2>Other charges</h2>
  <ul>
    <li>Payment / deposit fee: ${p.paymentFee?.type === "rate" ? `${(p.paymentFee.rate * 100).toFixed(1)}%${p.paymentFee.grossUp ? " of the gross transaction (about " + ((p.paymentFee.rate / (1 - p.paymentFee.rate)) * 100).toFixed(2) + "% on top of what you need)" : ""}` : p.paymentFee?.type === "none" ? "none" : "not published"}</li>
    <li>Packing / consolidation: ${p.packingFee?.type === "included" ? "included" : p.packingFee?.type === "weight" ? `${yen(p.packingFee.baseAmount)} up to ${p.packingFee.baseUpToG}g, then ${yen(p.packingFee.perAdditionalKg)} per extra kg` : "charged, price not published"}</li>
    <li>Free storage: ${p.storage?.freeDays ? `${p.storage.freeDays} days` : "not published"}</li>
    <li>Export clearance fee: ${p.exportClearanceFee ? `${yen(p.exportClearanceFee.amount)} above ${yen(p.exportClearanceFee.thresholdJpy)}` : "not published"}</li>
  </ul>
  ${whenThisWins(p, data)}
  <h2>${esc(name)} in each of the ${countries.length} destinations</h2>
  ${proxyAcrossCountries(p, data, countries, (c) => countryName(importTax, c))}
  <h2>As the item gets more expensive</h2>
  ${proxyPriceCurve(p, data)}
  <h2>Storage, and what happens if you leave things too long</h2>
  <p>${p.storage?.freeDays
    ? `${esc(name)} stores a purchase free for ${p.storage.freeDays} days from the moment it reaches their warehouse${p.storage.maxDays ? `, and will hold it for at most ${p.storage.maxDays} days in total` : ""}.`
    : `${esc(name)} does not publish a free storage period.`}
  ${p.storage?.overstayPerDayPerItem ? `After that it is ${yen(p.storage.overstayPerDayPerItem)} per item per day.` : ""}
  ${p.storage?.overstayDailyByWeightG ? `After that it is charged daily by weight, from ${yen(p.storage.overstayDailyByWeightG[0].amount)} a day for a parcel under ${(p.storage.overstayDailyByWeightG[0].maxWeightG / 1000)}kg.` : ""}
  ${p.storage?.weeklyBySize ? `After that it is charged weekly by parcel size, from ${yen(p.storage.weeklyBySize.small.parcel)} to ${yen(p.storage.weeklyBySize.large.order)} a week.` : ""}
  This matters more than it sounds: the free window is what lets you win several auctions over a few weeks and
  ship them together in one box, which saves far more in postage than the storage costs.
  ${p.storage?.maxDays || p.storage?.disposeAfterDays ? `Leave it past the limit and the item is disposed of, with no compensation.` : ""}</p>
  <h2>Optional services you may end up paying for</h2>
  <ul>
    ${p.photoService ? `<li>Photographs of the item before it ships: ${yen(p.photoService.amount)} for ${p.photoService.photos}. On a second-hand auction purchase this is often the only way to find out what you actually bought before it leaves Japan.</li>` : ""}
    ${p.repackFee ? `<li>Repacking after the parcel is made up: ${Array.isArray(p.repackFee) ? `${yen(p.repackFee[0].amount)}–${yen(p.repackFee[p.repackFee.length - 1].amount)} depending on weight` : `from ${yen(p.repackFee.min)}`}.</li>` : ""}
    ${p.reinforcementFee ? `<li>Reinforced packing: ${yen(p.reinforcementFee.amount)} per box.</li>` : ""}
    ${p.packingFee?.optionalStrictPacking ? `<li>Heavy-duty packing: ${yen(p.packingFee.optionalStrictPacking)} per parcel, optional.</li>` : ""}
    ${p.cancelFee ? `<li>Cancelling after the item has reached the warehouse: ${yen(p.cancelFee.amount)}, and not possible at all for auction or flea-market purchases.</li>` : ""}
    ${p.disposalFee ? `<li>Disposing of something that cannot be exported: ${yen(p.disposalFee.perKg)} per kg, plus ${yen(p.disposalFee.laborPer15min)} per 15 minutes of work. Batteries are ${yen(p.disposalFee.batteryPerUnitMin)}–${yen(p.disposalFee.batteryPerUnitMax)} each.</li>` : ""}
    ${p.intangibleGoodsFee ? `<li>Digital goods such as game codes: an extra ${(p.intangibleGoodsFee.rate * 100).toFixed(0)}% of the item price.</li>` : ""}
    ${p.openParcelFee ? `<li>Opening a sealed parcel to add or remove something: ${yen(p.openParcelFee.amount)} plus packing.</li>` : ""}
  </ul>
  ${p.taxPrepay?.length ? `<h2>Import tax collected up front</h2><ul>${
    p.taxPrepay.filter((t) => t.rate).map((t) => `<li>${esc(t.country)}: ${esc(t.tax)} ${(t.rate * 100).toFixed(t.rate * 100 % 1 ? 1 : 0)}%</li>`).join("")
  }</ul><p>Where tax is collected up front you pay nothing extra when the parcel arrives, and you usually avoid the courier's own customs handling charge.</p>` : ""}
  ${links(ids.filter((x) => x.id !== p.id).map((x) => ({ href: versusPath(p.id, x.id, "US"), text: `${name} vs ${x.name} to the US` })))}`,
    });
  }

  // ---- 5. 配送先ごとの輸入税ガイド ----
  for (const cc of countries) {
    const c = importTax.countries[cc];
    if (!c) continue;
    const cn = c.name;
    // 本ツールはEMSしか値付けしないので、FedEx限定の事前徴収（Neokyoの米国DDP等）を
    // 「この会社は事前徴収します」と書くと嘘になる。carrier を必ず見る。
    const prepayers = proxies.proxies.filter((p) => (p.taxPrepay ?? []).some(
      (t) => t.country === cc && t.rate && (!t.onlyCarriers || t.onlyCarriers.includes("ems"))
    ));

    pages.push({
      path: `/import-tax-${COUNTRY_SLUGS[cc]}`,
      title: `Import tax on parcels from Japan to ${cn} (${data.proxies._meta.updated})`,
      description: c.displayEn?.body?.slice(0, 155) ?? `What you pay in tax and duty when importing from Japan into ${cn}.`,
      prefill: null,
      body: `
  <h1>Importing from Japan into ${esc(cn)}</h1>
  ${countryNotice(c)}
  <p>Import tax is set by ${esc(cn)}, not by the proxy service you choose. All the proxy decides is whether it
  takes the money at checkout or leaves you to settle with the courier at the door — the amount owed is the
  same either way. That is why the totals on this site are split into what you pay now and what you pay on
  arrival, rather than merged into one figure that would make the companies who collect honestly look dearer.</p>
  <h2>The numbers</h2>
  <ul>
    ${/* vatNote は日本語の社内メモなので絶対に出さない。英語ページに日本語が出た事故がある */""}
    <li>Import VAT / GST: ${c.vatRate === 0 ? "none — there is no general consumption tax on imports" : c.vatRate != null ? `${(c.vatRate * 100).toFixed(c.vatRate * 100 % 1 ? 1 : 0)}% on goods plus shipping` : c.vatNoteEn ? esc(c.vatNoteEn) : "not applicable"}</li>
    <li>Duty-free threshold: ${
      c.deMinimis?.status === "active" ? esc(c.deMinimis.thresholdLabelEn ?? `${c.deMinimis.dutyThreshold} ${c.deMinimis.currency}`)
      : c.deMinimis?.status === "suspended" ? "suspended — duty applies to every parcel"
      : c.deMinimis?.status === "removed" ? "abolished"
      : c.deMinimis?.status === "not-applicable" ? "not applicable — nothing is taxed in the first place"
      : "unknown"}</li>
  </ul>
  ${/* 税がそもそも無い国に「到着時に払う」と書くと嘘になる（香港） */""}
  ${c.vatRate === 0 && c.deMinimis?.status === "not-applicable"
    ? `<h2>Nothing to pay on arrival</h2>
  <p>There is no tax for a proxy to collect and none for you to pay at the door, so the question of who charges
  it up front does not arise. The total you pay the proxy is the total, and you avoid the courier customs
  handling fees that apply almost everywhere else.</p>`
    : `<h2>Which proxies collect this tax up front</h2>
  ${prepayers.length
    ? `<p>${prepayers.map((p) => esc(p.shortName ?? p.name)).join(", ")} ${prepayers.length === 1 ? "collects" : "collect"} it at checkout. The others leave you to pay on delivery, where the courier normally adds a handling charge on top.</p>`
    : `<p>None of the four services collect this tax up front for ${esc(cn)}. You pay it when the parcel arrives, and couriers normally add a handling charge on top.</p>`}`}
  ${taxWorkedExample(cc, data, cn)}
  <h2>Tax at six different prices</h2>
  ${taxLadder(cc, data)}
  ${thresholdsInYen(cc, data) ? `<h2>The limits that matter, in yen</h2>${thresholdsInYen(cc, data)}` : ""}
  <h2>How ${esc(cn)} compares</h2>
  ${taxAmongCountries(cc, data, countries, (c) => countryName(importTax, c))}
  <h2>The handling fee nobody quotes</h2>
  <p>Where tax is not collected up front, the courier or postal operator pays it for you at the border and
  then charges a fee for having done so. It is commonly ¥1,000–3,000 and it is not part of the tax itself.
  None of the four services publish it and it varies by carrier, so it is deliberately left out of the totals
  here rather than guessed at — but it is a real reason to prefer a service that collects at checkout where
  you have the choice.</p>
  ${links([
    { href: `/cheapest-proxy-from-japan-to-${COUNTRY_SLUGS[cc]}`, text: `Cheapest proxy to ${cn}, by marketplace` },
    { href: `/ship-scale-figure-from-japan-to-${COUNTRY_SLUGS[cc]}`, text: `Cost to ship a boxed figure to ${cn}` },
    { href: "/how-we-calculate", text: "How these numbers are worked out" },
  ])}`,
    });
  }

  // ---- 6. 属性 × 配送先「これは送れるのか」 ----
  // 検索意図が実在する6属性に絞る。8属性すべてを機械的に展開しない。
  const SEO_ATTRS = ["replica_gun", "flammable_liquid", "aerosol", "lithium_battery", "adult", "food"];
  const { restrictions } = data;

  const VERDICT = {
    ok: "Yes",
    conditional: "With conditions",
    carrier_limited: "With conditions",
    unknown: "Not stated",
    prohibited: "No",
  };

  /** 各社の可否を公式原文つきで並べる。原文が会社ごとに違うのでページ固有性が担保される。 */
  function verdictTable(results, attrId) {
    const rows = results.map((r) => {
      // blockers は ok のマスを含まないので、可の場合は元データから原文を引く。
      // 「制限を明記した上で対象外」と「そもそも何も書いていない」を混同しない。
      const b = r.shippable.blockers[0];
      const cell = restrictions.byProxy[r.proxyId]?.[attrId];

      // 引用符で囲ってよいのは公式原文（quoteEn）だけ。こちらの説明（noteEn）まで
      // 「 」に入れると、会社が言っていないことを言ったことにしてしまう。
      const quote = b?.quoteEn ?? (b ? null : cell?.quoteEn);
      const note = b ? b.reasonEn : cell?.noteEn;
      // 国側の制限は日本郵便のルールであって、その代行会社の発言ではない
      const prefix = b?.axis === "destination"
        ? `<em>Japan Post rule, applies to every service:</em> `
        : "";

      const says = [
        quote ? `${prefix}&ldquo;${esc(quote)}&rdquo;` : prefix,
        note ? `<span class="says-note">${esc(note)}</span>` : "",
      ].filter(Boolean).join(" ");

      return `
      <tr>
        <td>${esc(r.name)}</td>
        <td><strong>${VERDICT[r.shippable.level]}</strong></td>
        <td>${says || "Nothing published about this category."}</td>
        <td>${r.shippable.level === "prohibited" ? "&mdash;" : yen(r.grandTotal)}</td>
      </tr>`;
    }).join("");

    return `<table>
    <thead><tr><th>Service</th><th>Can it ship?</th><th>What the published rules say</th><th>Total if it ships</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  }

  // 国別に展開しない。実測した結果、判定が国でほとんど変わらなかったため。
  //   model-paint / spray-cans / food / airsoft … 全9か国で4社の判定が完全に同一
  //   adult … 8か国が同一（香港だけ Neokyo が名指しで拒否）
  //   lithium_battery … 独・英が日本郵便の引受停止で別判定。国別に割る根拠があるのはこれだけ
  // 9本に割ると1本あたりの違いが国名と金額だけになり、Google に
  // 「クロール済み - インデックス未登録」で全部落とされた（2026-08 に実際に落ちた）。
  // 属性ごとに1本へ統合し、国差は本文の表で見せる。そのほうが情報量はむしろ増える。
  for (const attrId of SEO_ATTRS) {
    const attr = restrictions.attributes.find((a) => a.id === attrId);

    const inputFor = (cc) => ({
      source: "yahoo_auction", itemPriceJpy: 10000, itemCount: 1, weightG: 1000,
      destination: cc, domesticShippingJpy: 700, buyeePlan: "light",
      category: "other", attributes: [attrId],
    });

    const byCountry = countries.map((cc) => ({
      cc, cn: countryName(importTax, cc), ...calculateAll(inputFor(cc), data),
    }));

    // 4社の可否の並びでグループ化し、多数派を本文の代表にする。
    const patternOf = (x) => x.results
      .map((r) => `${r.proxyId}:${VERDICT[r.shippable.level]}`)
      .sort()
      .join("|");
    const groups = new Map();
    for (const x of byCountry) {
      const k = patternOf(x);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    const tiers = [...groups.values()].sort((a, b) => b.length - a.length);
    const main = tiers[0];
    const exceptions = tiers.slice(1);
    const rep = main.find((x) => x.cc === "US") ?? main[0];

    const okOf = (x) => x.results.filter((r) => ["ok", "conditional", "carrier_limited"].includes(r.shippable.level));
    const cheapestOk = okOf(rep)[0];

    const verdictLine = rep.allBlocked
      ? `<strong>No. None of the four services will ship ${esc(attr.seoLabelEn)} out of Japan.</strong>`
      : cheapestOk
        ? `<strong>Yes, but only through some of them.</strong> ${esc(cheapestOk.name)} is the cheapest that will take it, landing at ${yen(cheapestOk.grandTotal)} on a &yen;10,000 1kg order.`
        : `<strong>No service confirms in writing that it will.</strong> Every provider either refuses ${esc(attr.seoLabelEn)} or has published no rule about it.`;

    // 「どの国でも同じ」なのか「この国だけ違う」なのかを、9本に割らずに1枚で見せる。
    const countryRows = byCountry.map((x) => {
      const ok = okOf(x);
      const differs = exceptions.some((g) => g.includes(x));
      return `
      <tr${differs ? ` class="row-exception"` : ""}>
        <td>${esc(x.cn)}${differs ? " <strong>(different)</strong>" : ""}</td>
        <td>${x.allBlocked ? "<strong>No service will</strong>" : ok.length === 4 ? "All four will" : `${ok.length} of 4 will`}</td>
        <td>${ok[0] ? `${esc(ok[0].name)} &mdash; ${yen(ok[0].grandTotal)}` : "&mdash;"}</td>
      </tr>`;
    }).join("");

    const sameEverywhere = exceptions.length === 0;

    pages.push({
      path: `/can-you-ship-${attr.slug}-from-japan`,
      title: `Can you ship ${attr.seoLabelEn} from Japan?`,
      description: rep.allBlocked
        ? `No. All four Japan proxy services refuse ${attr.seoLabelEn}. Here is what each one says, and what to do instead.`
        : `Buyee, ZenMarket, Neokyo and FROM JAPAN compared on ${attr.seoLabelEn}, quoting each company's own rules, with the answer for nine destinations.`,
      prefill: inputFor(rep.cc),
      body: `
  <h1>Can you ship ${esc(attr.seoLabelEn)} from Japan?</h1>
  <p>${verdictLine}</p>
  <p class="muted">Covers ${esc(attr.helpEn.toLowerCase())} &mdash; for example ${attr.examplesEn.map((e) => esc(e)).join(", ")}.</p>
  ${verdictTable(rep.results, attrId)}
  ${rep.allBlocked
    ? `<aside class="notice"><strong>What to do instead</strong><p>${esc(attr.whenBlockedEn)}</p></aside>`
    : rep.noneConfirmed
      ? `<aside class="notice"><strong>Read this before you bid</strong><p>${esc(attr.whenUnconfirmedEn ?? attr.whenBlockedEn)}</p></aside>`
      : ""}

  <h2>Does the destination change the answer?</h2>
  <p>${sameEverywhere
    ? `No. We checked all nine destinations this site covers and the four services give the same answer to every one of them, because the rule is about the item rather than the route.`
    : `Yes, for ${exceptions.flat().length} of the nine destinations we cover. The rows marked <strong>(different)</strong> below do not follow the table above.`}</p>
  <table>
    <thead><tr><th>Destination</th><th>Can it ship?</th><th>Cheapest that will take it</th></tr></thead>
    <tbody>${countryRows}</tbody>
  </table>
  ${exceptions.map((g) => {
    const x = g[0];
    const note = restrictions.byDestination?.[x.cc]?.[attrId]?.noteEn;
    const refused = x.results.filter((r) => r.shippable.level === "prohibited").map((r) => esc(r.name));
    return `<h3>${g.map((y) => esc(y.cn)).join(", ")}</h3>
    <p>${note ? esc(note) + " " : ""}${refused.length ? `${refused.join(" and ")} refuse${refused.length === 1 ? "s" : ""} ${esc(attr.seoLabelEn)} on this route specifically.` : ""}
    ${restrictions.byDestination?.[x.cc]?.[attrId]
      ? `This is a Japan Post rule about the destination, so it applies whichever of the four services you use &mdash; switching companies does not get around it.`
      : `This is the company's own policy rather than a postal rule, so a different service may still accept it.`}</p>`;
  }).join("")}

  <h2>What you lose if it is refused</h2>
  ${refusalCost(data, attrId)}

  <h2>Why this matters before you bid</h2>
  <p>A proxy will happily accept the order and buy the item for you. The refusal happens later, when the parcel
  reaches their warehouse and is inspected. At that point you have already paid for the goods, the domestic
  shipping inside Japan and the service fee, and none of it comes back. The item is disposed of or returned to
  the seller at your cost.</p>
  <p>On the &yen;10,000 order priced above that is <strong>${yen(10000 + 700 + (rep.results[0] ? lineOf(rep.results[0], "service") : 0))}
  gone before the parcel ever leaves Japan</strong> &mdash; the item, &yen;700 of domestic postage and the service fee &mdash;
  with disposal charged on top at some services. The international postage is the only part you save, because
  the parcel never ships. It is the one mistake on this site that costs you the whole purchase rather than
  a few hundred yen of margin.</p>
  <p>Rules checked against each company's own prohibited-items page on ${esc(restrictions._meta.updated)}.
  Where a company publishes nothing on a category we say so rather than guessing.</p>
  ${links([
    { href: "/what-you-cannot-ship-from-japan", text: "Everything you cannot ship out of Japan" },
    { href: `/cheapest-proxy-from-japan-to-${COUNTRY_SLUGS[rep.cc]}`, text: `Cheapest proxy to ${rep.cn}` },
    { href: `/import-tax-${COUNTRY_SLUGS[rep.cc]}`, text: `Import tax when shipping to ${rep.cn}` },
  ])}`,
    });
  }

  // ハブページ。属性別ページへの入口であり、それ自体も一次情報の一覧として成立させる。
  {
    const attrRows = restrictions.attributes.map((a) => {
      const verdicts = ids.map((p) => {
        const cell = restrictions.byProxy[p.id]?.[a.id];
        return `${esc(p.name)}: ${VERDICT[cell?.level ?? "unknown"]}`;
      }).join(" · ");
      const seo = SEO_ATTRS.includes(a.id);
      return `
      <tr>
        <td>${seo ? `<a href="/can-you-ship-${a.slug}-from-japan">${esc(a.labelEn)}</a>` : esc(a.labelEn)}</td>
        <td>${esc(a.helpEn)}</td>
        <td>${verdicts}</td>
      </tr>`;
    }).join("");

    pages.push({
      path: "/what-you-cannot-ship-from-japan",
      title: "What you cannot ship out of Japan with a proxy service",
      description: "Airsoft, model paint, spray cans, lithium batteries and more — what each of the four major Japan proxy services actually refuses, quoted from their own rules.",
      prefill: null,
      body: `
  <h1>What you cannot ship out of Japan with a proxy service</h1>
  <p>Proxy services will let you buy almost anything on Yahoo! Auctions or Mercari. Shipping it out is a
  different question, and you usually find out only after the parcel reaches their warehouse — when the money
  is already spent. This table is taken from each company's own prohibited-items page, checked on
  ${esc(restrictions._meta.updated)}.</p>
  <table>
    <thead><tr><th>Category</th><th>What it covers</th><th>What each service says</th></tr></thead>
    <tbody>${attrRows}</tbody>
  </table>
  <h2>&ldquo;Not stated&rdquo; is not the same as allowed</h2>
  <p>Where a company publishes no rule for a category we mark it <em>Not stated</em> rather than assuming it is
  fine. It means the decision is made at the warehouse, after you have paid. Japan Post rules still apply on top
  of whatever the proxy says, and those depend on the destination — lithium batteries, for instance, cannot be
  posted to Germany or the United Kingdom at all.</p>

  <h2>Two separate rules have to pass, not one</h2>
  <p>Whether a parcel can leave Japan is decided twice. The proxy applies its own policy, which differs
  between companies and is a commercial decision — one of the four publishes a handling procedure for model
  guns where the others simply refuse them. Then Japan Post applies the rules for the country you are sending
  to, and those apply to everyone equally. A company being willing to take your money does not mean the post
  office will take the box.</p>
  <p>This is why the pages here check both, and why the answer for the same item can differ by destination.
  Changing proxy gets you past a company policy; nothing gets you past a postal restriction except a private
  courier, which is a different price list altogether.</p>

  <h2>It is not the item that is restricted — it is a property of it</h2>
  <p>The categories above are written as attributes rather than product types on purpose. A scale figure is
  ordinarily unrestricted, but the same figure with an illuminated base contains a lithium battery and is
  judged on that. A plastic model kit ships freely; the same kit bundled with a pot of paint is a flammable
  liquid. Buying &ldquo;a figure&rdquo; tells you nothing — what is in the box does.</p>
  <p>If you are unsure, assume the stricter reading. The cost of being wrong is not a delay: it is the item,
  the domestic postage and the service fee, none of which is refunded.</p>
  ${links([
    ...SEO_ATTRS.map((id) => {
      const a = restrictions.attributes.find((x) => x.id === id);
      return { href: `/can-you-ship-${a.slug}-from-japan`, text: `Can you ship ${a.seoLabelEn} from Japan?` };
    }),
  ])}`,
    });
  }

  // ---- 7. 運営者情報・算出方法・プライバシー・問い合わせ ----
  // AdSense の審査で「有用性の低いコンテンツ」として落ちた直接の原因のひとつが
  // これらが1ページも無かったこと。広告の有無に関わらず、誰が何を根拠に書いているかを
  // 示せないサイトは信用されない。
  // 読み物（ガイド）と入口のハブ（/compare・/import-tax・/guides）。ナビゲーションから辿れる先。
  pages.push(...buildGuides(data, { COUNTRY_SLUGS, versusPath, countryName: (c) => countryName(importTax, c) }));
  // ジャンル別ガイド（フィギュア・プラモデル・漫画など8本）
  pages.push(...buildGenreGuides(data, { COUNTRY_SLUGS, countryName: (c) => countryName(importTax, c) }));

  pages.push(...staticPages(data));

  return pages;
}

/**
 * サイトそのものについて説明するページ群。
 *
 * 計算ページと違い、ここは「誰が」「何を根拠に」「どこまで保証するか」を書く。
 * 算出方法のページは、利用者が数字を検算できるようにするためのものでもある。
 */
function staticPages(data) {
  const { proxies, ems, importTax, restrictions } = data;
  const proxyNames = proxies.proxies.map((p) => esc(p.shortName ?? p.name)).join(", ");
  const countryCount = Object.keys(COUNTRY_SLUGS).length;

  return [
    {
      path: "/how-we-calculate",
      layout: "content-only",
      title: "How these numbers are worked out — sources and method",
      description: `Every fee, postage band and tax rate used on this site, where it came from, and the exact order the calculation runs in. Fee data checked ${proxies._meta.updated}.`,
      prefill: null,
      body: `
  <h1>How these numbers are worked out</h1>
  <p>Most proxy comparisons quote a service fee and stop there. The service fee is rarely the largest number
  on the bill, and it is never the one that decides which company is cheapest. This page sets out exactly what
  goes into the totals on this site so you can check them against your own quote.</p>

  <h2>The three tiers</h2>
  <p>Import tax is a rule of the country you live in, not a property of the proxy company. What a proxy decides
  is only <em>when</em> you pay it — some collect it at checkout, some leave you to pay the courier on the
  doorstep. Add tax straight into one number and the honest companies that collect up front look expensive.
  So every total on this site is split three ways:</p>
  <ol>
    <li><strong>What you pay the proxy now</strong> — goods, service fee, packing, domestic postage inside
    Japan, international postage, payment or deposit fees, and tax if that company pre-collects it.</li>
    <li><strong>What you pay on delivery</strong> — import VAT, GST or business tax charged when the parcel
    lands, where it was not already collected.</li>
    <li><strong>The final total</strong> — the two added together. This is the only figure worth ranking on.</li>
  </ol>

  <h2>Where each number comes from</h2>
  <table>
    <thead><tr><th>Input</th><th>Source</th><th>Checked</th></tr></thead>
    <tbody>
      <tr><td>Service fees, packing, deposit fees, storage</td><td>Each company's own published fee pages (${proxyNames})</td><td>${esc(proxies._meta.updated)}</td></tr>
      <tr><td>International postage</td><td>Japan Post's official EMS rate table</td><td>${esc(ems._meta.updated)}</td></tr>
      <tr><td>Import tax and duty-free thresholds</td><td>Each destination's own customs or tax authority</td><td>${esc(importTax._meta.updated)}</td></tr>
      <tr><td>Prohibited and restricted items</td><td>Each company's prohibited-items page, plus Japan Post's country-by-country acceptance list</td><td>${esc(restrictions._meta.updated)}</td></tr>
    </tbody>
  </table>
  <p>Every figure carries the URL it came from and the date it was read. Nothing is estimated from memory or
  copied from another comparison site.</p>

  <h2>Rules we hold ourselves to</h2>
  <ul>
    <li><strong>An unknown fee is never silently treated as zero.</strong> A company with missing data would
    otherwise look cheapest simply because we failed to find its price. Where something is unpublished the
    total carries a warning saying so.</li>
    <li><strong>Postage is charged in bands, not per gram.</strong> EMS prices step up at fixed weights, so a
    parcel one gram over a boundary costs the same as one at the top of the next band. We always apply the
    band your weight actually falls into rather than interpolating.</li>
    <li><strong>A duty-free threshold is only applied where it is still in force.</strong> The United States
    suspended its $800 exemption in 2025; the EU abolished its €150 threshold in July 2026. Taiwan's
    NT$2,000 exemption is still live, and where an order sits close to a threshold we say that an exchange-rate
    move can push it either side of the line.</li>
    <li><strong>Shippability is checked before price.</strong> If a company will not export the item, we say so
    and we do not present it as the cheapest option, however low its total would have been.</li>
  </ul>

  <h2>What is deliberately not included</h2>
  <ul>
    <li><strong>Courier customs handling fees.</strong> These are real and often ¥1,000–3,000, but they vary by
    carrier and country and none of the four companies publish them. We say a fee is likely rather than invent
    a figure.</li>
    <li><strong>Customs duty by HS code.</strong> Duty depends on what the item is, and the rate for a resin
    figure differs from that for a cotton shirt. Where duty applies but cannot be pinned down, the total is
    marked as a minimum rather than padded with a guess.</li>
    <li><strong>Optional extras.</strong> Photo services, reinforced packing, and repacking are all priced on
    the individual company pages but are left out of the default comparison, because most orders do not use them.</li>
    <li><strong>Carriers other than EMS.</strong> DHL, FedEx and UPS are cheaper on some routes and are the only
    option for some restricted goods. Their rate tables are not public in a usable form, so this site prices EMS only.</li>
  </ul>

  <h2>How to check us</h2>
  <p>Open the breakdown on any result and you will see every line that makes up the total. Put the same order
  into the company's own quote tool and the two should agree, allowing for the exchange rate they use on the
  day and for domestic postage, which depends on the individual seller and is entered by you as an estimate.</p>
  <p>If a number is wrong, we would rather know. There is a form on the <a href="/contact">contact page</a>.</p>
  ${links([
    { href: "/about", text: "About this site" },
    { href: "/what-you-cannot-ship-from-japan", text: "What you cannot ship out of Japan" },
    { href: "/import-tax-united-states", text: "Import tax from Japan to the United States" },
  ])}`,
    },

    {
      path: "/about",
      layout: "content-only",
      title: "About Japan Proxy Cost",
      description: "Who runs this site, why it exists, how it is paid for, and what it will and will not tell you. An independent calculator, not a proxy service.",
      prefill: null,
      body: `
  <h1>About this site</h1>
  <p>Japan Proxy Cost is an independent calculator that works out what buying from Japan through a proxy
  shopping service actually costs, once every fee and the import tax at your end are counted. It covers
  ${proxyNames}, and ${countryCount} destination countries.</p>

  <h2>Why it exists</h2>
  <p>Proxy services publish their service fee prominently and everything else somewhere else. The fee is
  ¥300–800; the parts that decide the bill are packing, weight-based postage, deposit fees charged as a
  percentage, and the tax your own country charges on arrival. Because the companies charge on different
  units — per item, per order, by weight, as a percentage — no single one of them is cheapest for every
  order. Which one wins genuinely changes with what you buy, how heavy it is and where you live.</p>
  <p>The existing comparisons are mostly lists of service fees, which is the one number that does not settle
  the question. This site runs the whole calculation instead.</p>

  <h2>Who runs it</h2>
  <p>It is written and maintained by <strong>kakuni</strong>, an independent developer based in Japan. It is
  not operated by, affiliated with, or endorsed by any of the proxy services it compares. Being in Japan is
  the reason the source material is usable: the fee pages, Japan Post's rate tables and the prohibited-item
  lists are read in Japanese, where they are fuller and more current than the English versions.</p>

  <h2>How it is paid for</h2>
  <p>The site carries advertising, and some outbound links to shops and services may earn a commission if you
  buy. That money never changes the ranking. The calculation is run first and the results are ordered by what
  you would actually pay, with items that cannot legally be exported pushed down regardless of price. It is
  routinely the case that the cheapest result is a company that pays us nothing, and we publish that result.
  A comparison that sold its ordering would not be worth reading, and would not survive contact with anyone
  who checked it.</p>
  <p>Where an item does not need a proxy at all — something new and in stock that a Japanese retailer already
  ships overseas — we would rather say so, because that saves you the entire proxy fee.</p>

  <h2>What it will not tell you</h2>
  <p>It is an estimate, not a quote. Companies change their pricing, exchange rates move, and your customs
  authority has the final say on what you owe. Domestic postage inside Japan depends on the individual seller
  and is a figure you supply. The <a href="/how-we-calculate">method page</a> sets out exactly what is counted
  and what is deliberately left out.</p>
  <p>It is also not a shop. We do not buy anything, hold anything, or ship anything. If an order goes wrong,
  the company you paid is the one who can help.</p>

  <h2>Corrections</h2>
  <p>Fee pages change without notice. Every number here records the date it was checked, and if you find one
  that no longer matches the company's own page, please tell us — see <a href="/contact">contact</a>.</p>

  <h2 id="photo-credits">Photo credits</h2>
  <p>The photographs behind the page headings come from Wikimedia Commons and are used under the licences shown.
  They are resized and darkened so the text over them stays readable; nothing else is changed.</p>
  <ul>${Object.values(PHOTOS).map((p) => `<li><a href="${p.source}" rel="noopener" target="_blank">${esc(p.what)}</a> by ${esc(p.author)}, <a href="${p.licenseUrl}" rel="license noopener" target="_blank">${p.license}</a></li>`).join("")}</ul>
  ${links([
    { href: "/how-we-calculate", text: "How these numbers are worked out" },
    { href: "/privacy-policy", text: "Privacy and cookies" },
    { href: "/contact", text: "Contact and corrections" },
  ])}`,
    },

    {
      path: "/privacy-policy",
      layout: "content-only",
      title: "Privacy and cookie policy",
      description: "What this site collects, the cookies used for analytics and advertising, how to opt out, and how affiliate links are disclosed.",
      prefill: null,
      body: `
  <h1>Privacy and cookies</h1>
  <p>This page explains what happens to data when you use Japan Proxy Cost.</p>

  <h2>What you type into the calculator</h2>
  <p>Nothing you enter is sent to us. The prices, weights and destinations you choose are processed entirely
  inside your own browser — the site has no server that receives them, no account system and no database of
  users. Close the tab and it is gone.</p>

  <h2>Analytics</h2>
  <p>We use Google Analytics 4 to count visits and see which pages are read. It sets cookies and records
  things like the pages you open, roughly where in the world you are, and what kind of device you use. It is
  used in aggregate to decide what to write next. We do not attempt to identify individual visitors.</p>

  <h2>Advertising</h2>
  <p>This site shows advertising supplied by Google AdSense.</p>
  <ul>
    <li>Google and its partners use cookies to serve ads based on your prior visits to this and other sites.</li>
    <li>Google's use of advertising cookies enables it and its partners to serve ads to you based on your
    visit to this site and/or other sites on the internet.</li>
    <li>You may opt out of personalised advertising by visiting
    <a href="https://www.google.com/settings/ads" rel="nofollow noopener noreferrer" target="_blank">Google Ads Settings</a>.</li>
    <li>You can opt out of third-party vendors' use of cookies for personalised advertising at
    <a href="https://www.aboutads.info/choices/" rel="nofollow noopener noreferrer" target="_blank">aboutads.info</a>.</li>
    <li>More detail on how Google handles data is at
    <a href="https://policies.google.com/technologies/partner-sites" rel="nofollow noopener noreferrer" target="_blank">How Google uses information from sites that use its services</a>.</li>
  </ul>

  <h2>Affiliate links</h2>
  <p>Some links out of this site are affiliate links. If you follow one and buy something, we may receive a
  commission at no extra cost to you. Those links are marked in the page source with
  <code>rel="sponsored"</code>.</p>
  <p>Commission does not affect the comparison. Results are ordered by what you would actually pay and by
  whether the item can legally be exported, never by what a company pays us. Where the cheapest option earns
  us nothing, it is still shown as the cheapest option.</p>

  <h2>Cookies set by this site itself</h2>
  <p>None. The site stores no preferences and requires no login. Every cookie you receive is set by Google's
  analytics or advertising code described above.</p>

  <h2>Links to other sites</h2>
  <p>When you follow a link to a proxy service, a shop, a postal operator or a customs authority, you are on
  their site under their privacy policy, not this one.</p>

  <h2>Children</h2>
  <p>This site is aimed at adults buying goods internationally and is not directed at children under 13. We do
  not knowingly collect information from them.</p>

  <h2>Changes</h2>
  <p>If this policy changes, the revised version will appear on this page.</p>
  <p>Questions about any of the above: see <a href="/contact">contact</a>.</p>
  ${links([
    { href: "/about", text: "About this site" },
    { href: "/contact", text: "Contact" },
  ])}`,
    },

    {
      path: "/contact",
      layout: "content-only",
      title: "Contact and corrections",
      description: "How to report a fee that has changed, a rule we have wrong, or a destination you would like added. Corrections are welcome and are checked against primary sources.",
      prefill: null,
      body: `
  <h1>Contact</h1>
  <p>Everything goes straight to the person who maintains the site. There is no support desk behind it, so
  expect a few days. Messages in English or Japanese are both fine.</p>

  <form class="contact-form" action="${esc(CONTACT_FORM_ENDPOINT)}" method="POST">
    <input type="hidden" name="_subject" value="Japan Proxy Cost — message from the contact form" />
    <input type="hidden" name="_captcha" value="false" />
    <input type="hidden" name="_template" value="table" />
    <input type="hidden" name="_next" value="https://japanproxy.kakuni-lab.com/contact-received" />
    ${/* ボット除け。人間には見えない欄で、埋まっていたら送信を捨てる */""}
    <input type="text" name="_honey" style="display:none" tabindex="-1" autocomplete="off" />

    <label>
      <span>What is this about?</span>
      <select name="Topic" required>
        <option value="A number is wrong or out of date">A number is wrong or out of date</option>
        <option value="Request a country or marketplace">Request a country or marketplace</option>
        <option value="I run one of the services listed here">I run one of the services listed here</option>
        <option value="Something else">Something else</option>
      </select>
    </label>

    <label>
      <span>Which page? <em>(paste the address if it is about a specific one)</em></span>
      <input type="url" name="Page" placeholder="https://japanproxy.kakuni-lab.com/..." />
    </label>

    <label>
      <span>Details</span>
      <textarea name="Details" rows="6" required placeholder="What did you see, and what should it say instead?"></textarea>
    </label>

    <label>
      <span>Source you are going by <em>(optional, but it gets things fixed faster)</em></span>
      <input type="url" name="Source" placeholder="https://..." />
    </label>

    <label>
      <span>Your email <em>(optional — only if you want a reply)</em></span>
      <input type="email" name="email" placeholder="you@example.com" />
    </label>

    <button type="submit">Send</button>
  </form>
  <p class="muted">Your message is delivered by FormSubmit, a third-party relay. Nothing you type is stored on
  this site. See <a href="/privacy-policy">privacy and cookies</a>.</p>

  <h2>Reporting a number that is wrong</h2>
  <p>This is the most useful thing you can send. Fee pages change without announcement, and the date each
  figure was last checked is printed on the relevant page. If something no longer matches, the company's own
  URL is the single most helpful thing to include — corrections are checked against the company's published
  page before anything changes, and the check date is updated when they are.</p>

  <h2>Asking for a destination or a marketplace</h2>
  <p>Adding a country means finding its postage band, its import tax rules and any items it refuses — so it is
  not instant, but requests are what decide the order things get added in. The same goes for marketplaces and
  for proxy services not currently covered.</p>

  <h2>What we cannot help with</h2>
  <p>We are not a proxy service and have no access to anyone's orders. If a parcel is late, an item was
  refused at a warehouse, or a refund has not arrived, the company you paid is the only party who can act.
  Their own support pages are linked from each of their fee pages here.</p>

  <h2>For the companies compared here</h2>
  <p>If you operate one of the services on this site and a figure is out of date, or you would like to supply
  a rate table we have marked as unpublished, please get in touch. Corrections from a company about its own
  pricing are applied quickly and the source is credited.</p>
  ${links([
    { href: "/about", text: "About this site" },
    { href: "/how-we-calculate", text: "How these numbers are worked out" },
    { href: "/privacy-policy", text: "Privacy and cookies" },
  ])}`,
    },

    {
      path: "/contact-received",
      layout: "content-only",
      // 送信を終えた人だけが見る通過ページ。検索から来ても意味がないのでインデックスさせない
      noindex: true,
      title: "Message received — Japan Proxy Cost",
      description: "Your message has been sent. What happens next, and how corrections to the fee data are handled.",
      prefill: null,
      body: `
  <h1>Thank you — your message has been sent</h1>
  <p>It goes to one person rather than a support queue, so a reply may take a few days. If you did not leave an
  email address there will not be a reply, but the message is still read.</p>

  <h2>If you reported a number</h2>
  <p>Corrections are not applied on trust. The company's own published page is opened and read first, and only
  then is the figure changed and the check date on the relevant page updated. If the company has genuinely
  changed its pricing, that usually moves the rankings on several pages at once, because the same fee data
  drives every comparison on this site.</p>
  <p>If the page turns out to be right after all, that is worth knowing too — it usually means something on
  the page is worded confusingly, which is its own bug.</p>

  <h2>If you asked for a country or a marketplace</h2>
  <p>Adding a destination means finding three separate things: its EMS postage band, its import tax rules and
  duty-free threshold, and any items it refuses to accept from Japan. None of that can be guessed, so it takes
  a while — but requests are what decide the order things get added in.</p>

  <h2>If you run one of the services listed here</h2>
  <p>Corrections from a company about its own pricing are treated as authoritative and applied quickly, with
  the source credited and the check date updated. The same goes for a rate table we have marked as
  unpublished — several figures on this site carry a visible warning saying a company does not publish
  something, and we would much rather replace that warning with a real number than keep it.</p>
  <p>What will not change is the ordering. Results are ranked by what the buyer actually pays and by whether
  the item can legally be exported, never by any commercial arrangement.</p>

  <h2>In the meantime</h2>
  <ul>
    <li><a href="/">Back to the calculator</a></li>
    <li><a href="/how-we-calculate">How these numbers are worked out</a> — every source, and what is deliberately excluded</li>
    <li><a href="/what-you-cannot-ship-from-japan">What you cannot ship out of Japan</a> — worth reading before you bid on anything</li>
    <li><a href="/about">About this site</a></li>
  </ul>`,
    },
  ];
}

/**
 * 「そもそも代行が要らない」ブロック（仕入れ元別ページ用）。
 *
 * 新品が買える仕入れ元（Amazon/楽天/推奨ストア/その他通販）にだけ出す。
 * ヤフオク・メルカリ・ラクマは中古・一点物で、直販に同じ物が存在しないため出さない。
 * 直販側の商品価格も送料もこちらは持っていないので「直販のほうが安い」とは書かない。
 * 書けるのは自分で計算した「代行なら最低いくら手数料がかかるか」だけ。
 */
function buildStoreBlock(baseInput, data, perSource) {
  const rule = data.stores?.sourceRule;
  if (!rule) return "";

  const newGoods = perSource.filter((r) => (rule.suggestFor ?? []).includes(r.src));
  if (newGoods.length === 0) return "";

  const sug = calculateAll({ ...baseInput, source: newGoods[0].src }, data).storeSuggestion;
  if (!sug?.applicable) return "";

  const fees = newGoods
    .flatMap((r) => r.results.map((x) => x.proxyFeesOnly))
    .filter((n) => Number.isFinite(n));
  if (fees.length === 0) return "";

  return `
  <h2>${esc(sug.headingEn)}</h2>
  <p>The Amazon, Rakuten, recommended-shop and other-store rows above are places selling
  <strong>new, in-stock goods</strong>. For those a proxy is often unnecessary: some Japanese shops ship
  overseas themselves, and the proxy fees in that table &mdash; from ${yen(Math.min(...fees))} on this order,
  on top of the item price &mdash; disappear entirely.</p>
  <p>This does not apply to Yahoo! Auctions, Mercari or Rakuma. Those listings are second-hand or one-off,
  and no direct shop stocks the same item.</p>
  ${sug.stores.map((s) => `<p><a href="${esc(s.affiliateUrl)}" target="_blank" rel="noopener noreferrer sponsored">${esc(s.name)}</a> &mdash; ${esc(s.sellsEn)}</p>`).join("")}
  <p>${esc(sug.caveatEn)}</p>`;
}
