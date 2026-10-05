/**
 * 「各数字をいつ確認したか」と変更履歴のページ（2026-10-05、E6）。
 *
 * 確認日は手で書かず、各データファイルの verifiedAt / updated から集める。
 * データを確認し直したら、そのファイルの日付を更新すればこのページも変わる。変更履歴だけは data/changelog.json に手で足す。
 */
import changelog from "../../data/changelog.json" with { type: "json" };
import protection from "../../data/protection.json" with { type: "json" };
import dutyRules from "../../data/duty-rules.json" with { type: "json" };
import { esc } from "./layout.mjs";
import { NW } from "./words.mjs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmt = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const latest = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function buildUpdatesPage(data, { COUNTRY_SLUGS, countryName }) {
  const { proxies, ems, post, importTax, restrictions, stores, fx } = data;
  const countries = Object.keys(COUNTRY_SLUGS);

  // ---- 会社ごと: 料金・禁止品・補償 ----
  const proxyRows = proxies.proxies.map((p) => {
    const r = restrictions.byProxy[p.id] ?? {};
    const rDate = latest(Object.values(r).map((c) => c?.verifiedAt));
    return {
      name: p.shortName ?? p.name,
      fees: p.verifiedAt ?? proxies._meta.updated,
      rules: rDate,
      protection: protection.proxies[p.id]?.verifiedAt ?? null,
      feeSource: p.serviceFee?.sourceUrl ?? p.url,
    };
  });

  // ---- 国ごと: 輸入税・関税 ----
  const countryRows = countries.map((cc) => {
    const c = importTax.countries[cc] ?? {};
    const d = dutyRules.countries[cc]?.sameAs ? dutyRules.countries[dutyRules.countries[cc].sameAs] : dutyRules.countries[cc];
    return {
      cc, name: countryName(cc),
      tax: c.verifiedAt ?? c.deMinimis?.verifiedAt ?? importTax._meta?.updated ?? null,
      duty: cc === "US" ? c.dutyEstimate?.verifiedAt : d?.verifiedAt,
    };
  });

  // ---- 古い順に、確認からの経過日数 ----
  const today = latest(changelog.entries.map((e) => e.date));
  const all = [
    ...proxyRows.flatMap((r) => [{ what: `${r.name} fees`, date: r.fees }, { what: `${r.name} prohibited items`, date: r.rules }]),
    { what: "Japan Post EMS rates", date: ems._meta.updated },
    { what: "Other Japan Post rates", date: post._meta.updated },
    ...countryRows.map((r) => ({ what: `${r.name} import tax`, date: r.tax })),
  ].filter((x) => x.date);
  const oldest = [...all].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);

  const body = `
  <h1>When each figure on this site was checked</h1>
  <p>Every price and rule on this site comes from a company's or a government's own page, copied by hand and checked on a date. Fees and rules change,
  so the date matters as much as the number. This page lists when each part was last checked, and what has changed on the site and when.</p>

  <div class="verdict"><p class="v">The oldest figures still in use were checked on ${fmt(oldest[0].date)}, ${daysBetween(oldest[0].date, today)} days before the latest update.</p>
  <p class="cap" style="margin:0">${oldest.map((x) => `${esc(x.what)}: ${fmt(x.date)}`).join("; ")}.</p></div>

  <h2>The ${NW} services</h2>
  <table><thead><tr><th>Service</th><th>Fees</th><th>Prohibited items</th><th>Loss and damage rules</th></tr></thead><tbody>
  ${proxyRows.map((r) => `<tr><td>${esc(r.name)}</td><td>${fmt(r.fees)}</td><td>${fmt(r.rules)}</td><td>${fmt(r.protection)}</td></tr>`).join("")}
  </tbody></table>
  <p>Where the dates differ for one service, it is because a later check only covered part of its rules: for example, a new kind of item added to the prohibited-items check is checked against every service on the day it is added.</p>

  <h2>Postage and exchange rates</h2>
  <table><thead><tr><th>What</th><th>Source</th><th>Checked</th></tr></thead><tbody>
    <tr><td>EMS rates</td><td><a href="${esc(ems._meta.source)}" rel="noopener">Japan Post</a></td><td>${fmt(ems._meta.updated)}</td></tr>
    <tr><td>Airmail and surface rates</td><td>Japan Post</td><td>${fmt(post._meta.updated)}</td></tr>
    <tr><td>Loss and damage cover</td><td><a href="${esc(protection.japanPost.sourceUrl)}" rel="noopener">Japan Post</a></td><td>${fmt(protection.japanPost.verifiedAt)}</td></tr>
    <tr><td>Currency conversions</td><td><a href="${esc(fx._meta.sources.ecb)}" rel="noopener">European Central Bank</a></td><td>${fmt(fx._meta.asOf.ecb)}</td></tr>
    <tr><td>Taiwan dollar</td><td><a href="${esc(fx._meta.sources.fedH10)}" rel="noopener">US Federal Reserve H.10</a></td><td>${fmt(fx._meta.asOf.fedH10)}</td></tr>
    <tr><td>Shops that ship abroad</td><td>Each shop's own site</td><td>${fmt(stores._meta.updated)}</td></tr>
  </tbody></table>
  <p>Postage is charged at Japan Post's published rates whichever service you use, so a change in those rates moves every service's total, not just one.</p>

  <h2>Import tax and duty, by country</h2>
  <table><thead><tr><th>Country</th><th>VAT, GST and limits</th><th>Customs duty</th></tr></thead><tbody>
  ${countryRows.map((r) => `<tr><td><a href="/import-tax-${COUNTRY_SLUGS[r.cc]}">${esc(r.name)}</a></td><td>${fmt(r.tax)}</td><td>${fmt(r.duty)}</td></tr>`).join("")}
  </tbody></table>

  <h2>What has changed</h2>
  <ul>${[...changelog.entries].sort((x, y) => y.date.localeCompare(x.date)).map((e) => `<li><strong>${fmt(e.date)}</strong>: ${esc(e.en)}</li>`).join("")}</ul>

  <h2>If something is out of date</h2>
  <p>Companies change their fees without notice, and the check dates above are the only promise this site makes about them. If you find a fee or a rule that no longer matches a company's own page,
  <a href="/contact">tell us</a> and it will be checked and corrected, with the change listed here. How each total is worked out is set out in <a href="/how-we-calculate">how we calculate</a>.</p>`;

  return {
    path: "/data-updates",
    layout: "content-only",
    prefill: null,
    title: "When each figure on this site was checked",
    description: `The date each fee, prohibited-items rule, postage rate and tax rule on this site was last checked against its source, for ${NW} proxy services and nine countries, and what has changed.`,
    body,
  };
}
