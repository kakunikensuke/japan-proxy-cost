/**
 * 「メルカリ・ヤフオクの商品ページの読み方」ガイド（2026-10-05、E2）。
 *
 * ■ 日本語を出すのはこのページだけの例外
 * 読者が実際の商品ページで見る文字そのものを示さないと役に立たないため、日本語を <span lang="ja"> に入れて出す。
 * ビルドの日本語混入チェックは lang="ja" の中だけを除外する（社内メモの漏れは引き続き止まる）。
 *
 * ■ 公式の定義だけを「定義」として書く
 * 状態の6段階・送料の負担はメルカリ公式ガイド、入札・即決はヤフオク公式ガイドの文言。
 * それ以外の出品用語は訳語として示し、ルールのように書かない。
 * 金額の節はすべて calculateAll の結果。
 */
import { calculateAll } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { amountOf } from "./enrich.mjs";
import { NW } from "./words.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const ja = (s) => `<span lang="ja">${s}</span>`;
const SRC = {
  mercariList: "https://help.jp.mercari.com/guide/articles/305/",
  mercariShipping: "https://help.jp.mercari.com/guide/articles/627/",
  yahooBid: "https://auctions.yahoo.co.jp/guide/m/app/navi/archives/buy_flow2.html",
};
const CHECKED = "2026-10-05";

// メルカリ公式ガイド「出品までの流れ」の商品の状態（6段階）。原文と、その訳
const CONDITIONS = [
  ["新品、未使用", "New, unused", "Bought not long ago and never used."],
  ["未使用に近い", "Almost unused", "Used only a few times, with no scratches or marks."],
  ["目立った傷や汚れなし", "No noticeable scratches or marks", "Has scratches or marks you would only see if you looked closely."],
  ["やや傷や汚れあり", "Some scratches or marks", "Scratches or marks that show it is second-hand."],
  ["傷や汚れあり", "Scratches or marks", "Large scratches or marks anyone would notice."],
  ["全体的に状態が悪い", "Poor overall", "Noticeable scratches, marks or damage across the whole item."],
];

// 出品の文によく出る言葉。公式の定義ではなく訳語なので、ルールのようには書かない
const WORDS = [
  ["未開封", "Unopened", "Still sealed. Worth checking whether the outer box itself is shown in the photos."],
  ["開封済み", "Opened", "The seal has been broken, even if the item was never used."],
  ["美品", "In very good condition", "The seller's own description, on top of the condition grade."],
  ["箱なし", "No box", "Matters for figures and games, where the box is part of the value."],
  ["箱傷み", "Box damage", "The item may be fine; the packaging is not."],
  ["欠品", "Missing parts", "Read the description for what exactly is missing."],
  ["付属品", "Accessories", "Often followed by a list. Anything not listed should be assumed missing."],
  ["動作確認済み", "Tested and working", "The seller says they have checked it works."],
  ["動作未確認", "Not tested", "The seller has not checked whether it works."],
  ["ジャンク", "Junk", "Sold as faulty or untested, as parts. Treat it as sold as seen."],
  ["ノークレーム・ノーリターン", "No complaints, no returns", "The seller is asking you not to raise problems after the sale."],
  ["専用", "Reserved", "A listing set aside for one named buyer. Others are expected not to buy it."],
  ["即購入可", "Buy without asking", "The seller is happy for you to buy without messaging first."],
  ["値下げ", "Price reduced", "Also used in requests: some sellers accept offers, some say they do not."],
  ["初版", "First edition", "Used for books and manga."],
  ["帯付き", "With obi", "The paper band around a Japanese book or CD, which collectors value."],
  ["特典", "Bonus item", "A shop or pre-order extra that came with the item."],
];

export function buildListingsGuide(data) {
  const { proxies } = data;
  const run = (o) => calculateAll({ itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light", ...o }, data);
  const P = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name }));

  // ---- 送料込みと着払い: 同じ¥10,000を払うとき、手数料の土台が変わる ----
  const incl = run({ source: "mercari", itemPriceJpy: 10000, domesticShippingJpy: 0 }).results;
  const extra = run({ source: "mercari", itemPriceJpy: 9300, domesticShippingJpy: 700 }).results;
  const shipRows = P.map((p) => {
    const a = incl.find((r) => r.proxyId === p.id), b = extra.find((r) => r.proxyId === p.id);
    return { name: p.name, a: a.grandTotal, b: b.grandTotal, d: a.grandTotal - b.grandTotal };
  });
  const differ = shipRows.filter((r) => r.d !== 0);

  // ---- ヤフオクとメルカリで代行手数料が違うか ----
  const srcRows = P.map((p) => {
    const y = run({ source: "yahoo_auction", itemPriceJpy: 10000 }).results.find((r) => r.proxyId === p.id);
    const m = run({ source: "mercari", itemPriceJpy: 10000 }).results.find((r) => r.proxyId === p.id);
    return { name: p.name, y: amountOf(y, "service"), m: amountOf(m, "service"), yt: y.grandTotal, mt: m.grandTotal };
  });
  const dearerOnYahoo = srcRows.filter((r) => r.y > r.m);
  const sameFee = srcRows.filter((r) => r.y === r.m);
  const yBest = [...srcRows].sort((a, b) => a.yt - b.yt)[0];
  const mBest = [...srcRows].sort((a, b) => a.mt - b.mt)[0];
  const lj = (a) => a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

  const body = `
  <h1>Reading a Mercari or Yahoo! Auctions listing</h1>
  <p>Proxy services let you buy from Japanese marketplaces, but the listings themselves are in Japanese, written by private sellers for Japanese buyers.
  This guide covers the parts that change what you get and what you pay: the condition grade, who pays the postage inside Japan, how bidding works,
  and the words sellers use in descriptions. The Japanese is shown as it appears on the page so you can match it.</p>

  <div class="verdict"><p class="v">Two things on a listing change what you pay: who pays the postage inside Japan, and whether it is an auction or a fixed price.</p>
  <p class="cap" style="margin:0">The condition grade changes what you get. All three are covered below, with the marketplaces' own definitions.</p></div>

  <h2>Mercari's six condition grades</h2>
  <p>Every Mercari listing carries one of six condition grades, chosen by the seller. These are Mercari's own definitions from its listing guide, translated.
  The grade is the seller's judgement, not an inspection, so read it together with the photos.</p>
  <table><thead><tr><th>On the listing</th><th>In English</th><th>Mercari's definition</th></tr></thead><tbody>
  ${CONDITIONS.map(([j, e, d]) => `<tr><td>${ja(j)}</td><td>${esc(e)}</td><td>${esc(d)}</td></tr>`).join("")}
  </tbody></table>
  <p>The difference between the second and third grades is the one that matters most for collectors: "almost unused" promises no marks at all, while
  "no noticeable scratches or marks" allows marks you would find on a close look. For bags, watches, jewellery and clothing, Mercari also lets sellers tick
  specific faults such as stains, smells or chips, so look for those on the listing too.</p>
  <p class="cap">Source: <a href="${SRC.mercariList}" rel="noopener">Mercari guide, listing an item</a>, checked ${CHECKED}. Mercari prices run from ¥300 to ¥9,999,999.</p>

  <h2>Who pays the postage inside Japan</h2>
  <p>Mercari sellers choose one of two options, and the listing shows which:</p>
  <ul>
    <li>${ja("送料込み")} (shipping included): the postage is in the price and the seller pays it.</li>
    <li>${ja("着払い")} (cash on delivery): the postage is not in the price, and the buyer pays it when the parcel arrives. Through a proxy, the parcel arrives at the proxy's warehouse.</li>
  </ul>
  <p>That second line is the domestic postage on this site's calculator. It is easy to compare a shipping-included listing with a cheaper one that is not,
  and get the wrong answer. Here are two listings that cost the same ¥10,000 in total before the proxy: one at ¥10,000 with shipping included, one at ¥9,300 with ¥700 to pay on delivery.
  Both priced to the United States by EMS, 1 kg:</p>
  <table><thead><tr><th>Service</th><th class="num">¥10,000, shipping included</th><th class="num">¥9,300 + ¥700 on delivery</th><th class="num">Difference</th></tr></thead><tbody>
  ${shipRows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${yen(r.a)}</td><td class="num">${yen(r.b)}</td><td class="num">${r.d === 0 ? "none" : (r.d > 0 ? "+" : "−") + yen(Math.abs(r.d))}</td></tr>`).join("")}
  </tbody></table>
  <p>${differ.length
    ? `With ${lj(differ.map((r) => esc(r.name)))}, the two are not the same: ${differ.length === 1 ? "its" : "their"} fee is worked out from the item price, so a price that already includes the postage pays the fee on the postage too.`
    : "With every service the two come to the same total, because none of them works its fee out from the item price."}
  ${shipRows.length - differ.length ? ` With ${lj(shipRows.filter((r) => r.d === 0).map((r) => esc(r.name)))}, the fee is a flat amount, so it makes no difference.` : ""}</p>
  <p class="cap">Source: <a href="${SRC.mercariShipping}" rel="noopener">Mercari guide, shipping-included items that arrive cash on delivery</a>, checked ${CHECKED}.</p>

  <h2>Bidding on Yahoo! Auctions</h2>
  <p>Yahoo! Auctions works differently from Mercari's fixed prices. According to its own beginner's guide:</p>
  <ul>
    <li>A bid is the most you are willing to pay, entered above the current price. Whoever has the highest bid when the auction ends wins it.</li>
    <li>Every bid is an automatic bid: the site bids for you against others, as cheaply as possible, up to the amount you entered. The guide recommends entering your real maximum.</li>
    <li>Some listings also have a buy-it-now price (${ja("即決価格")}). Bidding that amount wins the item straight away.</li>
    <li>Fixed-price items from Yahoo! Auctions stores show a purchase button (${ja("購入手続きへ")}) instead of a bid button.</li>
    <li>Winning creates a contract to pay. Only bid on things you mean to buy.</li>
  </ul>
  <p>Through a proxy, the proxy places the bid for you, and a won auction becomes your purchase through the proxy, with the same obligation to pay.
  ${/* 全社が同額なら表は何も伝えないので1文にする（2026-10-05時点は5社とも同額） */""}
  ${sameFee.length === srcRows.length
    ? `The proxy also charges its own fee for the purchase. On a ¥10,000 item it is the same for an auction win as for a Mercari purchase at all ${NW} services on this site:
  ${lj([...srcRows].sort((a, b) => a.y - b.y).map((r) => `${esc(r.name)} ${yen(r.y)}`))}.</p>`
    : `The proxy also charges its own fee for the purchase, and for some services that fee is not the same as for Mercari:</p>
  <table><thead><tr><th>Service</th><th class="num">Fee, Yahoo! Auctions</th><th class="num">Fee, Mercari</th><th class="num">Total, Yahoo! Auctions</th><th class="num">Total, Mercari</th></tr></thead><tbody>
  ${srcRows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${yen(r.y)}</td><td class="num">${yen(r.m)}</td><td class="num">${yen(r.yt)}</td><td class="num">${yen(r.mt)}</td></tr>`).join("")}
  </tbody></table>
  <p>${dearerOnYahoo.length ? `${lj(dearerOnYahoo.map((r) => esc(r.name)))} charge${dearerOnYahoo.length === 1 ? "s" : ""} more for an auction than for a Mercari purchase.` : ""}</p>`}
  <p>On a ¥10,000 item sent to the United States, ${esc(yBest.name)} is cheapest for an auction${yBest.name === mBest.name ? " and for Mercari alike" : ` and ${esc(mBest.name)} for Mercari`}, at ${yen(yBest.yt)}
  including ¥700 of postage inside Japan and EMS for 1 kg, before US duty.</p>
  <p class="cap">Source: <a href="${SRC.yahooBid}" rel="noopener">Yahoo! Auctions beginner's guide, bidding</a>, checked ${CHECKED}. Fees from each service's own pages.</p>

  <h2>Words you will see in descriptions</h2>
  <p>These are not official categories, just the words sellers commonly use. The English is a translation, and the note is what to check.</p>
  <table><thead><tr><th>On the listing</th><th>In English</th><th>What to check</th></tr></thead><tbody>
  ${WORDS.map(([j, e, d]) => `<tr><td>${ja(j)}</td><td>${esc(e)}</td><td>${esc(d)}</td></tr>`).join("")}
  </tbody></table>
  <p>Two of them deserve particular care through a proxy. Junk listings are sold as they are, and a fault found after delivery is your problem, not the seller's.
  And "tested and working" is the seller's word. Doorzo, for one, lists item inspection and an electronic check among its additional services; ask your service what it offers before relying on a description.</p>

  <h2>Before you buy</h2>
  <ul>
    <li>Check what the item contains against <a href="/what-you-cannot-ship-from-japan">what cannot be shipped</a>. A refused item is paid for and not sent.</li>
    <li>Work out the total, not the price: <a href="/guides/is-it-worth-it">when an item is worth the shipping</a> shows how much the overhead adds at each price.</li>
    <li>Compare services for the marketplace you are buying from: <a href="/cheapest-proxy-from-japan-to-united-states">cheapest proxy by marketplace</a>.</li>
  </ul>
  <nav class="related"><h2>Related</h2><ul><li><a href="/guides/how-proxy-buying-works">How proxy buying works, step by step</a></li><li><a href="/glossary">Glossary</a></li><li><a href="/faq">Frequently asked questions</a></li></ul></nav>`;

  return {
    path: "/guides/reading-mercari-and-yahoo-auctions-listings",
    layout: "content-first",
    prefill: { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 0, buyeePlan: "light" },
    title: "Reading a Mercari or Yahoo! Auctions listing: condition grades, postage and bidding",
    description: "Mercari's six condition grades, shipping included versus cash on delivery, how Yahoo! Auctions bidding works, and the words Japanese sellers use, with what each changes in the total.",
    body,
  };
}
