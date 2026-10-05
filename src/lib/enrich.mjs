/**
 * 各ページの本文を厚くする部品（2026-10-01）。
 *
 * ■ 経緯
 * AdSense に「有用性の低いコンテンツ」で再び落とされた時点で、対象127ページの本文は中央値367語、
 * 111ページが500語未満だった。比較ページ（54本）は「表1つと短い説明3段落」しかなかった。
 *
 * ■ 鉄則（pages.mjs と同じ）
 * 水増しはしない。ここにある関数はすべて calculateAll / lookupEmsRate / checkShippable を実際に回し、
 * **ページの条件（代行の組・配送先・重量・仕入れ元）を変えると数字も結論も変わるもの**だけを書く。
 * 言い回しだけ変えた定型文を足すと Google の "scaled content abuse" に当たる。
 *
 * ■ 税は「誰がいつ徴収するか」と「いくらか」を混ぜない
 * 事前徴収する会社は税が①に、しない会社は②に入る。費目ごとの差を出すときは①②を合算した
 * 「Import tax」で比べること。①だけで比べると「ZenMarket は税を¥2,880多く払う」という
 * 嘘の文になる（2026-10-01 まで比較ページに実際に出ていた）。
 */
import { calculateAll, lookupEmsRate, checkShippable } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { NW, NWC, NW_OTHERS, N_PROXIES, PROXY_TITLE_LIST, PROXY_TITLE_AMP, numberWord } from "./words.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
// 文中に入れるときは先頭の1文字だけ小文字にする（Japan などの固有名詞を壊さない）
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const listJoin = (arr) => arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const kg = (g) =>
 (g >= 1000 ? `${+(g / 1000).toFixed(1)} kg` : `${g} g`);

export const KEY_LABEL = {
  item: "Item",
  service: "Service fee",
  plan: "Protection plan",
  packing: "Packing",
  clearance: "Export clearance",
  payment: "Payment / deposit fee",
  domestic: "Postage inside Japan",
  intl: "International postage",
  tax: "Import tax",
};
const legendKey = (k) => (k === "import_tax" ? "tax" : k);

/** 費目の金額。税は①②を合算して1つの「Import tax」として扱う。 */
export function amountOf(r, key) {
  return [...r.payNow.lines, ...r.payOnDelivery.lines]
    .filter((l) => legendKey(l.key) === key)
    .reduce((s, l) => s + l.amount, 0);
}

const run = (input, data) => calculateAll(input, data);
const pick = (res, id) => res.results.find((r) => r.proxyId === id);

/** 静的ページ用の積み上げ横棒（計算機と同じ色分け） */
export function costBarHtml(r, max) {
  const lines = [...r.payNow.lines, ...r.payOnDelivery.lines].filter((l) => l.amount > 0);
  const label = lines.map((l) => `${KEY_LABEL[legendKey(l.key)] ?? l.labelEn} ${yen(l.amount)}`).join(", ");
  return `<div class="bar" role="img" aria-label="${esc(label)}">${lines.map((l) =>
    `<span class="k-${legendKey(l.key)}" style="width:${((l.amount / max) * 100).toFixed(2)}%"></span>`).join("")}</div>`;
}

export function legendHtml(results) {
  const keys = [...new Set(results.flatMap((r) => [...r.payNow.lines, ...r.payOnDelivery.lines]
    .filter((l) => l.amount > 0).map((l) => legendKey(l.key))))];
  const order = Object.keys(KEY_LABEL);
  keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return `<ul class="legend">${keys.map((k) => `<li><i class="k-${k}"></i>${KEY_LABEL[k]}</li>`).join("")}</ul>`;
}

// ===========================================================================
// 比較ページ（代行A vs 代行B × 配送先）
// ===========================================================================

const GRID_W = [500, 1000, 2000, 5000];
const GRID_PN = [[3000, 1], [3000, 3], [10000, 1], [10000, 3], [50000, 1], [50000, 3]];

/** 24通りの注文で2社を比べる。d = B − A（正なら A が安い）。 */
export function pairGrid(base, data, aId, bId) {
  const cells = [];
  for (const w of GRID_W) {
    for (const [p, n] of GRID_PN) {
      const res = run({ ...base, weightG: w, itemPriceJpy: p, itemCount: n }, data);
      const a = pick(res, aId), b = pick(res, bId);
      cells.push({ w, p, n, a: a.grandTotal, b: b.grandTotal, d: b.grandTotal - a.grandTotal });
    }
  }
  const winsA = cells.filter((c) => c.d > 0).length;
  const winsB = cells.filter((c) => c.d < 0).length;
  const ties = cells.length - winsA - winsB;
  const gaps = cells.map((c) => Math.abs(c.d)).filter((x) => x > 0);
  return { cells, winsA, winsB, ties, minGap: gaps.length ? Math.min(...gaps) : 0, maxGap: gaps.length ? Math.max(...gaps) : 0 };
}

export function verdictSentence(grid, A, B) {
  const n = grid.cells.length;
  if (grid.winsA === n) return `${esc(A)} came out cheaper on all ${n} orders we priced, by ${yen(grid.minGap)} to ${yen(grid.maxGap)}.`;
  if (grid.winsB === n) return `${esc(B)} came out cheaper on all ${n} orders we priced, by ${yen(grid.minGap)} to ${yen(grid.maxGap)}.`;
  if (grid.ties === n) return `The two cost exactly the same on all ${n} orders we priced.`;
  const parts = [];
  if (grid.winsA) parts.push(`${esc(A)} is cheaper on ${grid.winsA}`);
  if (grid.winsB) parts.push(`${esc(B)} on ${grid.winsB}`);
  if (grid.ties) parts.push(`${grid.ties} ${grid.ties === 1 ? "is a tie" : "are ties"}`);
  return `Neither wins outright. Of the ${n} orders we priced, ${listJoin(parts)}.`;
}

export function verdictBox(grid, A, B, aRes, bRes, cn) {
  const max = Math.max(aRes.grandTotal, bRes.grandTotal);
  return `<div class="verdict">
    <p class="v">${verdictSentence(grid, A, B)}</p>
    ${[aRes, bRes].map((r) => `<div class="vrow"><b>${esc(r.name)}</b>${costBarHtml(r, max)}<span class="t">${yen(r.grandTotal)}</span></div>`).join("")}
    ${legendHtml([aRes, bRes])}
    <p class="cap">The bars are one order: a ¥10,000 item from Mercari Japan, 1 kg packed, ¥700 postage inside Japan, EMS to ${esc(cn)}.</p>
  </div>`;
}

export function heatTable(grid, A, B) {
  const maxAbs = Math.max(grid.maxGap, 1);
  const cell = (c) => {
    if (c.d === 0) return `<td class="tie">tie</td>`;
    const t = Math.abs(c.d) / maxAbs;
    const aWins = c.d > 0;
    const bg = aWins ? `rgba(36,83,255,${(0.1 + t * 0.4).toFixed(3)})` : `rgba(14,159,154,${(0.1 + t * 0.4).toFixed(3)})`;
    return `<td class="${aWins ? "w-a" : "w-b"}" style="background:${bg}" title="${esc(aWins ? A : B)} cheaper by ${yen(Math.abs(c.d))}">${yen(Math.abs(c.d))}</td>`;
  };
  const head = GRID_PN.map(([p, n]) => `<th scope="col">${yen(p)}<br>${plural(n, "item")}</th>`).join("");
  const rows = GRID_W.map((w) => `<tr><th scope="row">${kg(w)}</th>${grid.cells.filter((c) => c.w === w).map(cell).join("")}</tr>`).join("");
  return `<table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>
  <ul class="heat-key"><li><i style="background:rgba(36,83,255,.4)"></i>${esc(A)} cheaper</li><li><i style="background:rgba(14,159,154,.4)"></i>${esc(B)} cheaper</li><li>Darker means a bigger gap. Each cell is the difference in the final total.</li></ul>`;
}

/** どの条件が差を一番動かすかを、軸ごとの平均変化量で言う。 */
export function driverText(grid, A, B) {
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const dOf = (w, p, n) => grid.cells.find((c) => c.w === w && c.p === p && c.n === n).d;
  const effects = [
    { axis: "the number of separate items", from: "one item", to: "three", e: avg(GRID_W.flatMap((w) => [3000, 10000, 50000].map((p) => dOf(w, p, 3) - dOf(w, p, 1)))) },
    { axis: "the price of the item", from: "¥3,000", to: "¥50,000", e: avg(GRID_W.flatMap((w) => [1, 3].map((n) => dOf(w, 50000, n) - dOf(w, 3000, n)))) },
    { axis: "the weight of the parcel", from: "500 g", to: "5 kg", e: avg(GRID_PN.map(([p, n]) => dOf(5000, p, n) - dOf(500, p, n))) },
  ].sort((x, y) => Math.abs(y.e) - Math.abs(x.e));

  const favour = (e) => (e > 0 ? A : B);
  const say = (x) => Math.abs(x.e) < 50
    ? `${x.axis} barely moves it`
    : `going from ${x.from} to ${x.to} shifts it by about ${yen(Math.abs(x.e))} towards ${esc(favour(x.e))}`;

  const top = effects[0];
  if (Math.abs(top.e) < 50) {
    return `<p>None of the three things we varied moves the gap by more than a few tens of yen. The difference between
    these two comes from a fixed charge, so the table above is a fair guide whatever you buy.</p>`;
  }
  return `<p>The gap moves most with ${top.axis}: ${say(top).replace(`${top.axis} `, "")}. After that, ${say(effects[1])},
  and ${say(effects[2])}. ${grid.winsA && grid.winsB
    ? `Because the lead changes hands inside this table, check your own order in the calculator below rather than relying on the headline.`
    : `The lead never changes hands inside this table, so the headline holds for ordinary orders.`}</p>`;
}

/** 費目ごとの差。税は①②を合算して比べる（タイミングの違いは別の節で書く）。 */
export function gapBreakdown(win, lose) {
  const keys = Object.keys(KEY_LABEL).filter((k) => amountOf(win, k) || amountOf(lose, k));
  const rows = keys.map((k) => {
    const a = amountOf(win, k), b = amountOf(lose, k);
    return `<tr><td>${KEY_LABEL[k]}</td><td class="num">${yen(a)}</td><td class="num">${yen(b)}</td><td class="num">${a === b ? "same" : (b > a ? "+" : "−") + yen(Math.abs(b - a))}</td></tr>`;
  }).join("");
  const diffs = keys.map((k) => ({ k, d: amountOf(lose, k) - amountOf(win, k) })).filter((x) => x.d !== 0).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  let text;
  if (!diffs.length) {
    text = `<p>Every line lands on the same figure for these two on this order, so the totals are level. What separates them is
    what they include and how they treat other orders, both covered below.</p>`;
  } else {
    const named = diffs.map((x) => `${lc(KEY_LABEL[x.k])} (${x.d > 0 ? esc(lose.name) : esc(win.name)} pays ${yen(Math.abs(x.d))} more)`);
    const taxSame = amountOf(win, "tax") === amountOf(lose, "tax");
    text = `<p>The whole difference comes from ${listJoin(named)}. ${diffs.length === 1
      ? "Nothing else on the bill differs."
      : `The largest of these is the ${lc(KEY_LABEL[diffs[0].k])}.`}
    ${taxSame && amountOf(win, "tax") > 0 && win.taxTiming !== lose.taxTiming
      ? `The import tax is the same ${yen(amountOf(win, "tax"))} for both. One collects it at checkout and the other leaves it to the courier, which changes when you pay but not how much.`
      : ""}</p>`;
  }
  return `${text}
  <table><thead><tr><th>Line</th><th class="num">${esc(win.name)}</th><th class="num">${esc(lose.name)}</th><th class="num">Difference</th></tr></thead><tbody>${rows}
  <tr><td><strong>Final total</strong></td><td class="num"><strong>${yen(win.grandTotal)}</strong></td><td class="num"><strong>${yen(lose.grandTotal)}</strong></td><td class="num"><strong>${lose.grandTotal === win.grandTotal ? "same" : "+" + yen(lose.grandTotal - win.grandTotal)}</strong></td></tr></tbody></table>`;
}

export const SOURCE_NAMES = {
  yahoo_auction: "Yahoo! Auctions",
  mercari: "Mercari Japan",
  rakuma: "Rakuten Rakuma",
  amazon_jp: "Amazon.co.jp",
  rakuten: "Rakuten Ichiba",
  recommended: "ZenMarket recommended stores",
  other_shop: "Other Japanese shops",
};

/** 仕入れ元ごとにどちらが安いか */
export function marketplaceDuel(base, data, A, B) {
  const rows = Object.entries(SOURCE_NAMES).map(([src, label]) => {
    const res = run({ ...base, source: src }, data);
    const a = pick(res, A.id), b = pick(res, B.id);
    return { src, label, a: a.grandTotal, b: b.grandTotal };
  });
  const aWins = rows.filter((r) => r.a < r.b), bWins = rows.filter((r) => r.b < r.a), ties = rows.filter((r) => r.a === r.b);
  const tr = rows.map((r) => `<tr><td>${r.label}</td><td class="num">${yen(r.a)}</td><td class="num">${yen(r.b)}</td><td>${r.a === r.b ? "tie" : esc(r.a < r.b ? A.name : B.name) + " by " + yen(Math.abs(r.a - r.b))}</td></tr>`).join("");
  const spreadA = Math.max(...rows.map((r) => r.a)) - Math.min(...rows.map((r) => r.a));
  const spreadB = Math.max(...rows.map((r) => r.b)) - Math.min(...rows.map((r) => r.b));

  let text;
  if (aWins.length === rows.length || bWins.length === rows.length) {
    const w = aWins.length ? A : B;
    text = `${esc(w.name)} is cheaper whichever of the ${rows.length} marketplaces you buy from.`;
  } else {
    const parts = [];
    if (aWins.length) parts.push(`${esc(A.name)} wins on ${listJoin(aWins.map((r) => r.label))}`);
    if (bWins.length) parts.push(`${esc(B.name)} wins on ${listJoin(bWins.map((r) => r.label))}`);
    if (ties.length) parts.push(`${listJoin(ties.map((r) => r.label))} ${ties.length === 1 ? "is a tie" : "are ties"}`);
    text = `Where you buy changes the answer: ${parts.join("; ")}.`;
  }
  const spreadOf = (P, sp) => sp === 0 ? `${esc(P.name)}'s total is the same whatever the marketplace` : `${esc(P.name)}'s moves by up to ${yen(sp)} depending on where it buys`;
  return `<p>${text} ${spreadOf(A, spreadA)}, while ${spreadOf(B, spreadB)}. All rows are the same ¥10,000, 1 kg order.</p>
  <table><thead><tr><th>Buying from</th><th class="num">${esc(A.name)}</th><th class="num">${esc(B.name)}</th><th>Cheaper</th></tr></thead><tbody>${tr}</tbody></table>`;
}

const VERDICT_WORD = { ok: "Ships", conditional: "With conditions", carrier_limited: "With conditions", unknown: "Not stated", prohibited: "Refused" };

/** 8属性について、この配送先で2社がそれぞれ送れるか */
export function shipRulesDuel(cc, cn, data, A, B) {
  const { restrictions } = data;
  const rows = restrictions.attributes.map((attr) => {
    const a = checkShippable([attr.id], { proxyId: A.id, destination: cc }, restrictions);
    const b = checkShippable([attr.id], { proxyId: B.id, destination: cc }, restrictions);
    const dest = restrictions.byDestination?.[cc]?.[attr.id];
    return { attr, a: a.level, b: b.level, dest };
  });
  const differ = rows.filter((r) => VERDICT_WORD[r.a] !== VERDICT_WORD[r.b]);
  const bothRefuse = rows.filter((r) => r.a === "prohibited" && r.b === "prohibited");
  const destRules = rows.filter((r) => r.dest);
  const cls = (lvl) => lvl === "prohibited" ? ' style="color:var(--red);font-weight:600"' : lvl === "ok" ? ' style="color:var(--green);font-weight:600"' : "";
  const tr = rows.map((r) => `<tr${VERDICT_WORD[r.a] !== VERDICT_WORD[r.b] ? ' class="row-exception"' : ""}><td>${esc(r.attr.labelEn)}</td><td${cls(r.a)}>${VERDICT_WORD[r.a]}</td><td${cls(r.b)}>${VERDICT_WORD[r.b]}</td></tr>`).join("");

  const sentences = [];
  sentences.push(differ.length === 0
    ? `On this route the two give the same answer for all ${rows.length} kinds of restricted item we track, so the choice between them comes down to price.`
    : `They disagree on ${plural(differ.length, "category", "categories")}: ${listJoin(differ.map((r) => `${esc(r.attr.seoLabelEn ?? lc(r.attr.labelEn))} (${esc(A.name)}: ${VERDICT_WORD[r.a].toLowerCase()}, ${esc(B.name)}: ${VERDICT_WORD[r.b].toLowerCase()})`))}. If your item falls into one of those, that matters more than the price gap above.`);
  const noun = (attr) => esc(attr.seoLabelEn ?? lc(attr.labelEn));
  if (bothRefuse.length) sentences.push(`Both refuse ${listJoin(bothRefuse.map((r) => noun(r.attr)))} on this route.`);
  if (destRules.length) sentences.push(`Japan Post itself restricts ${listJoin(destRules.map((r) => noun(r.attr)))} on parcels to ${esc(cn)}, so switching service does not get around it.`);

  return `<p>${sentences.join(" ")}</p>
  <table><thead><tr><th>If the parcel contains</th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">Highlighted rows are where the two differ. "Not stated" means the company publishes no rule, so the decision is made at the warehouse after you have paid. Each company's own wording is quoted on the <a href="/what-you-cannot-ship-from-japan">what you cannot ship</a> page.</p>`;
}

/** 税を「いつ」払うか。安い注文と高い注文の2点で、2社の扱いを比べる。 */
export function taxTimingDuel(cc, cn, data, base, A, B) {
  const country = data.importTax.countries[cc];
  if (!country) return "";
  if (country.vatRate === 0) {
    return `<p>${esc(cn)} charges no import tax on general goods, so there is nothing for either service to collect and nothing
    to pay at the door. The totals above are the whole cost.</p>`;
  }
  const label = country.vatLabel ?? "import VAT";
  const prices = [10000, 150000];
  const rows = prices.map((p) => {
    const res = run({ ...base, itemPriceJpy: p }, data);
    return { p, a: pick(res, A.id), b: pick(res, B.id) };
  });
  const timing = (r) => r.taxTiming === "prepaid" ? "Collected at checkout" : r.payOnDelivery.quantified ? "Paid on arrival" : "On arrival, not estimated";
  const tr = rows.map((x) => `<tr><td>${yen(x.p)} item</td><td>${timing(x.a)}</td><td>${timing(x.b)}</td></tr>`).join("");

  const prepRule = (id) => (data.proxies.proxies.find((p) => p.id === id).taxPrepay ?? [])
    .find((t) => t.country === cc && t.rate && (!t.onlyCarriers || t.onlyCarriers.includes("ems")));
  // 「事前徴収すると書いているが税率を公開していない」会社を「徴収しない」と書かないこと
  const unpublished = (id) => (data.proxies.proxies.find((p) => p.id === id).taxPrepay ?? [])
    .some((t) => t.country === cc && (t.unverifiedRate || t.rate == null) && (!t.onlyCarriers || t.onlyCarriers.includes("ems")));
  const describe = (P) => {
    const r = prepRule(P.id);
    if (!r && unpublished(P.id)) return `${esc(P.name)} says it collects it at checkout for ${esc(cn)} but does not publish the rate, so the totals here assume you pay on arrival`;
    if (!r) return `${esc(P.name)} does not collect it up front on EMS parcels to ${esc(cn)}, so it is paid to the courier when the parcel lands`;
    const th = r.thresholdValue ? ` on orders ${r.thresholdRule === "atOrUnder" ? "up to" : "under"} ${r.thresholdCurrency} ${r.thresholdValue.toLocaleString("en-US")}` : "";
    return `${esc(P.name)} collects ${esc(r.tax)} at ${pct(r.rate, r.rate * 100 % 1 ? 1 : 0)} at checkout${th}`;
  };
  const notEstimated = rows.some((x) => !x.a.payOnDelivery.quantified || !x.b.payOnDelivery.quantified);
  return `<p>${describe(A)}. ${describe(B)}.
  ${notEstimated && country.vatRate == null
    ? `${esc(cn)}'s charge depends on the item (${esc(country.vatNoteEn ?? "rates vary")}), so it is left out of the totals rather than guessed.`
    : `The amount of ${esc(label)} is set by ${esc(cn)}, not by either company, so it is the same whichever you use.`}
  Where it is paid on arrival, the courier usually adds its own customs handling charge on top, which neither company publishes and which is not in the totals here.</p>
  <table><thead><tr><th>Order</th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>${tr}</tbody></table>`;
}

function storageText(p) {
  const s = p.storage ?? {};
  const bits = [];
  bits.push(s.freeDays ? `${s.freeDays} days free` : "free period not published");
  if (s.overstayPerDayPerItem) bits.push(`then ${yen(s.overstayPerDayPerItem)} per item per day`);
  if (s.overstayPerKgPerDay) bits.push(`then ${yen(s.overstayPerKgPerDay)} per kg per day`);
  if (s.overstayDailyByWeightG) bits.push(`then from ${yen(s.overstayDailyByWeightG[0].amount)} a day by weight`);
  if (s.weeklyBySize) bits.push(`then from ${yen(s.weeklyBySize.small.parcel)} a week by size`);
  if (s.maxDays) bits.push(`disposed of after ${s.maxDays} days`);
  else if (s.disposeAfterDays) bits.push(`disposed of after ${s.disposeAfterDays} days`);
  return bits.join(", ");
}

function feeUnitText(p) {
  const u = p.serviceFee?.unit;
  if (u === "order") return "per purchase at auctions and flea markets, per order at shops";
  return "per item";
}

function packingText(p) {
  const k = p.packingFee ?? {};
  if (k.type === "included") return "included";
  if (k.type === "weight") return `${yen(k.baseAmount)} up to ${kg(k.baseUpToG)}, then ${yen(k.perAdditionalKg)} per extra kg`;
  return "charged, price not published";
}

function paymentText(p) {
  const f = p.paymentFee ?? {};
  if (f.type === "none") return "none";
  if (f.type === "rate") return `${pct(f.rate, 1)} of the whole transaction`;
  return "not published";
}

/** 2社の、配送先によらない条件（保管・課金単位・梱包・決済手数料） */
export function termsDuel(data, A, B) {
  const pa = data.proxies.proxies.find((p) => p.id === A.id);
  const pb = data.proxies.proxies.find((p) => p.id === B.id);
  const rows = [
    ["Service fee charged", feeUnitText(pa), feeUnitText(pb)],
    ["Packing and consolidation", packingText(pa), packingText(pb)],
    ["Payment / deposit fee", paymentText(pa), paymentText(pb)],
    ["Storage at the warehouse", storageText(pa), storageText(pb)],
  ];
  const fa = pa.storage?.freeDays, fb = pb.storage?.freeDays;
  const longer = fa && fb && fa !== fb ? (fa > fb ? A : B) : null;
  return `<table><thead><tr><th></th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>${rows.map(([h, a, b]) =>
    `<tr><td><strong>${h}</strong></td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</tbody></table>
  <p>${longer
    ? `${esc(longer.name)} holds purchases free for longer (${Math.max(fa, fb)} days against ${Math.min(fa, fb)}). That window is what lets you collect several purchases over a few weeks and send them in one box, which usually saves more in postage than the difference in service fees.`
    : fa && fb ? `Both hold purchases free for ${fa} days, long enough to collect several purchases and send them together.` : ""}</p>`;
}

// ===========================================================================
// 仕入れ元別ページ（配送先ごと）
// ===========================================================================

/** 商品価格を変えたとき、どこが最安か（オークション品と新品ショップの2系統） */
export function priceLadder(base, data, cn) {
  const prices = [3000, 10000, 30000, 100000];
  const sources = ["yahoo_auction", "amazon_jp"];
  const grid = prices.map((p) => ({ p, by: sources.map((s) => run({ ...base, source: s, itemPriceJpy: p }, data).results[0]) }));
  const tr = grid.map((g) => `<tr><td>${yen(g.p)}</td>${g.by.map((r) => `<td>${esc(r.name)}, ${yen(r.grandTotal)}${r.grandTotalIsMinimum ? " +duty" : ""}</td>`).join("")}</tr>`).join("");
  const winners = (i) => [...new Set(grid.map((g) => g.by[i].name))];
  const say = (i, label) => winners(i).length === 1
    ? `For ${label}, ${esc(winners(i)[0])} stays cheapest from ${yen(prices[0])} all the way to ${yen(prices[prices.length - 1])}.`
    : `For ${label}, the cheapest service changes with the price: ${grid.map((g) => `${esc(g.by[i].name)} at ${yen(g.p)}`).join(", ")}.`;
  const overhead = (r, p) => r.grandTotal - p;
  return `<p>${say(0, "an auction win")} ${say(1, "a new item from a shop")}
  On a ${yen(prices[0])} item the cost of getting it to ${esc(cn)} is ${yen(overhead(grid[0].by[0], prices[0]))}, ${Math.round((overhead(grid[0].by[0], prices[0]) / prices[0]) * 100)}% of the item; on a ${yen(prices[prices.length - 1])} item it is ${yen(overhead(grid[grid.length - 1].by[0], prices[prices.length - 1]))}, or ${Math.round((overhead(grid[grid.length - 1].by[0], prices[prices.length - 1]) / prices[prices.length - 1]) * 100)}%.</p>
  <table><thead><tr><th>Item price</th><th>Cheapest from Yahoo! Auctions</th><th>Cheapest from Amazon.co.jp</th></tr></thead><tbody>${tr}</tbody></table>`;
}

/** 重さを変えたとき、どこが最安か */
export function weightLadder(base, data) {
  const ws = [500, 1000, 2000, 5000];
  const rows = ws.map((w) => ({ w, r: run({ ...base, weightG: w }, data) }));
  const tr = rows.map((x) => `<tr><td>${kg(x.w)}</td><td class="num">${x.r.shipping.amount ? yen(x.r.shipping.amount) : "—"}</td><td>${esc(x.r.results[0].name)}</td><td class="num">${yen(x.r.results[0].grandTotal)}</td><td class="num">${yen(x.r.results[x.r.results.length - 1].grandTotal - x.r.results[0].grandTotal)}</td></tr>`).join("");
  const names = [...new Set(rows.map((x) => x.r.results[0].name))];
  return `<p>${names.length === 1
    ? `${esc(names[0])} stays cheapest from 500 g to 5 kg on a Yahoo! Auctions order. What grows is the gap to the most expensive option, from ${yen(rows[0].r.results.at(-1).grandTotal - rows[0].r.results[0].grandTotal)} to ${yen(rows.at(-1).r.results.at(-1).grandTotal - rows.at(-1).r.results[0].grandTotal)}.`
    : `The cheapest service changes with weight: ${rows.map((x) => `${esc(x.r.results[0].name)} at ${kg(x.w)}`).join(", ")}. A service that charges for packing by weight falls behind as the parcel gets heavier.`}</p>
  <table><thead><tr><th>Parcel</th><th class="num">EMS postage</th><th>Cheapest</th><th class="num">Total</th><th class="num">Gap to dearest</th></tr></thead><tbody>${tr}</tbody></table>`;
}

// ===========================================================================
// 重量別ページ
// ===========================================================================

/** まとめて送るか別々に送るか。EMSは重量帯課金なので、実額で比べる。 */
export function togetherOrApart(ems, cc, g, cn) {
  const rate = (w) => lookupEmsRate(ems, cc, w).amount;
  const rows = [];
  for (const n of [2, 3]) {
    if (n * g > 5000 || rate(g) == null || rate(n * g) == null) continue;
    rows.push({ label: `${n} of these`, separate: n * rate(g), together: rate(n * g), tw: n * g });
  }
  if (!rows.length && g >= 1000 && rate(g / 2) != null && rate(g) != null) {
    // 重い荷物は「まとめる」側の表が引けないので、逆に2つに分けた場合を出す
    const half = g / 2;
    return `<p>At ${kg(g)} there is no heavier band in our data to combine into, so here is the opposite question: is it cheaper to
    split it in two? Two ${kg(half)} parcels cost ${yen(2 * rate(half))} in EMS to ${esc(cn)}, against ${yen(rate(g))} for one ${kg(g)} box.
    ${2 * rate(half) > rate(g) ? `Keeping it in one box saves ${yen(2 * rate(half) - rate(g))}.` : `Splitting saves ${yen(rate(g) - 2 * rate(half))}.`}
    One box also means one export clearance, one payment and one tracking number.</p>`;
  }
  if (!rows.length) return "";
  const tr = rows.map((r) => `<tr><td>${r.label}</td><td class="num">${yen(r.separate)}</td><td class="num">${yen(r.together)} <small>(${kg(r.tw)})</small></td><td class="num"><strong>${yen(r.separate - r.together)}</strong></td></tr>`).join("");
  const best = rows[rows.length - 1];
  return `<p>Buying more than one? Sent separately, ${best.label.replace("of these", "")} parcels like this cost ${yen(best.separate)} in EMS to
  ${esc(cn)}. Put in one box, they cost ${yen(best.together)}, a saving of <strong>${yen(best.separate - best.together)}</strong>
  (${Math.round(((best.separate - best.together) / best.separate) * 100)}%). That is the case for collecting purchases at the warehouse
  and asking for them to be consolidated.</p>
  <table><thead><tr><th>Parcels</th><th class="num">Sent separately</th><th class="num">In one box</th><th class="num">Saved</th></tr></thead><tbody>${tr}</tbody></table>`;
}

/** この重さ・この国で、商品価格を変えると何が起きるか */
export function priceAtWeight(base, data, cn) {
  const prices = [3000, 10000, 30000, 100000];
  const rows = prices.map((p) => ({ p, r: run({ ...base, itemPriceJpy: p }, data).results[0] }));
  const tr = rows.map(({ p, r }) => {
    const tax = amountOf(r, "tax");
    return `<tr><td>${yen(p)}</td><td>${esc(r.name)}</td><td class="num">${r.grandTotalIsMinimum ? "not estimated" : yen(tax)}</td><td class="num">${yen(r.grandTotal)}${r.grandTotalIsMinimum ? " +duty" : ""}</td><td class="num">${Math.round(((r.grandTotal - p) / p) * 100)}%</td></tr>`;
  }).join("");
  const first = rows[0], last = rows[rows.length - 1];
  return `<p>The postage is fixed by weight, so it weighs heavily on a cheap item and hardly at all on an expensive one. At this weight to
  ${esc(cn)}, everything on top of a ${yen(first.p)} item adds ${Math.round(((first.r.grandTotal - first.p) / first.p) * 100)}% to its price;
  on a ${yen(last.p)} item it adds ${Math.round(((last.r.grandTotal - last.p) / last.p) * 100)}%.
  ${[...new Set(rows.map((x) => x.r.name))].length > 1 ? `The cheapest service also changes along the way, from ${esc(first.r.name)} to ${esc(last.r.name)}.` : `${esc(first.r.name)} is cheapest at every price on this list.`}</p>
  <table><thead><tr><th>Item price</th><th>Cheapest</th><th class="num">Import tax</th><th class="num">Total</th><th class="num">On top of the item</th></tr></thead><tbody>${tr}</tbody></table>`;
}

/** 4社の費目を横に並べた表 */
export function perServiceLines(results) {
  const keys = ["service", "packing", "payment", "domestic", "intl", "tax"].filter((k) => results.some((r) => amountOf(r, k)));
  return `<table><thead><tr><th>Service</th>${keys.map((k) => `<th class="num">${KEY_LABEL[k]}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>${
    results.map((r) => `<tr><td>${esc(r.name)}</td>${keys.map((k) => `<td class="num">${amountOf(r, k) ? yen(amountOf(r, k)) : "—"}</td>`).join("")}<td class="num"><strong>${yen(r.grandTotal)}</strong></td></tr>`).join("")}</tbody></table>`;
}

// ===========================================================================
// 輸入税ページ
// ===========================================================================

export function taxLadder(cc, data) {
  const country = data.importTax.countries[cc];
  const prices = [3000, 10000, 20000, 50000, 100000, 200000];
  const base = { source: "mercari", itemCount: 1, weightG: 1000, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" };
  const rows = prices.map((p) => ({ p, res: run({ ...base, itemPriceJpy: p }, data) }));
  const ids = data.proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name }));
  const mark = (r) => r.taxTiming === "prepaid" ? "At checkout" : !r.payOnDelivery.quantified ? "Not estimated" : amountOf(r, "tax") > 0 ? "On arrival" : "None due";

  const tr = rows.map(({ p, res }) => {
    const best = res.results[0];
    const tax = amountOf(best, "tax");
    return `<tr><td>${yen(p)}</td><td class="num">${best.grandTotalIsMinimum ? "—" : yen(tax)}</td><td class="num">${best.grandTotalIsMinimum || !tax ? "—" : pct(tax / p, 1)}</td>${ids.map((x) => `<td>${mark(pick(res, x.id))}</td>`).join("")}</tr>`;
  }).join("");

  // 免税枠を超える価格帯を、実際に税額が0から動くところで探す
  const firstTaxed = rows.find(({ res }) => amountOf(res.results[0], "tax") > 0);
  const lastFree = [...rows].reverse().find(({ res }) => !res.results[0].grandTotalIsMinimum && amountOf(res.results[0], "tax") === 0);
  let text;
  if (country.vatRate === 0) {
    text = `No import tax is charged at any price on this list. The only costs are the proxy's and the postage.`;
  } else if (country.vatRate == null) {
    text = `${esc(country.name)}'s charge on arrival depends on the item or on where you live (${esc(country.vatNoteEn ?? "it varies")}), so the totals leave it out rather than guess. The timing columns still apply: they show which services take it at checkout.`;
  } else if (lastFree && firstTaxed && lastFree.p < firstTaxed.p) {
    text = `Tax starts somewhere between ${yen(lastFree.p)} and ${yen(firstTaxed.p)}, where the item plus its postage passes ${esc(country.deMinimis?.thresholdLabelEn ?? "the duty-free limit")}. From there it is ${pct(country.vatRate, country.vatRate * 100 % 1 ? 1 : 0)} of the goods and the international postage, which is why it comes out at more than ${pct(country.vatRate, 0)} of the item price alone.`;
  } else {
    text = `Tax applies from the first yen at ${pct(country.vatRate, country.vatRate * 100 % 1 ? 1 : 0)}, and it is charged on the goods plus the international postage, so on a cheap item it comes to well over ${pct(country.vatRate, 0)} of the item price. On ${yen(prices[0])} it is ${pct(amountOf(rows[0].res.results[0], "tax") / prices[0], 1)} of the item; on ${yen(prices.at(-1))} it is ${pct(amountOf(rows.at(-1).res.results[0], "tax") / prices.at(-1), 1)}.`;
  }

  // 事前徴収が価格で切り替わる会社
  const switches = ids.map((x) => {
    const t = rows.map(({ res }) => pick(res, x.id).taxTiming);
    const i = t.findIndex((v, k) => k > 0 && v !== t[k - 1]);
    return i > 0 ? `${esc(x.name)} stops collecting it at checkout between ${yen(prices[i - 1])} and ${yen(prices[i])}` : null;
  }).filter(Boolean);

  return `<p>${text}${switches.length ? ` ${listJoin(switches)}, because its up-front collection only covers orders below a set value. Above that, the parcel goes through customs as a formal import and you settle with the courier.` : ""}</p>
  <table><thead><tr><th>Item price</th><th class="num">Tax</th><th class="num">Share of item</th>${ids.map((x) => `<th>${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">A Mercari Japan item, 1 kg packed, EMS. Tax is shown for the cheapest service; the last ${NW} columns show when each service takes it.</p>`;
}

export function thresholdsInYen(cc, data) {
  const country = data.importTax.countries[cc];
  const fx = data.importTax.fx;
  const items = [];
  const dm = country.deMinimis ?? {};
  if (dm.status === "active" && dm.approxJpy) items.push(`${esc(country.name)}'s duty-free limit of ${esc(dm.thresholdLabelEn)} is about ${yen(dm.approxJpy)} (rate as of ${esc(dm.fx?.asOf ?? "")}). It is tested against the item plus postage, not the item alone.`);
  else if (dm.status === "active") items.push(`${esc(country.name)}'s duty-free limit is ${esc(dm.thresholdLabelEn)}.${country.vatRate === 0.2 && cc === "GB" ? " It covers customs duty only: VAT is due on every parcel regardless." : ""}`);
  if (dm.status === "removed") items.push(`${esc(country.name)} has no duty-free limit for low-value parcels${dm.removedOn ? ` (abolished ${esc(dm.removedOn)})` : ""}${dm.flatDutyEur ? `, and low-value e-commerce parcels pay a flat €${dm.flatDutyEur} duty per item` : ""}.`);
  if (dm.status === "suspended") items.push(`The former US$${dm.formerThresholdUsd} duty-free limit has been suspended since ${esc(dm.suspendedSince)}, so every parcel goes through formal entry.`);
  for (const p of data.proxies.proxies) {
    const r = (p.taxPrepay ?? []).find((t) => t.country === cc && t.rate && t.thresholdValue && (!t.onlyCarriers || t.onlyCarriers.includes("ems")));
    if (!r) continue;
    const jpy = fx?.jpyPer?.[r.thresholdCurrency];
    items.push(`${esc(p.shortName ?? p.name)} collects ${esc(r.tax)} up front only on orders ${r.thresholdRule === "atOrUnder" ? "up to" : "under"} ${r.thresholdCurrency} ${r.thresholdValue.toLocaleString("en-US")}${jpy ? `, about ${yen(r.thresholdValue * jpy)} at ${esc(fx.asOf)} rates` : ""}.`);
  }
  if (!items.length) return "";
  return `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>
  <p class="cap">Exchange-rate conversions are approximate. Near a limit, a move in the rate can put an order either side of it, and the calculator warns you when that is the case.</p>`;
}

// ===========================================================================
// 各社の料金ページ
// ===========================================================================

export function proxyAcrossCountries(proxy, data, countries, countryName) {
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, domesticShippingJpy: 700, buyeePlan: "light" };
  const name = proxy.shortName ?? proxy.name;
  const rows = countries.map((cc) => {
    const res = run({ ...base, destination: cc }, data);
    const rank = res.results.findIndex((r) => r.proxyId === proxy.id) + 1;
    const mine = pick(res, proxy.id);
    const best = res.results[0];
    const tiedBest = mine.grandTotal === best.grandTotal;
    return { cc, cn: countryName(cc), rank: tiedBest ? 1 : rank, mine, best };
  });
  const wins = rows.filter((r) => r.rank === 1);
  const tr = rows.map((r) => `<tr><td>${esc(r.cn)}</td><td class="num">${yen(r.mine.grandTotal)}</td><td>${r.rank === 1 ? "<strong>cheapest</strong>" : `${r.rank}${["", "st", "nd", "rd", "th"][Math.min(r.rank, 4)]}`}</td><td>${r.rank === 1 ? "—" : `${esc(r.best.name)}, ${yen(r.mine.grandTotal - r.best.grandTotal)} less`}</td></tr>`).join("");
  return `<p>On the same ¥10,000, 1 kg Mercari order, ${esc(name)} is the cheapest (or joint cheapest) of the ${NW} for
  ${plural(wins.length, "destination")} out of ${rows.length}${wins.length ? `: ${listJoin(wins.map((w) => esc(w.cn)))}` : ""}.
  The postage is the same whichever service you use, so the differences below come from fees and from how each service handles tax.</p>
  <table><thead><tr><th>Ship to</th><th class="num">${esc(name)}</th><th>Rank</th><th>Cheapest instead</th></tr></thead><tbody>${tr}</tbody></table>`;
}

export function proxyPriceCurve(proxy, data) {
  const base = { source: "mercari", itemCount: 1, weightG: 1000, destination: "GB", domesticShippingJpy: 700, buyeePlan: "light" };
  const name = proxy.shortName ?? proxy.name;
  const prices = [3000, 10000, 50000, 100000];
  const rows = prices.map((p) => {
    const res = run({ ...base, itemPriceJpy: p }, data);
    const mine = pick(res, proxy.id);
    return { p, mine, best: res.results[0], fees: mine.grandTotal - p - amountOf(mine, "tax") - amountOf(mine, "intl") - amountOf(mine, "domestic") };
  });
  const tr = rows.map((r) => `<tr><td>${yen(r.p)}</td><td class="num">${yen(r.fees)}</td><td class="num">${yen(r.mine.grandTotal)}</td><td>${r.mine.grandTotal === r.best.grandTotal ? "<strong>cheapest</strong>" : `+${yen(r.mine.grandTotal - r.best.grandTotal)} vs ${esc(r.best.name)}`}</td></tr>`).join("");
  const grows = rows.at(-1).fees > rows[0].fees;
  return `<p>${grows
    ? `${esc(name)}'s own charges grow with the price of the item, from ${yen(rows[0].fees)} on a ${yen(prices[0])} item to ${yen(rows.at(-1).fees)} on ${yen(prices.at(-1))}, because part of what it charges is a percentage.`
    : `${esc(name)}'s own charges stay at ${yen(rows[0].fees)} whatever the item costs, because none of them is a percentage of the price.`}
  The table uses the same 1 kg Mercari order to the United Kingdom at four prices; "own charges" excludes the postage and the tax, which do not depend on the service.</p>
  <table><thead><tr><th>Item price</th><th class="num">${esc(name)}'s own charges</th><th class="num">Total</th><th>Against the cheapest</th></tr></thead><tbody>${tr}</tbody></table>`;
}
