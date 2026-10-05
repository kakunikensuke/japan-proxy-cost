/**
 * 用語集（/glossary）と、よくある質問（/faq）。2026-10-02。
 *
 * 定義そのものは一般的な意味に留め、各用語に「このサイトのデータでは」の実例を必ず添える。
 * よくある質問の答えはすべて計算結果から作る（問いは固定、答えはデータが変われば変わる）。
 * データに無いこと（配送日数、各マーケットの規約など）は答えに書かない。
 */
import { calculateAll, lookupShippingRate, CARRIER_LABELS } from "./calc.mjs";
import { dutyCell, fmtDate } from "./duty.mjs";
import { esc } from "./layout.mjs";
import { amountOf, SOURCE_NAMES } from "./enrich.mjs";
import { NW, NWC, NW_OTHERS, N_PROXIES, PROXY_TITLE_LIST, PROXY_TITLE_AMP, numberWord, feeText, feeBounds } from "./words.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const listJoin = (arr) => arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const SHIPS = ["ok", "conditional", "carrier_limited"];

export function buildReference(data, { COUNTRY_SLUGS, countryName }) {
  const { proxies, ems, importTax, restrictions, stores } = data;
  const countries = Object.keys(COUNTRY_SLUGS);
  const P = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name, p }));
  const nameOf = (id) => P.find((x) => x.id === id)?.name ?? id;
  const run = (input) => calculateAll(input, data);
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, domesticShippingJpy: 700, buyeePlan: "light" };

  // ---- 共通で使う実数 ----
  const us = run({ ...base, destination: "US" });
  const gb = run({ ...base, destination: "GB" });
  const gbBest = gb.results[0];
  const storage = P.map((x) => `${esc(x.name)} ${x.p.storage?.freeDays ?? "?"} days`);
  const zen = P.find((x) => x.id === "zenmarket")?.p;
  const buyee = P.find((x) => x.id === "buyee")?.p;
  // 事前徴収すると書いているが税率を公開していない会社（「徴収しない」と書かないため）
  const unpublished = (cc) => P.filter((x) => (x.p.taxPrepay ?? []).some((t) => t.country === cc && (t.unverifiedRate || t.rate == null))).map((x) => x.name);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const prepayers = (cc) => P.filter((x) => (x.p.taxPrepay ?? []).some((t) => t.country === cc && t.rate && (!t.onlyCarriers || t.onlyCarriers.includes("ems")))).map((x) => x.name);
  const emsUS1k = lookupShippingRate(data, "ems", "US", 1000).amount;
  const spUS1k = lookupShippingRate(data, "small_packet_air", "US", 1000).amount;
  const seaUS5k = lookupShippingRate(data, "intl_parcel_sea", "US", 5000).amount;
  const emsUS5k = lookupShippingRate(data, "ems", "US", 5000).amount;
  const bands = ems.rates.map((r) => r.weightG);
  const fig3 = (cc) => {
    const sep = 3 * lookupShippingRate(data, "ems", cc, 1000).amount, tog = lookupShippingRate(data, "ems", cc, 3000).amount;
    return sep - tog;
  };
  const consolidation = countries.map((cc) => ({ cn: countryName(cc), s: fig3(cc) })).sort((a, b) => b.s - a.s);
  const clearance = P.filter((x) => x.p.exportClearanceFee).map((x) => `${esc(x.name)} ${yen(x.p.exportClearanceFee.amount)} above ${yen(x.p.exportClearanceFee.thresholdJpy)}`);
  const lithium = restrictions.attributes.find((a) => a.id === "lithium_battery");
  const lithiumPost = countries.filter((cc) => restrictions.byDestination?.[cc]?.lithium_battery?.level === "prohibited").map((cc) => countryName(cc));
  const allRefuse = restrictions.attributes.filter((a) => countries.every((cc) => P.every((x) => {
    const r = run({ ...base, destination: cc, attributes: [a.id] }).results.find((y) => y.proxyId === x.id);
    return r.shippable.level === "prohibited";
  })));
  const directShops = (stores.stores ?? []).filter((s) => s.affiliateUrl);

  // ---- 用語集 ----
  const groups = [
    ["Buying", [
      ["proxy-service", "Proxy service", `A company in Japan that buys an item on your behalf, receives it at its warehouse, and posts it to you. You need one wherever a Japanese seller will not ship abroad, which includes almost every second-hand marketplace. This site compares ${listJoin(P.map((x) => esc(x.name)))}.`],
      ["service-fee", "Service fee", `The proxy's charge for buying the item. It is charged per item, per purchase or per order depending on the company, which is why the cheapest service changes with the number of things you buy. For a Mercari purchase: ${P.map((x) => `${esc(x.name)} ${feeText(x.p.serviceFee.bySource.mercari)}`).join(", ")}.`],
      ["domestic-shipping", "Domestic shipping", `Postage from the seller to the proxy's warehouse inside Japan, paid by you even when the listing says "free shipping" to Japanese buyers. Buyee gives a range of ¥150–1,500 per order. It is the one cost on this site you enter yourself, because it is set by each seller.`],
      ["yahoo-auctions", "Yahoo! Auctions (JDirectItems)", `Japan's largest auction site. Some proxies list its items under the name JDirectItems. Auction purchases generally cannot be cancelled once won${zen?.cancelFee ? `; ZenMarket, for example, does not allow cancellation of auction or flea-market purchases at all` : ""}.`],
      ["mercari", "Mercari Japan", `A second-hand flea-market app, and the most common source for proxy purchases. ${nameOf("zenmarket")} charges more for Mercari items (${yen(zen?.serviceFee.bySource.mercari ?? 0)}) than for most shops.`],
      ["direct-shop", "Direct-shipping shop", `A Japanese shop that sells to overseas customers itself, so no proxy fees apply. Only relevant to new items; second-hand and auction items are only available through a proxy.${directShops.length ? ` On this site: ${listJoin(directShops.map((s) => `${esc(s.name)} (${esc(s.sellsEn)})`))}.` : ""}`],
    ]],
    ["Fees", [
      ["deposit-fee", "Deposit or payment fee", `A percentage charged on the money you pay in. ZenMarket's is ${pct(zen?.paymentFee?.rate ?? 0, 1)} of the whole transaction, which works out at about ${pct((zen?.paymentFee?.rate ?? 0) / (1 - (zen?.paymentFee?.rate ?? 0)), 2)} on top of what you actually need. ${listJoin(P.filter((x) => x.p.paymentFee?.type === "none").map((x) => esc(x.name)))} charge none.`],
      ["packing-fee", "Packing fee", `What the proxy charges to box your items. ${listJoin(P.filter((x) => x.p.packingFee?.type === "included").map((x) => esc(x.name)))} include it in the service fee; ${listJoin(P.filter((x) => x.p.packingFee?.type === "weight").map((x) => esc(x.name)))} charge${P.filter((x) => x.p.packingFee?.type === "weight").length === 1 ? "s" : ""} by weight.`],
      ["protection-plan", "Protection plan", `An optional or bundled package covering things like shipping insurance and inspection. ${buyee ? `Buyee sells ${buyee.plans.length} plans from ${yen(Math.min(...buyee.plans.map((x) => x.fee)))} to ${yen(Math.max(...buyee.plans.map((x) => x.fee)))}; this site prices Buyee on its free plan.` : ""}`],
      ["photo-service", "Photo service", `Photographs of an item taken at the warehouse before it ships, useful on second-hand purchases. ${P.filter((x) => x.p.photoService).map((x) => `${esc(x.name)} charges ${yen(x.p.photoService.amount)} for ${x.p.photoService.photos}`).join("; ")}.`],
      ["export-clearance", "Export clearance fee", `A charge for customs paperwork on high-value parcels leaving Japan. ${listJoin(clearance)}.`],
    ]],
    ["Shipping", [
      ["storage", "Free storage period", `How long a proxy holds your purchases at no charge, counted from arrival at the warehouse: ${storage.join(", ")}. Past it, storage is charged and items are eventually disposed of.`],
      ["consolidation", "Consolidation", `Sending several purchases together in one box. Because postage is charged by weight band, one heavier box usually costs much less than several light ones: three 1 kg parcels sent as one 3 kg box save ${yen(consolidation.at(-1).s)} to ${yen(consolidation[0].s)} in EMS postage, depending on the country.`],
      ["ems", "EMS", `Japan Post's express international service, tracked, offered by every proxy. 1 kg to the United States costs ${yen(emsUS1k)}.`],
      ["weight-band", "Weight band", `Postage is charged by bands, not by the gram: a parcel pays for the whole band it falls in. EMS bands used on this site end at ${listJoin(bands.map((g) => g >= 1000 ? `${g / 1000} kg` : `${g} g`))}.`],
      ["zone", "Postal zone", `Japan Post groups countries into price zones. Zone ${ems.targetCountries.find((c) => c.code === "TW").zone} includes Taiwan; zone ${ems.targetCountries.find((c) => c.code === "HK").zone} Hong Kong and Singapore; zone ${ems.targetCountries.find((c) => c.code === "GB").zone} Europe, Canada and Australia; zone ${ems.targetCountries.find((c) => c.code === "US").zone} the United States.`],
      ["small-packet", "Airmail small packet", `A Japan Post service for items up to 2 kg, much cheaper than EMS at low weights: 1 kg to the United States costs ${yen(spUS1k)} against ${yen(emsUS1k)} by EMS.`],
      ["surface", "Surface (sea) parcel", `A parcel sent by ship: the cheapest for heavy parcels and the slowest. 5 kg to the United States costs ${yen(seaUS5k)} against ${yen(emsUS5k)} by EMS.`],
      ["sal", "SAL (economy air)", `A Japan Post service between air and sea. It is still in Japan Post's rate tables, but Japan Post states that SAL acceptance is suspended entirely, so it is not offered on this site.`],
    ]],
    ["Tax and customs", [
      ["import-vat", "Import VAT or GST", `A consumption tax your own country charges on imported goods, usually on the item plus the international postage. ${countries.filter((cc) => importTax.countries[cc]?.vatRate).map((cc) => `${esc(countryName(cc))} ${pct(importTax.countries[cc].vatRate, importTax.countries[cc].vatRate * 100 % 1 ? 1 : 0)}`).join(", ")}.`],
      ["de-minimis", "Duty-free limit (de minimis)", `A value below which parcels enter without duty or tax. Several have been removed recently: ${listJoin(countries.filter((cc) => ["removed", "suspended"].includes(importTax.countries[cc]?.deMinimis?.status)).map((cc) => esc(countryName(cc))))} no longer have one for these parcels.`],
      ["prepaid-tax", "Tax collected up front", `Some proxies collect your country's VAT or GST at checkout, so nothing is due when the parcel arrives. The amount is the same; only the timing changes. For the United Kingdom: ${listJoin(prepayers("GB").map(esc)) || `none of the ${NW}`}.`],
      ["handling-fee", "Courier handling fee", `What a courier charges for paying your import tax at the border on your behalf. None of the ${NW} proxies publish it and it varies by carrier, so it is not in any total on this site.`],
      ["hs-code", "HS code", `The international classification number for a product, which decides the customs duty rate. Because duty depends on what the item is, totals where duty applies but cannot be pinned down are marked as minimums.`],
      ["landed-cost", "Landed cost", `Everything you pay to get an item into your hands: item, fees, postage inside Japan, international postage and import tax. A ¥10,000 Mercari item sent 1 kg to the United Kingdom lands at ${yen(gbBest.grandTotal)} through ${esc(gbBest.name)}.`],
    ]],
    ["What can be sent", [
      ["prohibited", "Prohibited and restricted items", `Things a proxy or Japan Post will not send. ${allRefuse.length ? `${cap(listJoin(allRefuse.map((a) => esc(a.seoLabelEn ?? a.labelEn.toLowerCase()))))} are refused by all ${NW} to all nine countries on this site.` : ""} Refusal happens at the warehouse, after you have paid for the item.`],
      ["lithium", "Lithium battery rule", `Anything with a built-in battery, from LED figure bases to handheld consoles, is judged as a battery. ${lithiumPost.length ? `Japan Post will not carry them to ${listJoin(lithiumPost.map(esc))} at all.` : ""} Examples: ${esc(lithium?.helpEn ?? "")}.`],
    ]],
  ];
  const glossaryBody = `
  <h1>Glossary</h1>
  <p>The words that come up when buying from Japan through a proxy, each with what it means on this site's own numbers.</p>
  ${groups.map(([g, terms]) => `<h2>${g}</h2><dl class="glossary">${terms.map(([id, term, def]) => `<dt id="${id}">${term}</dt><dd>${def}</dd>`).join("")}</dl>`).join("")}
  <nav class="related"><h2>Related</h2><ul><li><a href="/faq">Frequently asked questions</a></li><li><a href="/guides/how-proxy-buying-works">How proxy buying works, step by step</a></li></ul></nav>`;

  // ---- よくある質問 ----
  let total = 0; const wins = Object.fromEntries(P.map((x) => [x.id, 0]));
  for (const cc of countries) for (const s of Object.keys(SOURCE_NAMES)) for (const w of [500, 1000, 2000, 5000]) for (const pr of [3000, 10000, 50000]) for (const n of [1, 3]) {
    const r = run({ ...base, destination: cc, source: s, weightG: w, itemPriceJpy: pr, itemCount: n, sameShop: n > 1 });
    total++; const b = r.results[0].grandTotal; for (const x of r.results) if (x.grandTotal === b) wins[x.proxyId]++;
  }
  const topWin = P.map((x) => ({ ...x, n: wins[x.id] })).sort((a, b) => b.n - a.n);
  const usBest = us.results[0];
  const taxRows = countries.map((cc) => { const r = run({ ...base, destination: cc }).results[0]; return { cn: countryName(cc), tax: amountOf(r, "tax"), min: r.grandTotalIsMinimum }; });
  const refusedSunk = (() => { const r = run({ ...base, destination: "US", source: "yahoo_auction" }).results[0]; return amountOf(r, "item") + amountOf(r, "domestic") + amountOf(r, "service"); })();
  const feeShare = amountOf(gbBest, "service") / (gbBest.grandTotal - 10000);

  const faqs = [
    ["Which Japan proxy service is cheapest?", `It depends on the order. Across ${total.toLocaleString("en-US")} orders priced on this site, ${esc(topWin[0].name)} was cheapest or joint cheapest on ${topWin[0].n.toLocaleString("en-US")} (${pct(topWin[0].n / total)}), ${esc(topWin[1].name)} on ${topWin[1].n.toLocaleString("en-US")}. The full count is in <a href="/guides/which-proxy-is-cheapest">which proxy is cheapest</a>.`],
    ["How much does it cost to ship from Japan to the United States?", `By EMS, ${yen(emsUS1k)} for a 1 kg parcel; by airmail small packet, ${yen(spUS1k)}. A ¥10,000 Mercari item, 1 kg, comes to ${yen(usBest.grandTotal)} through ${esc(usBest.name)} before US duty, which depends on the item. See <a href="/import-tax-united-states">buying from Japan to the United States</a>.`],
    ["Do I pay import tax on things from Japan?", `In most countries, yes. On a ¥10,000, 1 kg order: ${taxRows.map((r) => `${esc(r.cn)} ${r.min ? "depends on the item" : r.tax ? yen(r.tax) : "nothing"}`).join(", ")}. See <a href="/import-tax">import tax by country</a>.`],
    ["How much US duty will I pay on things from Japan?", `Since ${fmtDate(importTax.countries.US.dutyEstimate.effectiveFrom)}, goods made in Japan pay 12.5% where the normal US duty is lower, which covers figures, model kits, cards and game consoles: about ${dutyCell(importTax.countries.US, 10000, "scale_figure").replace(/^about /, "")} on a ¥10,000 figure. Books, manga and CDs are exempt. The totals on this site leave it out because the exact rate depends on the item. See <a href="/import-tax-united-states#how-much-duty">US duty</a>.`],
    ["Can I pay the import tax before the parcel arrives?", `With some services, for some countries. To the United Kingdom, ${listJoin(prepayers("GB").map(esc)) || `none of the ${NW}`} collect${prepayers("GB").length === 1 ? "s" : ""} it at checkout; to Australia, ${listJoin(prepayers("AU").map(esc)) || "none"}${unpublished("AU").length ? ` (${listJoin(unpublished("AU").map(esc))} also says it does, without publishing the rate)` : ""}. See <a href="/guides/paying-import-tax-up-front">paying tax up front</a>.`],
    ["Which proxy service lets me store items longest?", `Free storage periods are ${storage.join(", ")}. A longer period gives you more time to collect several purchases into one parcel.`],
    ["Does combining parcels really save money?", `Usually a lot. Three 1 kg items sent in one box instead of three save ${yen(consolidation.at(-1).s)} to ${yen(consolidation[0].s)} in EMS postage, the most to ${esc(consolidation[0].cn)}. See <a href="/guides/consolidating-parcels">consolidating parcels</a>.`],
    ["What is the cheapest way to post a parcel from Japan?", `For anything under 2 kg, usually an airmail small packet; for heavier parcels, surface mail. A 5 kg parcel to the United States costs ${yen(seaUS5k)} by sea against ${yen(emsUS5k)} by EMS, but takes much longer. See <a href="/guides/shipping-methods">shipping methods</a>.`],
    ["Can I get a Nintendo Switch or anything with a battery shipped?", `${lithiumPost.length ? `Not by Japan Post to ${listJoin(lithiumPost.map(esc))}. ` : ""}Elsewhere, ${listJoin(P.filter((x) => SHIPS.includes(run({ ...base, destination: "US", attributes: ["lithium_battery"] }).results.find((y) => y.proxyId === x.id).shippable.level)).map((x) => esc(x.name)))} accept devices with built-in batteries by EMS, under conditions. See <a href="/guides/buying-game-consoles-from-japan">game consoles</a>.`],
    ["Can I ship model paint or spray cans from Japan?", `No. ${allRefuse.length ? `${cap(listJoin(allRefuse.map((a) => esc(a.seoLabelEn ?? a.labelEn.toLowerCase()))))} are refused by all ${NW} services to every country on this site.` : ""} See <a href="/what-you-cannot-ship-from-japan">what you cannot ship</a>.`],
    ["What happens if my item cannot be exported?", `It is refused at the warehouse, after you have paid. On a ¥10,000 Yahoo! Auctions win that is about ${yen(refusedSunk)} already spent on the item, the postage inside Japan and the service fee, with disposal charged on top at some services.`],
    ["Why is the total so much higher than the service fee?", `The advertised fee is a small part of it. On a ¥10,000 order to the United Kingdom, the service fee is ${yen(amountOf(gbBest, "service"))}, ${pct(feeShare)} of the ${yen(gbBest.grandTotal - 10000)} you pay on top of the item. Postage and tax are most of the rest.`],
    ["Do I need a proxy for new items from Japanese shops?", `Not always. Some Japanese shops sell overseas directly${directShops.length ? `, such as ${listJoin(directShops.map((s) => esc(s.name)))}` : ""}, which avoids proxy fees entirely. For second-hand marketplaces and auctions, a proxy is the only way.`],
    ["How accurate are the numbers on this site?", `Fees were checked against each company's own pages on ${esc(proxies._meta.updated)}; Japan Post rates on ${esc(data.post?._meta?.updated ?? ems._meta.updated)}. They are estimates: companies change prices and customs has the final say. The method is set out in <a href="/how-we-calculate">how we calculate</a>.`],
  ];
  const faqBody = `
  <h1>Frequently asked questions</h1>
  <p>Short answers to the questions people ask before buying from Japan through a proxy, worked out from the same data as the calculator.</p>
  ${faqs.map(([q, a]) => `<h2>${esc(q)}</h2><p>${a}</p>`).join("")}
  <nav class="related"><h2>Related</h2><ul><li><a href="/glossary">Glossary</a></li><li><a href="/guides">All guides</a></li></ul></nav>`;
  const faqJsonLd = JSON.stringify({
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/<[^>]+>/g, "") } })),
  }).replace(/</g, "\\u003c");

  return [
    {
      path: "/glossary", layout: "content-only", prefill: null,
      title: "Glossary of Japan proxy shopping terms",
      description: "Service fees, consolidation, EMS weight bands, de minimis, tax collected up front and more, each explained with real figures.",
      body: glossaryBody,
    },
    {
      path: "/faq", layout: "content-first", prefill: { ...base, destination: "US" },
      title: "Japan proxy shopping: frequently asked questions",
      description: `Which proxy is cheapest, what shipping to the US costs, import tax by country, batteries, storage and more, answered with real figures.`,
      body: faqBody,
      jsonLd: faqJsonLd,
    },
  ];
}
