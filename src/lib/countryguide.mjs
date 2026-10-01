/**
 * 国別の完全ガイド（2026-10-02）。/import-tax-<国> を「その国で日本から買うための1ページ」に格上げする部品。
 *
 * URL は変えない（検索の評価を引き継ぐため）。税の節は従来どおり残し、その前後に
 * 要点・4社の総額・EMS料金・送れない物・ジャンル別の総額・関連ページを足す。
 * 数字はすべて calculateAll / lookupEmsRate / checkShippable の結果。
 */
import { calculateAll, checkShippable, lookupEmsRate } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { amountOf, costBarHtml, legendHtml } from "./enrich.mjs";
import { GENRES } from "./genres.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const listJoin = (arr) => arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const kg = (g) => (g >= 1000 ? `${+(g / 1000).toFixed(1)} kg` : `${g} g`);
const SHIPS = ["ok", "conditional", "carrier_limited"];
const VERDICT = { ok: "Ships", conditional: "With conditions", carrier_limited: "With conditions", unknown: "Not stated", prohibited: "Refused" };

export function countryGuide(cc, data, { COUNTRY_SLUGS, versusPath, countryName }) {
  const { proxies, ems, restrictions } = data;
  const cn = countryName(cc);
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" };
  const res = calculateAll(base, data);
  const best = res.results[0];
  const ids = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name }));

  // ---- 送れない物（この国宛て） ----
  const attrRows = restrictions.attributes.map((a) => {
    const v = ids.map((p) => checkShippable([a.id], { proxyId: p.id, destination: cc }, restrictions));
    const shipN = v.filter((x) => SHIPS.includes(x.level)).length;
    const post = restrictions.byDestination?.[cc]?.[a.id];
    return { a, v, shipN, post };
  });
  // 「全社が拒否」と「規則を公開した会社が無い（確認できない）」は別物。後者を「送れない」と書かない
  const noRoute = attrRows.filter((r) => r.v.every((x) => x.level === "prohibited"));
  const unconfirmed = attrRows.filter((r) => r.shipN === 0 && !r.v.every((x) => x.level === "prohibited"));
  const nm = (r) => esc(r.a.seoLabelEn ?? r.a.labelEn.toLowerCase());
  const postBlocked = attrRows.filter((r) => r.post?.level === "prohibited");

  // ---- 要点 ----
  const zone = ems.targetCountries.find((c) => c.code === cc)?.zone;
  const ems1k = lookupEmsRate(ems, cc, 1000).amount;
  const tax = amountOf(best, "tax");
  const glance = `<div class="verdict">
  <p class="v">A ¥10,000 item from Mercari Japan, 1 kg packed, costs ${yen(best.grandTotal)}${best.grandTotalIsMinimum ? " plus duty" : ""} delivered to ${esc(cn)} through ${esc(best.name)}, the cheapest of the four.</p>
  ${costBarHtml(best, best.grandTotal)}<div style="height:12px"></div>${legendHtml([best])}
  <ul class="cap" style="margin:14px 0 0;padding-left:18px">
    <li>EMS postage at 1 kg: ${yen(ems1k)} (Japan Post zone ${zone})</li>
    <li>Import tax on this order: ${best.grandTotalIsMinimum ? "depends on the item, not estimated" : tax ? yen(tax) : "none"}</li>
    <li>${noRoute.length ? `Refused by every service: ${listJoin(noRoute.map(nm))}` : "No category we track is refused by every service"}</li>
    ${unconfirmed.length ? `<li>No service confirms it will send: ${listJoin(unconfirmed.map(nm))}</li>` : ""}
  </ul></div>`;

  // ---- 4社の総額 ----
  const svcRows = res.results.map((r, i) => `<tr${i === 0 ? ' class="best"' : ""}><td>${esc(r.name)}</td><td class="num">${yen(r.payNow.total)}</td><td class="num">${r.payOnDelivery.quantified ? yen(r.payOnDelivery.total) : "not estimated"}</td><td class="num"><strong>${yen(r.grandTotal)}</strong></td><td class="num">${i === 0 ? "—" : "+" + yen(r.grandTotal - best.grandTotal)}</td></tr>`).join("");
  const services = `<p>The same order through all four. The postage is identical; the differences are each company's fees and whether it collects the tax at checkout.
  ${res.results.at(-1).grandTotal > best.grandTotal ? `Choosing ${esc(res.results.at(-1).name)} instead of ${esc(best.name)} costs ${yen(res.results.at(-1).grandTotal - best.grandTotal)} more on this order.` : "All four come to the same total on this order."}</p>
  <table><thead><tr><th>Service</th><th class="num">At checkout</th><th class="num">On arrival</th><th class="num">Total</th><th class="num">Difference</th></tr></thead><tbody>${svcRows}</tbody></table>
  <p>Head-to-head for ${esc(cn)}: ${(() => { const out = []; for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) out.push(`<a href="${versusPath(ids[a].id, ids[b].id, cc)}">${esc(ids[a].name)} vs ${esc(ids[b].name)}</a>`); return out.join(", "); })()}.</p>`;

  // ---- EMS料金 ----
  const bands = ems.rates.filter((r) => r[String(zone)] != null);
  const sameZone = ems.targetCountries.filter((c) => c.zone === zone && c.code !== cc).map((c) => esc(c.name));
  const postage = `<p>Japan Post puts ${esc(cn)} in EMS zone ${zone}${sameZone.length ? `, together with ${listJoin(sameZone)}, which pay the same prices` : ""}. EMS is charged by weight band, so a parcel pays for the whole band it falls in:</p>
  <table><thead><tr><th>Packed weight</th><th class="num">EMS to ${esc(cn)}</th><th class="num">Per kg</th></tr></thead><tbody>${bands.map((r) => `<tr><td>Up to ${kg(r.weightG)}</td><td class="num">${yen(r[String(zone)])}</td><td class="num">${yen(r[String(zone)] / (r.weightG / 1000))}</td></tr>`).join("")}</tbody></table>
  <p>The first band costs ${yen(bands[0][String(zone)] / (bands[0].weightG / 1000))} per kg; the heaviest costs ${yen(bands.at(-1)[String(zone)] / (bands.at(-1).weightG / 1000))} per kg. That is why sending several purchases together in one box saves money. The <a href="/guides/ems-weight-bands">EMS guide</a> compares all nine countries.</p>`;

  // ---- 送れない物 ----
  const restrictionsHtml = `<p>${noRoute.length
    ? `All four refuse ${listJoin(noRoute.map(nm))} on this route.`
    : `None of the categories below is refused by all four on this route.`}
  ${unconfirmed.length ? `For ${listJoin(unconfirmed.map(nm))}, no service says it will ship to ${esc(cn)}: some refuse, and the rest publish no rule, which means the decision is made at the warehouse after you have paid.` : ""}
  ${postBlocked.length ? `For ${listJoin(postBlocked.map((r) => esc(r.a.seoLabelEn ?? r.a.labelEn.toLowerCase())))}, that is Japan Post's own rule for ${esc(cn)}, not a company policy, so changing service does not help.` : `None of these is blocked by a Japan Post rule specific to ${esc(cn)}; where something is refused, it is the company's own policy, and another service may accept it.`}</p>
  <table><thead><tr><th>If the parcel contains</th>${ids.map((p) => `<th>${esc(p.name)}</th>`).join("")}</tr></thead><tbody>${attrRows.map((r) => `<tr${r.shipN === 0 ? ' class="row-exception"' : ""}><td>${esc(r.a.labelEn)}</td>${r.v.map((x) => `<td>${VERDICT[x.level]}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <p class="cap">Company rules and Japan Post's rules for ${esc(cn)} combined. See <a href="/what-you-cannot-ship-from-japan">what you cannot ship</a> for each company's own wording.</p>`;

  // ---- ジャンル別 ----
  const genreRows = GENRES.map((g) => {
    const o = g.order;
    const r = calculateAll({ source: o.source, itemPriceJpy: o.price, itemCount: o.count ?? 1, sameShop: o.sameShop ?? false, weightG: o.weightG, destination: cc, domesticShippingJpy: 700 * ((o.sameShop || (o.count ?? 1) === 1) ? 1 : o.count), buyeePlan: "light", attributes: o.attrs ?? [] }, data);
    const top = r.results.find((x) => SHIPS.includes(x.shippable.level));
    return { g, o, top };
  });
  const genres = `<p>Typical orders for different kinds of item, each through the cheapest service that will take it to ${esc(cn)}. Weights and prices are assumptions; the guides explain each one.</p>
  <table><thead><tr><th>Buying</th><th>Assumed order</th><th>Cheapest</th><th class="num">Total</th></tr></thead><tbody>${genreRows.map(({ g, o, top }) =>
    `<tr><td><a href="/guides/${g.slug}">${esc(g.name.charAt(0).toUpperCase() + g.name.slice(1))}</a></td><td>${esc(o.what)}, ¥${o.price.toLocaleString("en-US")}, ${kg(o.weightG)}</td><td>${top ? esc(top.name) + (top.shippable.level !== "ok" ? " (with conditions)" : "") : "No service"}</td><td class="num">${top ? yen(top.grandTotal) + (top.grandTotalIsMinimum ? " +duty" : "") : "—"}</td></tr>`).join("")}</tbody></table>`;

  // ---- 関連ページ ----
  const slug = COUNTRY_SLUGS[cc];
  const more = `<ul>
    <li><a href="/cheapest-proxy-from-japan-to-${slug}">Cheapest proxy to ${esc(cn)}, by marketplace</a></li>
    <li>Shipping by weight to ${esc(cn)}: <a href="/ship-manga-from-japan-to-${slug}">a manga volume</a>, <a href="/ship-scale-figure-from-japan-to-${slug}">a boxed figure</a>, <a href="/ship-2kg-from-japan-to-${slug}">a 2 kg parcel</a>, <a href="/ship-3kg-from-japan-to-${slug}">a 3 kg parcel</a></li>
    <li><a href="/guides/paying-import-tax-up-front">Paying import tax up front or on delivery</a></li>
    <li><a href="/import-tax">Import tax in all nine countries</a></li>
  </ul>`;

  return { best, glance, services, postage, restrictionsHtml, genres, more };
}
