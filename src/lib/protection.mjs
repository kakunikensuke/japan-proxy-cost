/**
 * 「荷物が壊れた・届かない・キャンセルしたい」ガイド（2026-10-05、E3）。
 *
 * ■ 一番大事な区別は「誰が払うか」
 * 会社自身が補償する（Buyee の有料プラン・FROM JAPAN・ZenMarket）のか、日本郵便への請求を取り次ぐだけ
 * （Neokyo・Doorzo）なのか。後者は日本郵便の補償額（EMSは無料で2万円まで）が上限になる。
 * 規定の原文は data/protection.json、金額は calculateAll の結果と日本郵便の料率だけから出す。
 */
import protection from "../../data/protection.json" with { type: "json" };
import { calculateAll } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { NW } from "./words.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const lj = (a) => a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

/** 日本郵便のEMS: 申告額までの補償にかかる追加料金 */
export function emsCoverFee(valueJpy, jp = protection.japanPost.ems) {
  if (valueJpy <= jp.freeUpToJpy) return 0;
  const v = Math.min(valueJpy, jp.maxJpy);
  return Math.ceil((v - jp.freeUpToJpy) / jp.perStepJpy) * jp.stepFee;
}

export function buildProtectionGuide(data) {
  const { proxies } = data;
  const P = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name, ...protection.proxies[p.id] }));
  const self = P.filter((p) => p.payer === "service");
  const carrier = P.filter((p) => p.payer === "carrier");
  const jp = protection.japanPost;

  // ---- 補償を付けたときの総額: Buyee は配送保障プラン、ほかは既定のまま ----
  const prices = [10000, 30000, 100000];
  const rows = prices.map((price) => {
    const base = { source: "mercari", itemPriceJpy: price, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700 };
    const light = calculateAll({ ...base, buyeePlan: "light" }, data).results;
    const covered = calculateAll({ ...base, buyeePlan: protection.proxies.buyee.planId }, data).results;
    const by = P.map((p) => {
      const r = (p.id === "buyee" ? covered : light).find((x) => x.proxyId === p.id);
      return { ...p, total: r.grandTotal, plain: light.find((x) => x.proxyId === p.id).grandTotal };
    });
    const cheapestAny = [...by].sort((a, b) => a.plain - b.plain)[0];
    const cheapestSelf = [...by.filter((x) => x.payer === "service")].sort((a, b) => a.total - b.total)[0];
    return { price, by, cheapestAny, cheapestSelf, emsFee: emsCoverFee(price) };
  });
  const gap = rows.map((r) => r.cheapestSelf.total - r.cheapestAny.plain);

  const body = `
  <h1>Lost or damaged parcels from Japan: what each proxy covers</h1>
  <p>Most parcels from Japan arrive intact, but when one does not, the five proxy services on this site handle it in very different ways.
  The difference that matters is who pays you back: the proxy itself, or Japan Post, with the proxy only passing your claim on.
  This guide sets out each company's rules in its own words, the deadlines for claiming, and what cover costs on a real order.</p>

  <div class="verdict"><p class="v">${lj(self.map((p) => esc(p.name)))} pay out themselves${self.some((p) => p.planFeeJpy) ? " (Buyee only on a paid plan)" : ""}. ${lj(carrier.map((p) => esc(p.name)))} pass your claim to the carrier, so Japan Post's cover is the limit.</p>
  <p class="cap" style="margin:0">On EMS, Japan Post covers up to ${yen(jp.ems.freeUpToJpy)} for free. Anything above that is covered only if the sender declares it and pays ${yen(jp.ems.stepFee)} for each further ${yen(jp.ems.perStepJpy)}.</p></div>

  <h2>Who pays when something goes wrong</h2>
  <table><thead><tr><th>Service</th><th>Cover for loss or damage in transit</th><th>Who pays out</th><th>Claim within</th></tr></thead><tbody>
  ${P.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.coverEn)}</td><td>${p.payer === "service" ? "The service" : "The carrier, via the service"}</td><td>${esc(p.claimWindowEn)}</td></tr>`).join("")}
  </tbody></table>
  <p>The deadlines are short and they differ. Whatever service you use, photograph the box before opening it, keep all the packing, and report a problem the day you find it.</p>

  <h2>In each company's words</h2>
  ${P.map((p) => `<h3>${esc(p.name)}</h3>
  <p>&ldquo;${esc(p.quoteEn)}&rdquo;</p>
  ${p.liteQuoteEn ? `<p>On the free Lite plan, which is what the totals on this site assume for Buyee, this is listed among what is not included: &ldquo;${esc(p.liteQuoteEn)}&rdquo;</p>` : ""}
  ${p.limitEn ? `<p>${esc(p.limitEn)}</p>` : ""}
  ${p.exclusionsEn ? `<p><strong>Not covered:</strong> ${esc(p.exclusionsEn)}</p>` : ""}
  ${p.extraEn ? `<p>${esc(p.extraEn)}</p>` : ""}
  <p class="cap">Source: <a href="${esc(p.sourceUrl)}" rel="noopener">${esc(p.name)}</a>, checked ${esc(p.verifiedAt)}.</p>`).join("")}

  <h2>What cover costs on a real order</h2>
  <p>The totals below are for a Mercari item sent to the United States by EMS, 1 kg, with ¥700 of postage inside Japan. Buyee is priced on its Insured Delivery plan (${yen(protection.proxies.buyee.planFeeJpy)} per order);
  for the others, the cover described above is already in the price.</p>
  <table><thead><tr><th>Item price</th>${P.map((p) => `<th class="num">${esc(p.name)}</th>`).join("")}<th class="num">Japan Post extra cover on EMS</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${yen(r.price)}</td>${r.by.map((x) => `<td class="num">${yen(x.total)}${x.payer === "carrier" ? "*" : ""}</td>`).join("")}<td class="num">${r.emsFee ? yen(r.emsFee) : "free"}</td></tr>`).join("")}
  </tbody></table>
  <p class="cap">* Claims go to the carrier. Japan Post covers the item's declared value, free up to ${yen(jp.ems.freeUpToJpy)}; the last column is what Japan Post charges to declare the full price. Neokyo says its shipments include insurance; we could not find, for either service, what value is declared to Japan Post. US duty not included.</p>
  <p>${(() => {
    // 3つの価格で同じ組・同じ差なら1文にまとめる
    const same = rows.every((r, i) => r.cheapestSelf.id === rows[0].cheapestSelf.id && r.cheapestAny.id === rows[0].cheapestAny.id && gap[i] === gap[0]);
    const one = (r, g, at) => g > 0
      ? `${at}, the cheapest service that pays out itself, ${esc(r.cheapestSelf.name)}, costs ${yen(g)} more than the cheapest overall, ${esc(r.cheapestAny.name)}.`
      : `${at}, the cheapest service overall, ${esc(r.cheapestSelf.name)}, is also one that pays out itself.`;
    return same ? one(rows[0], gap[0], `At all ${rows.length === 3 ? "three" : rows.length} prices`) : rows.map((r, i) => one(r, gap[i], `At ${yen(r.price)}`)).join(" ");
  })()}
  ${rows.some((r) => r.cheapestAny.id === "doorzo") ? "Doorzo does not publish a payment fee, so it is counted as ¥0 here. " : ""}That difference is the price of having the proxy, rather than Japan Post, stand behind the parcel.</p>

  <h2>Small packets and surface mail</h2>
  <p>Japan Post only insures letters and parcel post. Airmail small packets, often the cheapest way to send anything under 2 kg, cannot be insured with Japan Post at all, and parcel post insurance costs ${yen(jp.parcelInsuranceBaseFee)} for the first ${yen(jp.ems.freeUpToJpy)}.
  FROM JAPAN covers small packets only when the items are worth less than ¥30,000, and not at all without tracking. If you switch away from EMS to save on postage, check what that does to your cover first. The <a href="/guides/shipping-methods">shipping methods guide</a> compares the postage.</p>

  <h2>Cancelling and returning</h2>
  <p>None of the ${NW} services let you cancel once the item has been bought. In their words:</p>
  <ul>${P.map((p) => `<li><strong>${esc(p.name)}:</strong> &ldquo;${esc(p.cancelQuoteEn)}&rdquo;${p.cancelNoteEn ? ` ${esc(p.cancelNoteEn)}` : ""}</li>`).join("")}</ul>
  <p>For second-hand marketplaces, the seller is a private person in Japan and a return is rarely possible. That makes the checks before buying the only real protection:
  <a href="/guides/reading-mercari-and-yahoo-auctions-listings">read the listing carefully</a> and check <a href="/what-you-cannot-ship-from-japan">what cannot be shipped</a>, because a refused item is paid for and never sent.</p>
  <p class="cap">Japan Post: <a href="${esc(jp.sourceUrl)}" rel="noopener">EMS compensation</a> and <a href="${esc(jp.insuredMailUrl)}" rel="noopener">insured mail</a>, checked ${esc(jp.verifiedAt)}.</p>
  <nav class="related"><h2>Related</h2><ul><li><a href="/guides/how-proxy-buying-works">How proxy buying works, step by step</a></li><li><a href="/guides/which-proxy-is-cheapest">Which proxy is cheapest</a></li><li><a href="/faq">Frequently asked questions</a></li></ul></nav>`;

  return {
    path: "/guides/lost-or-damaged-parcels",
    layout: "content-first",
    prefill: { source: "mercari", itemPriceJpy: 30000, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "guarantee" },
    title: "Lost or damaged parcels from Japan: what each proxy covers",
    description: `Which Japan proxies pay out themselves and which only pass your claim to Japan Post, the claim deadlines, what cover costs, and why none of the ${NW} lets you cancel.`,
    body,
  };
}
