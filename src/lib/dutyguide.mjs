/**
 * 「国別の関税」ガイド（2026-10-05、E5）。VAT/GST とは別の、関税だけを9か国で並べる。
 *
 * ■ 確認できた税率だけを書く
 * 英国は政府の関税表API、米国は USITC、シンガポール・香港は「一般の物には関税がない」と公式にある。
 * EU・豪州・カナダ・台湾は「いくらから関税がかかるか」までは確認したが、趣味の品の税率は見ていないので
 * 「確認していない」と書く（data/duty-rules.json の rateCheckedEn が null）。
 * 価格ごとの判定は data/fx.json の参照レートで現地通貨に直した商品代だけで行い、その旨を書く。
 */
import rules from "../../data/duty-rules.json" with { type: "json" };
import { esc } from "./layout.mjs";
import { estimateDuty } from "./calc.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const lj = (a) => a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

export function buildDutyGuide(data, { COUNTRY_SLUGS, countryName }) {
  const { fx, importTax } = data;
  const countries = Object.keys(COUNTRY_SLUGS);
  const R = (cc) => rules.countries[cc]?.sameAs ? rules.countries[rules.countries[cc].sameAs] : rules.countries[cc];
  const sym = (cur) => fx.symbol?.[cur] ?? cur + " ";
  const limitYen = (r) => r.limit != null ? r.limit * fx.jpyPer[r.currency] : null;

  // ---- 価格ごとに「関税がかかりうるか」 ----
  const prices = [5000, 20000, 50000, 150000];
  const cell = (cc, price) => {
    const r = R(cc);
    if (r.noDutyOnGeneralGoods) return "none";
    if (cc === "US") { const e = estimateDuty(importTax.countries.US, price, "scale_figure"); return `${yen(e.amount)} on a figure`; }
    if (r.flatDutyEur) return price <= r.flatUpToEur * fx.jpyPer.EUR ? `€${r.flatDutyEur} per item line (${yen(r.flatDutyEur * fx.jpyPer.EUR)})` : "EU tariff rates";
    const ly = limitYen(r);
    if (ly == null) return "—";
    return price <= ly ? "none" : (cc === "GB" ? "0–4% on figures" : "duty by tariff");
  };
  const ladder = `<table><thead><tr><th>Ship to</th><th>No duty up to</th>${prices.map((p) => `<th class="num">${yen(p)} item</th>`).join("")}</tr></thead><tbody>
  ${countries.map((cc) => { const r = R(cc); const ly = limitYen(r);
    return `<tr><td><a href="/import-tax-${COUNTRY_SLUGS[cc]}">${esc(countryName(cc))}</a></td><td>${r.noDutyOnGeneralGoods ? "no duty on these goods" : r.limit != null ? `${sym(r.currency)}${r.limit.toLocaleString("en-US")} (about ${yen(ly)})` : "no limit"}</td>${prices.map((p) => `<td class="num">${esc(cell(cc, p))}</td>`).join("")}</tr>`; }).join("")}
  </tbody></table>`;

  // 何か国で ¥20,000 の商品に関税がかからないか（本文用）
  const freeAt = (price) => countries.filter((cc) => cell(cc, price) === "none");
  const free20 = freeAt(20000), free50 = freeAt(50000);

  const sections = countries.filter((cc) => cc !== "FR").map((cc) => {
    const r = R(cc);
    const name = cc === "DE" ? "Germany and France (EU)" : countryName(cc);
    return `<h3>${esc(name)}</h3>
  <p>${esc(r.summaryEn)}${r.link ? ` <a href="${esc(r.link)}">Details for the United States</a>.` : ""}</p>
  ${r.quoteEn ? `<p>&ldquo;${esc(r.quoteEn)}&rdquo;</p>` : ""}
  ${r.caveatEn ? `<p>${esc(r.caveatEn)}</p>` : ""}
  ${r.rates ? `<table><thead><tr><th>Item (UK commodity code)</th><th class="num">Standard rate</th><th class="num">Made in Japan, preference claimed</th></tr></thead><tbody>${r.rates.map((x) => `<tr><td>${esc(x.what)}</td><td class="num">${esc(x.standard)}</td><td class="num">${esc(x.japan)}</td></tr>`).join("")}</tbody></table>` : ""}
  ${r.noteEn ? `<p>${esc(r.noteEn)}</p>` : ""}
  ${r.handlingFeeCad ? `<p>That handling fee is about ${yen(r.handlingFeeCad * fx.jpyPer.CAD)} on top of whatever duty and tax is due.</p>` : ""}
  <p class="cap">${r.rateCheckedEn ? `Rate on hobby goods: ${esc(r.rateCheckedEn)}. ` : "Rates on hobby goods above the limit: not checked here. "}${r.sources?.length ? `Source${r.sources.length > 1 ? "s" : ""}: ${r.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.labelEn)}</a>`).join("; ")}. ` : ""}Checked ${esc(r.verifiedAt)}.</p>`;
  }).join("");

  const body = `
  <h1>Customs duty on goods from Japan, country by country</h1>
  <p>Import tax is two different charges. VAT, GST or sales tax is a percentage of almost everything, and this site's totals include it wherever it can be worked out.
  Customs duty is separate: it depends on what the item is, where it was made and what it is worth, and in most of the nine countries here an ordinary order from Japan pays none at all.
  This guide sets out where duty starts in each country, and what it is on the things people buy through a proxy.</p>

  <div class="verdict"><p class="v">On a ${yen(20000)} item, ${["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "all"][free20.length]} of the nine countries charge no customs duty${free20.length ? `: ${lj(free20.map((cc) => esc(countryName(cc))))}` : ""}.</p>
  <p class="cap" style="margin:0">The United States and the EU now charge something on almost every parcel. The details are below.</p></div>

  <h2>Where duty starts</h2>
  <p>Each country's limit converted to yen at the reference rates of ${esc(fx._meta.asOf.ecb)}, and what it means for items at four prices. The limits are tested against the item price alone; some countries count postage too, which brings the limit closer.</p>
  ${ladder}
  <p>At ${yen(50000)}, ${free50.length ? `only ${lj(free50.map((cc) => esc(countryName(cc))))} still charge${free50.length === 1 ? "s" : ""} no duty` : "every country charges duty or applies its tariff"}.
  Where the table says "duty by tariff", the rate depends on the tariff heading of the item, and we have not checked it for that country.</p>

  <h2>Country by country</h2>
  ${sections}

  <h2>What this means in practice</h2>
  <ul>
    <li>Splitting an order to stay under a limit does not always work: Australia, for example, says the value of several packages from one sender to one address may be combined.</li>
    <li>"Made in Japan" matters. The United States and the United Kingdom both treat Japanese-made goods differently from the same goods made elsewhere, and goods sold in Japan are not always made there: check the box or listing for the country of manufacture.</li>
    <li>Duty is paid to your customs authority, not to the proxy, so it is the same whichever service you use. The difference between services is whether they collect VAT or GST at checkout, which is covered in <a href="/guides/paying-import-tax-up-front">paying tax up front</a>.</li>
  </ul>
  <nav class="related"><h2>Related</h2><ul><li><a href="/import-tax">Import tax in all nine countries</a></li><li><a href="/import-tax-united-states#how-much-duty">US duty on goods from Japan</a></li><li><a href="/faq">Frequently asked questions</a></li></ul></nav>`;

  return {
    path: "/guides/customs-duty-by-country",
    layout: "content-first",
    prefill: null,
    title: "Customs duty on goods from Japan, country by country",
    description: `Where customs duty starts in each of nine countries for goods bought in Japan, what it is on figures, books and consoles, and which countries charge none on a ${yen(20000)} item.`,
    body,
  };
}
