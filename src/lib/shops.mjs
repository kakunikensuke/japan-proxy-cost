/**
 * 中古アニメ・同人ショップの買い方ガイド（2026-10-05、E4）。
 *
 * ■ 書いてよいのは確認できたことだけ
 * ・店が自分で海外発送するか: まんだらけ（英語の配送方法ページ）・駿河屋（駿河屋.com の配送可能エリア）だけ確認。
 *   らしんばん・とらのあな・メロンブックスは公式の情報が見つからなかったので「見つからなかった」と書く
 * ・代行が店の専用ページを持つか: 各社サイトのリンクで確認したものだけ（2026-10-05）。
 *   FROM JAPAN の「MANDARAKE」はまんだらけのメルカリ店、「LASHINBAN」は FJ Mall の出品者なので、そう書く
 * 金額は calculateAll の結果。
 */
import { calculateAll } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { NW } from "./words.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const lj = (a) => a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
const CHECKED = "2026-10-05";

const SHOPS = [
  {
    name: "Suruga-ya", what: "second-hand games, figures, anime goods, books and CDs",
    direct: "yes", directEn: "Yes, through its overseas site suruga-ya.com, whose delivery list covers all nine countries on this site. It also posts a separate notice about shipping to the United States, which we could not open.",
    directUrl: "https://www.suruga-ya.com/ja/feature/delivery_area/index.html",
    proxies: [["fromjapan", "Suruga-ya search"], ["zenmarket", "Suruga-ya page"], ["neokyo", "Suruga-ya guide"], ["doorzo", "Suruga-ya store"]],
  },
  {
    name: "Mandarake", what: "second-hand manga, doujinshi, figures, cels and collectables",
    direct: "yes", directEn: "Yes. Mandarake's own English site offers EMS, DHL Express and other methods, and lists which work for each country.",
    directUrl: "https://earth.mandarake.co.jp/help/en/shipping_options-en.html",
    proxies: [["fromjapan", "Mandarake's shop on Mercari"]],
  },
  {
    name: "Lashinbang", what: "second-hand anime goods, figures and doujinshi",
    direct: "unknown", directEn: "We found no official information on shipping abroad.",
    proxies: [["fromjapan", "Lashinbang's listings on FJ Mall"], ["zenmarket", "Lashinbang page"], ["doorzo", "Lashinbang store"]],
  },
  {
    name: "Toranoana", what: "doujinshi and creator goods",
    direct: "unknown", directEn: "We found no official information on shipping abroad.",
    proxies: [["zenmarket", "Toranoana page"]],
  },
  {
    name: "Melonbooks", what: "doujinshi, manga and games",
    direct: "unknown", directEn: "We found no official information on shipping abroad.",
    proxies: [["zenmarket", "listed among its recommended stores"]],
  },
];

export function buildShopsGuide(data) {
  const { proxies } = data;
  const P = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name }));
  const nameOf = (id) => P.find((p) => p.id === id)?.name ?? id;
  const direct = SHOPS.filter((s) => s.direct === "yes");

  // ---- 同じ店からまとめて買うと: 1注文ごとの手数料と1点ごとの手数料で差が開く ----
  const counts = [1, 5, 10];
  const grid = counts.map((n) => {
    const r = calculateAll({ source: "other_shop", itemPriceJpy: 1500 * n, itemCount: n, sameShop: true, weightG: Math.max(200 * n, 500), destination: "US", domesticShippingJpy: 700, buyeePlan: "light" }, data).results;
    return { n, by: P.map((p) => { const x = r.find((y) => y.proxyId === p.id); return { ...p, total: x.grandTotal, fee: x.payNow.lines.filter((l) => l.key === "service").reduce((s, l) => s + l.amount, 0) }; }) };
  });
  const flips = grid.map((g) => [...g.by].sort((a, b) => a.total - b.total)[0]);
  const feeAt = (n, id) => grid.find((g) => g.n === n).by.find((x) => x.id === id).fee;
  const flatPerOrder = P.filter((p) => feeAt(1, p.id) === feeAt(10, p.id));

  // 駿河屋だけの例外（Doorzo）: 公式の料金ページの記載
  const doorzo = proxies.proxies.find((p) => p.id === "doorzo");

  const body = `
  <h1>Buying from Suruga-ya, Mandarake and other Japanese anime shops</h1>
  <p>Most of what overseas buyers want from Japan that is not on Mercari or Yahoo! Auctions sits in a handful of second-hand and doujin shops.
  Some of them now ship abroad themselves; others can only be reached through a proxy. This guide sets out which is which, which proxy services have
  a page for each shop, and what a proxy costs when you buy several things from the same shop.</p>

  <div class="verdict"><p class="v">${lj(direct.map((s) => esc(s.name)))} ship abroad themselves. For the others, you need a proxy.</p>
  <p class="cap" style="margin:0">Checked on each shop's own site and each proxy's own site on ${CHECKED}.</p></div>

  <h2>Shop by shop</h2>
  <table><thead><tr><th>Shop</th><th>Sells</th><th>Ships abroad itself?</th><th>Proxies with a page for it</th></tr></thead><tbody>
  ${SHOPS.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.what)}</td><td>${s.direct === "yes" ? "Yes" : "Not found"}</td><td>${lj(s.proxies.map(([id, how]) => `${esc(nameOf(id))} (${esc(how)})`))}</td></tr>`).join("")}
  </tbody></table>
  ${SHOPS.map((s) => `<h3>${esc(s.name)}</h3><p>${esc(s.directEn)}${s.directUrl ? ` <a href="${esc(s.directUrl)}" rel="noopener">Source</a>.` : ""}</p>`).join("")}
  <p>A shop missing from a proxy's own pages is not necessarily off limits: FROM JAPAN, ZenMarket and Neokyo also take orders by pasting a shop's web address.
  The list above is only where a service has built a page or search for that shop. We did not find these shops on Buyee's own pages.</p>

  <h2>Buying several things from one shop</h2>
  <p>Proxy fees work differently once you buy more than one item from the same shop. ${flatPerOrder.length ? `${lj(flatPerOrder.map((p) => esc(p.name)))} charge${flatPerOrder.length === 1 ? "s" : ""} once per order from a shop, ` : ""}the others charge per item.
  Here are orders of one, five and ten ¥1,500 items from one shop, sent together to the United States by EMS:</p>
  <table><thead><tr><th>Items</th>${P.map((p) => `<th class="num">${esc(p.name)}</th>`).join("")}</tr></thead><tbody>
  ${grid.map((g) => `<tr><td>${g.n} × ¥1,500</td>${g.by.map((x) => `<td class="num">${yen(x.total)}<br><small>fee ${yen(x.fee)}</small></td>`).join("")}</tr>`).join("")}
  </tbody></table>
  <p>${(() => { const W = { 1: "one item", 5: "five items", 10: "ten items" }; const t = grid.map((g, i) => `with ${W[g.n] ?? `${g.n} items`}, ${esc(flips[i].name)} is cheapest`).join("; "); return t.charAt(0).toUpperCase() + t.slice(1); })()}.
  ${flips[0].id !== flips.at(-1).id ? `The cheapest service changes as the order grows, because a per-order fee is spread over more items.` : `The same service stays cheapest as the order grows.`}
  Weights assumed: 200 g per item, at least 500 g packed; ¥700 of postage inside Japan for the whole order. Doorzo does not publish a payment fee, so it is counted as ¥0.</p>
  <p class="cap">${doorzo ? "Doorzo charges up to ¥500 per item for Suruga-ya, rather than its usual ¥300 cap, according to its fee page. " : ""}ZenMarket charges a lower fee for stores on its recommended page; we could not confirm which of the shops above count.</p>

  <h2>Shop direct or through a proxy?</h2>
  <p>Where a shop ships abroad itself, compare its checkout total with a proxy's. Buying direct removes the proxy's fee;
  a proxy lets you combine purchases from several shops and marketplaces into one parcel, which can save more in postage than the fee costs.
  The <a href="/guides/consolidating-parcels">consolidation guide</a> shows how much combining saves to each country.</p>
  <ul>
    <li>Check what a shop's items contain against <a href="/what-you-cannot-ship-from-japan">what cannot be shipped</a> before ordering through a proxy.</li>
    <li>Doujinshi from these shops: see <a href="/guides/buying-doujinshi-from-japan">buying doujinshi</a> for the rules on adult titles.</li>
    <li>Prices on second-hand shops are fixed, so <a href="/guides/reading-mercari-and-yahoo-auctions-listings">the listing guide</a>'s condition words are the main thing to read.</li>
  </ul>
  <nav class="related"><h2>Related</h2><ul><li><a href="/guides/buying-figures-from-japan">Buying figures from Japan</a></li><li><a href="/guides/buying-anime-merchandise-from-japan">Buying anime merchandise</a></li><li><a href="/guides/which-proxy-is-cheapest">Which proxy is cheapest</a></li></ul></nav>`;

  return {
    path: "/guides/buying-from-japanese-anime-shops",
    layout: "content-first",
    prefill: { source: "other_shop", itemPriceJpy: 7500, itemCount: 5, sameShop: true, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light" },
    title: "Buying from Suruga-ya, Mandarake and other Japanese anime shops",
    description: `Which Japanese anime and doujin shops ship abroad themselves, which of ${NW} proxies have a page for each, and what buying several items from one shop costs.`,
    body,
  };
}
