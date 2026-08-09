/**
 * SEO用の静的ページ定義。
 *
 * ■ 大原則
 * 機械生成の大量ページは、中身が実質同じだと Google の "scaled content abuse" に該当して
 * インデックスから外される。したがって **全ページに、そのページでしか出ない実計算値を載せる**。
 * テンプレートを言い換えただけのページは作らない。
 *
 * ■ 生成対象と件数（意図的に絞る。数千ページの無差別生成はしない）
 *   1. 代行A vs 代行B × 配送先        6組 × 7か国 = 42
 *   2. 仕入れ元 × 配送先で最安はどこか  7 × 7        = 49
 *   3. 重量 × 配送先の総額             7 × 7        = 49
 *   4. 各社の料金解説                                = 4
 *   5. 配送先ごとの輸入税ガイド                       = 7
 *   合計 151ページ
 */
import { calculateAll } from "./calc.mjs";

export const COUNTRY_SLUGS = {
  US: "united-states", CA: "canada", GB: "united-kingdom",
  AU: "australia", DE: "germany", FR: "france", SG: "singapore",
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

export const WEIGHTS = [
  { g: 60, label: "trading cards", slug: "trading-cards" },
  { g: 200, label: "a manga volume", slug: "manga" },
  { g: 400, label: "a prize figure", slug: "prize-figure" },
  { g: 800, label: "a model kit", slug: "model-kit" },
  { g: 1000, label: "a boxed scale figure", slug: "scale-figure" },
  { g: 2000, label: "a 2kg parcel", slug: "2kg" },
  { g: 3000, label: "a 3kg parcel", slug: "3kg" },
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");

function countryName(importTax, code) {
  return importTax.countries[code]?.name ?? code;
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
  const { proxies, importTax } = data;
  const pages = [];
  const ids = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name }));
  const countries = Object.keys(COUNTRY_SLUGS);

  // ---- 1. 代行A vs 代行B × 配送先 ----
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      for (const cc of countries) {
        const A = ids[a], B = ids[b];
        const input = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" };
        const { results, country } = calculateAll(input, data);
        const pair = results.filter((r) => r.proxyId === A.id || r.proxyId === B.id);
        const [win, lose] = pair.sort((x, y) => x.grandTotal - y.grandTotal);
        const diff = lose.grandTotal - win.grandTotal;
        const cn = countryName(importTax, cc);

        pages.push({
          path: `/${A.id}-vs-${B.id}-to-${COUNTRY_SLUGS[cc]}`,
          title: `${A.name} vs ${B.name} shipping to ${cn} — which is cheaper?`,
          description: `On a ¥10,000 1kg order from Mercari to ${cn}, ${win.name} lands at ${yen(win.grandTotal)} and ${lose.name} at ${yen(lose.grandTotal)}. Full fee breakdown.`,
          prefill: input,
          body: `
  <h1>${esc(A.name)} vs ${esc(B.name)}: shipping to ${esc(cn)}</h1>
  <p>Taking a typical order — a ¥10,000 item from Mercari Japan, about 1kg once packed, sent to ${esc(cn)} by EMS —
  <strong>${esc(win.name)} works out cheaper by ${yen(diff)}</strong>.</p>
  ${countryNotice(country)}
  ${resultsTable(pair)}
  <p>Totals include the proxy's service fee, packing, domestic shipping inside Japan, international postage,
  any deposit or payment fee, and import tax. Where a service collects tax up front it appears in the
  &ldquo;pay the proxy&rdquo; column instead of &ldquo;pay on delivery&rdquo; — the tax is the same either way.</p>
  ${links([
    { href: `/cheapest-proxy-for-mercari-to-${COUNTRY_SLUGS[cc]}`, text: `Cheapest proxy for Mercari to ${cn}` },
    { href: `/import-tax-${COUNTRY_SLUGS[cc]}`, text: `Import tax when shipping to ${cn}` },
    { href: `/${A.id}-fees`, text: `${A.name} fees explained` },
    { href: `/${B.id}-fees`, text: `${B.name} fees explained` },
  ])}`,
        });
      }
    }
  }

  // ---- 2. 仕入れ元 × 配送先 ----
  for (const [src, meta] of Object.entries(SOURCE_LABELS)) {
    for (const cc of countries) {
      const input = { source: src, itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: cc, domesticShippingJpy: 700, buyeePlan: "light" };
      const { results, country } = calculateAll(input, data);
      const cn = countryName(importTax, cc);
      const best = results[0];

      pages.push({
        path: `/cheapest-proxy-for-${meta.slug}-to-${COUNTRY_SLUGS[cc]}`,
        title: `Cheapest proxy for ${meta.label} to ${cn} (${data.proxies._meta.updated})`,
        description: `All four major Japan proxy services priced on the same ${meta.label} order to ${cn}. ${best.name} comes out cheapest at ${yen(best.grandTotal)}.`,
        prefill: input,
        body: `
  <h1>Cheapest proxy for ${esc(meta.label)} shipping to ${esc(cn)}</h1>
  <p>Same order through all four services: ¥10,000 of goods from ${esc(meta.label)}, roughly 1kg packed, EMS to ${esc(cn)}.
  <strong>${esc(best.name)} is cheapest at ${yen(best.grandTotal)}.</strong></p>
  ${countryNotice(country)}
  ${resultsTable(results)}
  <p>Service fees are charged differently by each company — per item, per order, or by weight — so the ranking
  changes with what you buy. Run your own numbers with the calculator above.</p>
  ${links([
    { href: `/import-tax-${COUNTRY_SLUGS[cc]}`, text: `Import tax when shipping to ${cn}` },
    ...ids.slice(0, 2).map((p) => ({ href: `/${p.id}-fees`, text: `${p.name} fees explained` })),
  ])}`,
      });
    }
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
  <p>EMS is priced in weight bands, so a parcel just over a band boundary costs the same as one at the top of it.
  Consolidating several purchases into one parcel is usually cheaper than sending them separately.</p>
  ${links([
    { href: `/cheapest-proxy-for-yahoo-auctions-to-${COUNTRY_SLUGS[cc]}`, text: `Cheapest proxy for Yahoo! Auctions to ${cn}` },
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
  ${p.taxPrepay?.length ? `<h2>Import tax collected up front</h2><ul>${
    p.taxPrepay.filter((t) => t.rate).map((t) => `<li>${esc(t.country)}: ${esc(t.tax)} ${(t.rate * 100).toFixed(t.rate * 100 % 1 ? 1 : 0)}%</li>`).join("")
  }</ul><p>Where tax is collected up front you pay nothing extra when the parcel arrives, and you usually avoid the courier's own customs handling charge.</p>` : ""}
  ${links(ids.filter((x) => x.id !== p.id).map((x) => ({ href: `/${[p.id, x.id].sort().join("-vs-")}-to-united-states`, text: `${name} vs ${x.name} to the US` })))}`,
    });
  }

  // ---- 5. 配送先ごとの輸入税ガイド ----
  for (const cc of countries) {
    const c = importTax.countries[cc];
    if (!c) continue;
    const cn = c.name;
    const prepayers = proxies.proxies.filter((p) => (p.taxPrepay ?? []).some((t) => t.country === cc && t.rate));

    pages.push({
      path: `/import-tax-${COUNTRY_SLUGS[cc]}`,
      title: `Import tax on parcels from Japan to ${cn} (${data.proxies._meta.updated})`,
      description: c.displayEn?.body?.slice(0, 155) ?? `What you pay in tax and duty when importing from Japan into ${cn}.`,
      prefill: null,
      body: `
  <h1>Importing from Japan into ${esc(cn)}</h1>
  ${countryNotice(c)}
  <h2>The numbers</h2>
  <ul>
    <li>Import VAT / GST: ${c.vatRate != null ? `${(c.vatRate * 100).toFixed(c.vatRate * 100 % 1 ? 1 : 0)}% on goods plus shipping` : c.vatNote ? esc(c.vatNote) : "not applicable"}</li>
    <li>Duty-free threshold: ${c.deMinimis?.status === "active" ? `${c.deMinimis.dutyThreshold} ${c.deMinimis.currency}` : c.deMinimis?.status === "suspended" ? "suspended — duty applies to every parcel" : c.deMinimis?.status === "removed" ? "abolished" : "unknown"}</li>
  </ul>
  <h2>Which proxies collect this tax up front</h2>
  ${prepayers.length
    ? `<p>${prepayers.map((p) => esc(p.shortName ?? p.name)).join(", ")} collect it at checkout. The others leave you to pay on delivery, where the courier normally adds a handling charge on top.</p>`
    : `<p>None of the four services collect this tax up front for ${esc(cn)}. You pay it when the parcel arrives, and couriers normally add a handling charge on top.</p>`}
  ${links([
    { href: `/cheapest-proxy-for-mercari-to-${COUNTRY_SLUGS[cc]}`, text: `Cheapest proxy for Mercari to ${cn}` },
    { href: `/ship-scale-figure-from-japan-to-${COUNTRY_SLUGS[cc]}`, text: `Cost to ship a boxed figure to ${cn}` },
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
  function verdictTable(results) {
    const rows = results.map((r) => {
      const b = r.shippable.blockers[0];
      return `
      <tr>
        <td>${esc(r.name)}</td>
        <td><strong>${VERDICT[r.shippable.level]}</strong></td>
        <td>${b?.quoteEn ? `&ldquo;${esc(b.quoteEn)}&rdquo;` : b?.reasonEn ? esc(b.reasonEn) : "No restriction published for this."}</td>
        <td>${r.shippable.level === "prohibited" ? "&mdash;" : yen(r.grandTotal)}</td>
      </tr>`;
    }).join("");

    return `<table>
    <thead><tr><th>Service</th><th>Can it ship?</th><th>What they actually say</th><th>Total if it ships</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  }

  for (const attrId of SEO_ATTRS) {
    const attr = restrictions.attributes.find((a) => a.id === attrId);
    for (const cc of countries) {
      const input = {
        source: "yahoo_auction", itemPriceJpy: 10000, itemCount: 1, weightG: 1000,
        destination: cc, domesticShippingJpy: 700, buyeePlan: "light",
        category: "other", attributes: [attrId],
      };
      const { results, allBlocked, noneConfirmed } = calculateAll(input, data);
      const cn = countryName(importTax, cc);
      const okOnes = results.filter((r) => r.shippable.level === "ok" || r.shippable.level === "conditional" || r.shippable.level === "carrier_limited");
      const cheapestOk = okOnes[0];

      const verdictLine = allBlocked
        ? `<strong>No. None of the four services will ship ${esc(attr.seoLabelEn)} to ${esc(cn)}.</strong>`
        : cheapestOk
          ? `<strong>Yes, but only through some of them.</strong> ${esc(cheapestOk.name)} is the cheapest that will take it, landing at ${yen(cheapestOk.grandTotal)} on a ¥10,000 1kg order.`
          : `<strong>No service confirms in writing that it will.</strong> Every provider either refuses ${esc(attr.seoLabelEn)} or has published no rule about it.`;

      pages.push({
        path: `/can-you-ship-${attr.slug}-from-japan-to-${COUNTRY_SLUGS[cc]}`,
        title: `Can you ship ${attr.seoLabelEn} from Japan to ${cn}?`,
        description: allBlocked
          ? `No. All four Japan proxy services refuse ${attr.seoLabelEn} to ${cn}. Here is what each one says, and what to do instead.`
          : `Buyee, ZenMarket, Neokyo and FROM JAPAN compared on ${attr.seoLabelEn} to ${cn}, quoting each company's own rules.`,
        prefill: input,
        body: `
  <h1>Can you ship ${esc(attr.seoLabelEn)} from Japan to ${esc(cn)}?</h1>
  <p>${verdictLine}</p>
  <p class="muted">Covers ${esc(attr.helpEn.toLowerCase())} — for example ${attr.examplesEn.map((e) => esc(e)).join(", ")}.</p>
  ${verdictTable(results)}
  ${allBlocked
    ? `<aside class="notice"><strong>What to do instead</strong><p>${esc(attr.whenBlockedEn)}</p></aside>`
    : noneConfirmed
      ? `<aside class="notice"><strong>Read this before you bid</strong><p>${esc(attr.whenBlockedEn)}</p></aside>`
      : ""}
  <h2>Why this matters before you bid</h2>
  <p>A proxy will happily accept the order and buy the item for you. The refusal happens later, when the parcel
  reaches their warehouse and is inspected. At that point you have already paid for the goods, the domestic
  shipping inside Japan and the service fee, and none of it comes back. The item is disposed of or returned to
  the seller at your cost.</p>
  <p>Rules checked against each company's own prohibited-items page on ${esc(restrictions._meta.updated)}.
  Where a company publishes nothing on a category we say so rather than guessing.</p>
  ${links([
    { href: "/what-you-cannot-ship-from-japan", text: "Everything you cannot ship out of Japan" },
    { href: `/import-tax-${COUNTRY_SLUGS[cc]}`, text: `Import tax when shipping to ${cn}` },
    { href: `/cheapest-proxy-for-yahoo-auctions-to-${COUNTRY_SLUGS[cc]}`, text: `Cheapest proxy for Yahoo! Auctions to ${cn}` },
  ])}`,
      });
    }
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
        <td>${seo ? `<a href="/can-you-ship-${a.slug}-from-japan-to-united-states">${esc(a.labelEn)}</a>` : esc(a.labelEn)}</td>
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
  ${links([
    ...SEO_ATTRS.map((id) => {
      const a = restrictions.attributes.find((x) => x.id === id);
      return { href: `/can-you-ship-${a.slug}-from-japan-to-united-states`, text: `Can you ship ${a.seoLabelEn} to the United States?` };
    }),
  ])}`,
    });
  }

  return pages;
}
