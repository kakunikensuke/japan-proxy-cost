/**
 * 読み物（ガイド6本）と、ナビゲーションの入口になるハブ3本（/compare・/import-tax・/guides）。
 *
 * ■ なぜ作るか（2026-10-01）
 * AdSense の審査で見られるのは「このサイトは読者に何を教えてくれるか」。計算ページだけでは
 * 同じ形のページが並ぶサイトに見える。ここでは計算エンジンを横断的に回した結果
 * （1,512通りの注文でどこが最安か、9か国のEMS料金の階段、など）を読み物として出す。
 *
 * ■ 鉄則
 * 数字はすべて calculateAll / lookupEmsRate / data/*.json から出す。記憶や一般論で金額や規則を書かない。
 * データに無いこと（各マーケットの規約、配送日数など）は書かない。
 */
import { calculateAll, lookupEmsRate } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { amountOf, costBarHtml, legendHtml, SOURCE_NAMES } from "./enrich.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const listJoin = (arr) => arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const kg = (g) => (g >= 1000 ? `${+(g / 1000).toFixed(1)} kg` : `${g} g`);
const related = (items) => `<nav class="related"><h2>Related</h2><ul>${items.map((i) => `<li><a href="${i.href}">${esc(i.text)}</a></li>`).join("")}</ul></nav>`;

export const GUIDES = [
  { slug: "how-proxy-buying-works", title: "How buying from Japan through a proxy works, step by step", blurb: "Every charge between clicking buy and the parcel landing, in the order you pay it." },
  { slug: "which-proxy-is-cheapest", title: "Which Japan proxy is cheapest? 1,512 orders priced", blurb: "Four services, seven marketplaces, nine countries: how often each one actually wins." },
  { slug: "consolidating-parcels", title: "Consolidating parcels from Japan: when one box saves money", blurb: "What combining purchases saves in postage to each country, and what storage costs while you wait." },
  { slug: "ems-weight-bands", title: "EMS from Japan: the weight bands and what each step costs", blurb: "The full EMS price table for nine countries, and where a few grams cost a whole step." },
  { slug: "is-it-worth-it", title: "When is an item from Japan worth the shipping?", blurb: "How much the overhead adds at each item price, and where it drops below half the item's cost." },
  { slug: "paying-import-tax-up-front", title: "Paying import tax up front or on delivery: what each proxy does", blurb: "Which services collect VAT or GST at checkout for which countries, and the limits on it." },
];

export function buildGuides(data, { COUNTRY_SLUGS, versusPath, countryName }) {
  const { proxies, ems, importTax } = data;
  const countries = Object.keys(COUNTRY_SLUGS);
  const ids = proxies.proxies.map((p) => ({ id: p.id, name: p.shortName ?? p.name, p }));
  const run = (input) => calculateAll(input, data);
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, domesticShippingJpy: 700, buyeePlan: "light" };
  const pages = [];
  const hl = {};   // 各ガイドの要点。/guides のハブに並べる

  // =========================================================================
  // ハブ: /compare
  // =========================================================================
  {
    const rows = countries.map((cc) => ({ cc, res: run({ ...base, destination: cc }) }));
    const winCount = Object.fromEntries(ids.map((x) => [x.id, 0]));
    for (const { res } of rows) {
      const best = res.results[0].grandTotal;
      for (const r of res.results) if (r.grandTotal === best) winCount[r.proxyId]++;
    }
    const tr = rows.map(({ cc, res }) => {
      const best = res.results[0].grandTotal;
      return `<tr><td><a href="/cheapest-proxy-from-japan-to-${COUNTRY_SLUGS[cc]}">${esc(countryName(cc))}</a></td>${ids.map((x) => {
        const r = res.results.find((y) => y.proxyId === x.id);
        return `<td class="num"${r.grandTotal === best ? ' style="background:var(--green-soft);font-weight:600"' : ""}>${yen(r.grandTotal)}</td>`;
      }).join("")}</tr>`;
    }).join("");
    const ranking = ids.map((x) => ({ ...x, n: winCount[x.id] })).sort((a, b) => b.n - a.n);
    const pairs = [];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) pairs.push([ids[a], ids[b]]);

    pages.push({
      path: "/compare",
      layout: "content-only",
      prefill: null,
      title: "Compare Japan proxy services: Buyee, ZenMarket, Neokyo and FROM JAPAN",
      description: `The same order priced through all four proxy services for ${countries.length} countries, with ${pairs.length * countries.length} head-to-head comparisons.`,
      body: `
  <h1>Compare Japan proxy services</h1>
  <p>The same ¥10,000, 1 kg Mercari Japan order, priced through all four services for each of the ${countries.length} countries this
  site covers. Green marks the cheapest. Every comparison below works out the total for its own pair and country.</p>
  <h2>One order, nine destinations</h2>
  <p>${ranking.filter((x) => x.n).map((x) => `${esc(x.name)} is cheapest (or joint cheapest) for ${x.n} of ${countries.length}`).join("; ")}.
  ${ranking.filter((x) => !x.n).length ? `${listJoin(ranking.filter((x) => !x.n).map((x) => esc(x.name)))} ${ranking.filter((x) => !x.n).length === 1 ? "is" : "are"} not cheapest anywhere on this particular order, which says more about the order than the service: change the weight, the price or the number of items and the ranking moves, as the comparisons show.` : ""}</p>
  <table><thead><tr><th>Ship to</th>${ids.map((x) => `<th class="num">${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">Import tax is included where it can be calculated. For the United States and Canada it depends on the item or the province, so those totals leave it out. Postage is identical across the four; the differences are fees and tax timing.</p>

  <h2>Country by country</h2>
  <ul>${rows.map(({ cc, res }) => {
    const best = res.results[0], worst = res.results.at(-1);
    const KEYS = { service: "service fee", packing: "packing", payment: "payment fee", plan: "protection plan" };
    const why = Object.keys(KEYS).map((k) => ({ k, d: amountOf(worst, k) - amountOf(best, k) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d)[0];
    const tied = res.results.filter((r) => r.grandTotal === best.grandTotal).map((r) => esc(r.name));
    return `<li><strong>${esc(countryName(cc))}:</strong> ${tied.length > 1 ? `${listJoin(tied)} tie at ${yen(best.grandTotal)}` : `${esc(best.name)} is cheapest at ${yen(best.grandTotal)}`}${worst.grandTotal > best.grandTotal ? `; ${esc(worst.name)} costs ${yen(worst.grandTotal - best.grandTotal)} more${why ? `, mostly its ${KEYS[why.k]}` : ""}` : ""}.</li>`;
  }).join("")}</ul>
  <p>Postage is the same for all four, so these gaps are made entirely of fees and, where it applies, of whether a service collects the tax at checkout.</p>
  <h2>Head-to-head comparisons</h2>
  <p>Each page prices the pair on 24 different orders, shows which lines of the bill differ, compares what each will ship to that
  country, and explains when you pay the tax.</p>
  ${countries.map((cc) => `<h3>${esc(countryName(cc))}</h3><ul>${pairs.map(([a, b]) => `<li><a href="${versusPath(a.id, b.id, cc)}">${esc(a.name)} vs ${esc(b.name)}</a></li>`).join("")}</ul>`).join("")}

  <h2>Fees for each service</h2>
  <ul>${ids.map((x) => `<li><a href="/${x.id}-fees">${esc(x.name)} fees explained</a></li>`).join("")}</ul>
  ${related([
    { href: "/guides/which-proxy-is-cheapest", text: "Which proxy is cheapest? 1,512 orders priced" },
    { href: "/import-tax", text: "Import tax by country" },
  ])}`,
    });
  }

  // =========================================================================
  // ハブ: /import-tax
  // =========================================================================
  {
    const rows = countries.map((cc) => {
      const c = importTax.countries[cc];
      const res = run({ ...base, destination: cc });
      const best = res.results[0];
      const prepay = ids.filter((x) => (x.p.taxPrepay ?? []).some((t) => t.country === cc && t.rate && (!t.onlyCarriers || t.onlyCarriers.includes("ems"))));
      // 事前徴収すると書いているが税率を公開していない会社。計算上は「到着時払い」扱いだが、表で「なし」とは書かない
      const prepayUnpublished = ids.filter((x) => (x.p.taxPrepay ?? []).some((t) => t.country === cc && (t.unverifiedRate || t.rate == null) && (!t.onlyCarriers || t.onlyCarriers.includes("ems"))));
      return { cc, c, best, prepay, prepayUnpublished };
    });
    const rate = (c) => c.vatRate === 0 ? "none" : c.vatRate != null ? pct(c.vatRate, c.vatRate * 100 % 1 ? 1 : 0) : (c.vatRateStatus === "varies-by-province" ? "5–15% by province" : "by item (duty)");
    const limit = (c) => {
      const d = c.deMinimis ?? {};
      if (d.status === "active") return esc(d.thresholdLabelEn ?? `${d.currency} ${d.dutyThreshold}`);
      if (d.status === "suspended") return "suspended";
      if (d.status === "removed") return "abolished";
      if (d.status === "not-applicable") return "not needed";
      return "—";
    };
    const tr = rows.map((x) => `<tr><td><a href="/import-tax-${COUNTRY_SLUGS[x.cc]}">${esc(x.c.name)}</a></td><td>${esc(x.c.vatLabel ?? (x.c.vatRate ? "VAT" : "—"))}</td><td>${rate(x.c)}</td><td>${limit(x.c)}</td><td>${[...x.prepay.map((p) => esc(p.name)), ...x.prepayUnpublished.map((p) => `${esc(p.name)} (rate not published)`)].join(", ") || "none"}</td><td class="num">${x.best.grandTotalIsMinimum ? "not estimated" : yen(amountOf(x.best, "tax"))}</td></tr>`).join("");
    const taxed = rows.filter((x) => !x.best.grandTotalIsMinimum && amountOf(x.best, "tax") > 0).sort((a, b) => amountOf(b.best, "tax") - amountOf(a.best, "tax"));
    const free = rows.filter((x) => !x.best.grandTotalIsMinimum && amountOf(x.best, "tax") === 0);
    const unknown = rows.filter((x) => x.best.grandTotalIsMinimum);

    pages.push({
      path: "/import-tax",
      layout: "content-only",
      prefill: null,
      title: "Import tax on parcels from Japan, country by country",
      description: `VAT, GST and duty-free limits for ${countries.length} countries, which proxy services collect the tax at checkout, and what it adds to a typical order.`,
      body: `
  <h1>Import tax on parcels from Japan</h1>
  <p>The tax is set by the country you live in, not by the proxy you choose. What the proxy decides is only when you pay it: at checkout, or to the courier when the parcel arrives.</p>
  <h2>The rules for each country</h2>
  <table><thead><tr><th>Country</th><th>Tax</th><th>Rate</th><th>Duty-free limit</th><th>Collected at checkout by</th><th class="num">On a ¥10,000 order</th></tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">"On a ¥10,000 order" is a Mercari Japan item, 1 kg packed, through the cheapest service. "Collected at checkout by" counts only services that do so on EMS parcels; a rule that applies only to a courier service is not counted.</p>
  <h2>Country by country</h2>
  <ul>${rows.map((x) => `<li><strong><a href="/import-tax-${COUNTRY_SLUGS[x.cc]}">${esc(x.c.name)}</a>:</strong> ${esc(x.c.displayEn?.body ?? "")}</li>`).join("")}</ul>
  <h2>What that adds to an order</h2>
  <p>${taxed.length ? `On the same order, the tax ranges from ${yen(amountOf(taxed[0].best, "tax"))} for ${esc(taxed[0].c.name)} down to ${yen(amountOf(taxed.at(-1).best, "tax"))} for ${esc(taxed.at(-1).c.name)}.` : ""}
  ${free.length ? `${listJoin(free.map((x) => esc(x.c.name)))} ${free.length === 1 ? "charges" : "charge"} nothing on it, ${free.some((x) => x.c.vatRate === 0) ? "because there is no import tax on general goods" : "because the order falls under the duty-free limit"}.` : ""}
  ${unknown.length ? `For ${listJoin(unknown.map((x) => esc(x.c.name)))} the amount depends on the item or on where you live, so it is not estimated rather than guessed.` : ""}
  Most of these taxes are charged on the goods plus the international postage, so on a cheap item they come to more than the headline rate of the item price alone.</p>
  <h2>Why it matters who collects it</h2>
  <p>A service that collects the tax at checkout looks more expensive at the moment you pay, and one that leaves it to the courier
  looks cheaper. Neither is true: the tax is the same, it is just paid at a different time. That is why every total on this site is split into
  what you pay now and what you pay on arrival. Where it is paid on arrival, the courier normally adds a handling charge for having
  paid it on your behalf, which none of the four services publish and which is therefore not in the totals.</p>
  ${related([
    { href: "/guides/paying-import-tax-up-front", text: "Paying import tax up front or on delivery" },
    { href: "/compare", text: "Compare the four services" },
  ])}`,
    });
  }

  // =========================================================================
  // Guide 1: how it works
  // =========================================================================
  {
    const cc = "GB";
    const cn = countryName(cc);
    const res = run({ ...base, destination: cc });
    const best = res.results[0];
    const svc = (src) => ids.map((x) => {
      const v = x.p.serviceFee.bySource[src];
      const amount = typeof v === "object" ? v.amount : v;
      return `${esc(x.name)} ${yen(amount)}`;
    }).join(", ");
    const steps = [
      ["item", "The item", amountOf(best, "item")],
      ["service", "Service fee", amountOf(best, "service") + amountOf(best, "plan")],
      ["domestic", "Postage to the warehouse", amountOf(best, "domestic")],
      ["packing", "Packing", amountOf(best, "packing")],
      ["intl", "International postage", amountOf(best, "intl")],
      ["payment", "Payment fees", amountOf(best, "payment")],
      ["tax", "Import tax", amountOf(best, "tax")],
    ];
    let running = 0;
    const tr = steps.map(([, label, amount]) => { running += amount; return `<tr><td>${label}</td><td class="num">${amount ? yen(amount) : "—"}</td><td class="num">${yen(running)}</td></tr>`; }).join("");
    const storage = ids.map((x) => `${esc(x.name)} ${x.p.storage?.freeDays ?? "?"} days`).join(", ");
    const intlShare = amountOf(best, "intl") / best.grandTotal;
    hl["how-proxy-buying-works"] = `A ¥10,000 item sent to ${esc(cn)} costs ${yen(best.grandTotal)} by the time it arrives. The advertised service fee is ${yen(amountOf(best, "service"))} of that.`;
    const zen = ids.find((x) => x.id === "zenmarket")?.p;
    const buyee = ids.find((x) => x.id === "buyee")?.p;
    const INC = { storage60d: "60 days of storage", consolidation: "consolidation", inspection: "an inspection on arrival", international_insurance: "shipping insurance", domestic_trade_guarantee: "a guarantee on the purchase in Japan" };

    pages.push({
      path: "/guides/how-proxy-buying-works",
      layout: "content-first",
      prefill: { ...base, destination: cc },
      title: "How buying from Japan through a proxy works, step by step",
      description: `Every charge between clicking buy and the parcel landing, in the order you pay it. Worked through on a real ¥10,000 order to ${cn}.`,
      body: `
  <h1>How buying from Japan through a proxy works</h1>
  <p>A proxy is a company in Japan that buys on your behalf, receives the item at its warehouse, and posts it to you. Each of those steps has its own charge. Here they are in order, on one real order: a ¥10,000 item from Mercari Japan, 1 kg once packed, sent by EMS to ${esc(cn)} through ${esc(best.name)}, the cheapest service for it.</p>
  <div class="verdict"><p class="v">The ¥10,000 item costs ${yen(best.grandTotal)} by the time it reaches you. That is ${pct((best.grandTotal - 10000) / 10000)} more than the item's own price.</p>
  ${costBarHtml(best, best.grandTotal)}<div style="height:12px"></div>${legendHtml([best])}</div>
  <h2>The steps, and what each one costs</h2>
  <ol>
    <li><strong>You ask the proxy to buy it.</strong> You pay the item price and the proxy's service fee. For a Mercari purchase the fee is ${svc("mercari")}. Some charge per item and some per purchase, which matters as soon as you buy more than one thing.</li>
    <li><strong>The seller posts it to the proxy's warehouse in Japan.</strong> You pay this domestic postage too. It is set by the seller, so it is the one number you have to read off the listing. This example uses ¥700.</li>
    <li><strong>It waits in storage.</strong> Each service holds purchases for free for a while (${storage}) so you can collect several and ship them together. After that, storage is charged.</li>
    <li><strong>It is packed.</strong> ${listJoin(ids.filter((x) => x.p.packingFee?.type === "included").map((x) => esc(x.name)))} include packing in the service fee; ${listJoin(ids.filter((x) => x.p.packingFee?.type === "weight").map((x) => esc(x.name)))} charge${ids.filter((x) => x.p.packingFee?.type === "weight").length === 1 ? "s" : ""} for it by weight.</li>
    <li><strong>It is posted overseas.</strong> EMS to ${esc(cn)} costs ${yen(amountOf(best, "intl"))} at 1 kg, the same whichever proxy sends it. On this order that is ${pct(intlShare)} of the whole bill, the largest single line after the item itself.</li>
    <li><strong>Paying can cost extra.</strong>${ids.filter((x) => x.p.paymentFee?.type === "rate").map((x) => `${esc(x.name)} adds ${pct(x.p.paymentFee.rate, 1)} of the whole transaction`).join("; ") || "None of the four adds a percentage"}; ${listJoin(ids.filter((x) => x.p.paymentFee?.type === "none").map((x) => esc(x.name)))} add nothing${ids.some((x) => !["rate", "none"].includes(x.p.paymentFee?.type)) ? `, and ${listJoin(ids.filter((x) => !["rate", "none"].includes(x.p.paymentFee?.type)).map((x) => esc(x.name)))} does not publish one` : ""}.</li>
    <li><strong>It clears customs in ${esc(cn)}.</strong> ${amountOf(best, "tax") ? `${yen(amountOf(best, "tax"))} of VAT on this order, charged on the item plus the international postage.` : "No tax is due on this order."} Some services collect it at checkout; otherwise the courier collects it at the door.</li>
  </ol>
  <h2>The running total</h2>
  <table><thead><tr><th>Step</th><th class="num">Adds</th><th class="num">Running total</th></tr></thead><tbody>${tr}</tbody></table>
  <p>The service fee everyone advertises is ${yen(amountOf(best, "service"))} of the ${yen(best.grandTotal - 10000)} you pay on top of the item. Postage and tax are most of the rest, and those do not change whichever proxy you pick. That is why the cheapest service on one order is not automatically the cheapest on the next: the parts that differ are small, and they are charged on different units.</p>
  <h2>Protection plans and what is included</h2>
  <p>Some services bundle extras into the fee and some sell them separately. ${listJoin(ids.filter((x) => (x.p.included ?? []).length).map((x) => esc(x.name)))} include${ids.filter((x) => (x.p.included ?? []).length).length === 1 ? "s" : ""} ${listJoin([...new Set(ids.flatMap((x) => x.p.included ?? []))].map((i) => INC[i] ?? i))} in the service fee. ${buyee ? `Buyee offers ${buyee.plans.length} plans instead, from ${yen(Math.min(...buyee.plans.map((p) => p.fee)))} to ${yen(Math.max(...buyee.plans.map((p) => p.fee)))}:` : ""}</p>
  ${buyee ? `<table><thead><tr><th>Buyee plan</th><th class="num">Fee</th><th>Shipping guarantee</th><th>Inspection</th></tr></thead><tbody>${buyee.plans.map((p) => `<tr><td>${esc(p.nameEn ?? p.name)}</td><td class="num">${yen(p.fee)}</td><td>${p.shippingGuarantee ? "Yes" : "No"}</td><td>${p.inspection ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table>
  <p>The totals on this site use the free Light plan, so Buyee is compared at its cheapest. If you would take the Standard plan anyway, add ${yen(buyee.plans.find((p) => p.id === "standard")?.fee ?? 0)} to its totals before comparing.</p>` : ""}
  <h2>Where it goes wrong</h2>
  <p><strong>The item cannot be exported.</strong> Paint, spray cans, lighters, batteries and replica weapons are refused by some or all of the four, and you find out at the warehouse, after you have paid for the item and the postage to get it there. Check <a href="/what-you-cannot-ship-from-japan">what cannot ship</a> before you bid.</p>
  <p><strong>You change your mind.</strong> ${zen?.cancelFee ? `ZenMarket, for example, charges ${yen(zen.cancelFee.amount)} to cancel once an item has reached the warehouse, and auction and flea-market purchases cannot be cancelled at all.` : "Cancelling after the purchase is often not possible."}</p>
  <p><strong>You leave it in storage too long.</strong> The free period runs from the day the item reaches the warehouse. Past it, storage is charged daily or weekly, and items left long enough are disposed of without compensation.</p>
  ${related([
    { href: "/guides/which-proxy-is-cheapest", text: "Which proxy is cheapest? 1,512 orders priced" },
    { href: "/guides/consolidating-parcels", text: "When one box saves money" },
    { href: `/import-tax-${COUNTRY_SLUGS[cc]}`, text: `Import tax in ${cn}` },
    { href: "/compare", text: "Compare the four services" },
  ])}`,
    });
  }

  // =========================================================================
  // Guide 2: which is cheapest (1,512 orders)
  // =========================================================================
  {
    const sources = Object.keys(SOURCE_NAMES);
    const weights = [500, 1000, 2000, 5000];
    const prices = [3000, 10000, 50000];
    const counts = [1, 3];
    const wins = Object.fromEntries(ids.map((x) => [x.id, 0]));
    const byCountry = Object.fromEntries(countries.map((c) => [c, Object.fromEntries(ids.map((x) => [x.id, 0]))]));
    const bySource = Object.fromEntries(sources.map((s) => [s, Object.fromEntries(ids.map((x) => [x.id, 0]))]));
    const byCount = Object.fromEntries(counts.map((n) => [n, Object.fromEntries(ids.map((x) => [x.id, 0]))]));
    const byWeight = Object.fromEntries(weights.map((w) => [w, Object.fromEntries(ids.map((x) => [x.id, 0]))]));
    const byPrice = Object.fromEntries(prices.map((p) => [p, Object.fromEntries(ids.map((x) => [x.id, 0]))]));
    let total = 0, gapSum = 0;
    for (const cc of countries) for (const s of sources) for (const w of weights) for (const p of prices) for (const n of counts) {
      const res = run({ ...base, destination: cc, source: s, weightG: w, itemPriceJpy: p, itemCount: n, sameShop: n > 1 });
      const best = res.results[0].grandTotal;
      total++;
      gapSum += res.results.at(-1).grandTotal - best;
      for (const r of res.results) if (r.grandTotal === best) { wins[r.proxyId]++; byCountry[cc][r.proxyId]++; bySource[s][r.proxyId]++; byCount[n][r.proxyId]++; byWeight[w][r.proxyId]++; byPrice[p][r.proxyId]++; }
    }
    const order = ids.map((x) => ({ ...x, n: wins[x.id] })).sort((a, b) => b.n - a.n);
    const top = order[0];
    const cell = (tab) => (x) => `<td class="num">${tab[x.id]}</td>`;
    const countryRows = countries.map((cc) => `<tr><td>${esc(countryName(cc))}</td>${ids.map(cell(byCountry[cc])).join("")}</tr>`).join("");
    const sourceRows = sources.map((s) => `<tr><td>${SOURCE_NAMES[s]}</td>${ids.map(cell(bySource[s])).join("")}</tr>`).join("");
    const perC = total / countries.length, perS = total / sources.length, perN = total / counts.length;
    const leaderOf = (tab) => ids.map((x) => ({ ...x, n: tab[x.id] })).sort((a, b) => b.n - a.n)[0];
    const countryLeaders = [...new Set(countries.map((cc) => leaderOf(byCountry[cc]).name))];
    const oneVsThree = counts.map((n) => leaderOf(byCount[n]));
    // 表の最初の行と最後の行で、勝ち数が一番動いた会社を言う（一般論を書くと表と食い違う）
    const mover = (tab, keys, label) => {
      const a = keys[0], b = keys.at(-1);
      const d = ids.map((x) => ({ ...x, from: tab[a][x.id], to: tab[b][x.id], d: tab[b][x.id] - tab[a][x.id] })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d))[0];
      if (!d.d) return `The counts do not move between ${label(a)} and ${label(b)}.`;
      return `The biggest change is ${esc(d.name)}, which goes from ${d.from} wins at ${label(a)} to ${d.to} at ${label(b)}.`;
    };
    const share = (n) => (n > 0 && n / total < 0.01 ? "under 1%" : pct(n / total));
    hl["which-proxy-is-cheapest"] = `${esc(top.name)} was cheapest or joint cheapest on ${top.n.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} orders. Picking the dearest instead cost ${yen(gapSum / total)} on average.`;

    pages.push({
      path: "/guides/which-proxy-is-cheapest",
      layout: "content-only",
      prefill: null,
      title: `Which Japan proxy is cheapest? ${total.toLocaleString("en-US")} orders priced`,
      description: `We priced ${total.toLocaleString("en-US")} orders through Buyee, ZenMarket, Neokyo and FROM JAPAN. ${top.name} was cheapest (or joint cheapest) on ${top.n.toLocaleString("en-US")} of them.`,
      body: `
  <h1>Which Japan proxy is cheapest?</h1>
  <p>Asking which proxy is cheapest is like asking which phone plan is cheapest: it depends on how you use it. So instead of an opinion, here is a count. We priced ${total.toLocaleString("en-US")} different orders through all four services and counted how often each came out cheapest.</p>
  <div class="verdict"><p class="v">${esc(top.name)} was cheapest, or joint cheapest, on ${top.n.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} orders (${pct(top.n / total)}).</p>
  <p class="cap" style="margin:0">Ties count for every service involved, so the shares add up to more than 100%.</p></div>
  <h2>The orders</h2>
  <p>Every combination of ${countries.length} destination countries, ${sources.length} places to buy (${listJoin(sources.map((s) => SOURCE_NAMES[s]))}),
  ${weights.length} parcel weights (${listJoin(weights.map(kg))}), ${prices.length} item prices (${listJoin(prices.map(yen))}) and one or three items,
  with ¥700 of postage inside Japan and EMS for the international leg. Where three items are bought from a shop, they are treated as one order from the same shop.</p>
  <h2>The overall count</h2>
  <table><thead><tr><th>Service</th><th class="num">Cheapest on</th><th class="num">Share</th></tr></thead><tbody>${order.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.n.toLocaleString("en-US")}</td><td class="num">${share(x.n)}</td></tr>`).join("")}</tbody></table>
  <p>${order.filter((x) => x.n === 0).length ? `${listJoin(order.filter((x) => x.n === 0).map((x) => esc(x.name)))} never came out cheapest on these orders. That does not make ${order.filter((x) => x.n === 0).length === 1 ? "it" : "them"} poor value, since price is not the only thing a service offers, but if price is what you care about it is worth knowing.` : `Every service wins somewhere, which is the point: the answer depends on the order.`}
  On average, choosing the most expensive service instead of the cheapest cost ${yen(gapSum / total)} per order.</p>
  <h2>By destination</h2>
  <p>${countryLeaders.length === 1 ? `${esc(countryLeaders[0])} leads in every country.` : `The leader changes with the country: ${listJoin(countryLeaders.map(esc))} each top at least one.`} Each row is ${perC} orders.</p>
  <table><thead><tr><th>Ship to</th>${ids.map((x) => `<th class="num">${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${countryRows}</tbody></table>
  <h2>By where you buy</h2>
  <p>Some services charge a different fee depending on the marketplace, and one charges per order rather than per item at shops. Each row is ${perS} orders.</p>
  <table><thead><tr><th>Buying from</th>${ids.map((x) => `<th class="num">${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${sourceRows}</tbody></table>
  <h2>By parcel weight</h2>
  <p>${(() => { const l = weights.map((w) => leaderOf(byWeight[w]).name); return [...new Set(l)].length === 1 ? `${esc(l[0])} leads at every weight.` : `The leader changes with weight: ${weights.map((w, i) => `${esc(l[i])} at ${kg(w)}`).join(", ")}.`; })()}
  ${mover(byWeight, weights, kg)} Each row is ${total / weights.length} orders.</p>
  <table><thead><tr><th>Parcel</th>${ids.map((x) => `<th class="num">${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${weights.map((w) => `<tr><td>${kg(w)}</td>${ids.map(cell(byWeight[w])).join("")}</tr>`).join("")}</tbody></table>
  <h2>By item price</h2>
  <p>${(() => { const l = prices.map((p) => leaderOf(byPrice[p]).name); return [...new Set(l)].length === 1 ? `${esc(l[0])} leads at every price.` : `The leader changes with price: ${prices.map((p, i) => `${esc(l[i])} at ${yen(p)}`).join(", ")}.`; })()}
  ${mover(byPrice, prices, yen)} Each row is ${total / prices.length} orders.</p>
  <table><thead><tr><th>Item price</th>${ids.map((x) => `<th class="num">${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${prices.map((p) => `<tr><td>${yen(p)}</td>${ids.map(cell(byPrice[p])).join("")}</tr>`).join("")}</tbody></table>
  <h2>One item or three</h2>
  <p>${oneVsThree[0].id === oneVsThree[1].id
    ? `${esc(oneVsThree[0].name)} leads for both single items and three-item orders, but the margins move: ${ids.map((x) => `${esc(x.name)} ${byCount[1][x.id]} → ${byCount[3][x.id]}`).join(", ")} wins out of ${perN} each.`
    : `Single items favour ${esc(oneVsThree[0].name)}; three-item orders favour ${esc(oneVsThree[1].name)}. Wins out of ${perN} each: ${ids.map((x) => `${esc(x.name)} ${byCount[1][x.id]} → ${byCount[3][x.id]}`).join(", ")}.`}
  A per-item service fee is paid three times on three items; a per-order fee is paid once.</p>
  <h2>So which should you use?</h2>
  <p>For your own order, price it: the calculator on the <a href="/">front page</a> takes a minute. If you just want a default, the count above is the honest answer for typical orders, and the head-to-head pages under <a href="/compare">Compare services</a> show where each pairing flips.</p>
  ${related([
    { href: "/compare", text: "Compare services country by country" },
    { href: "/guides/how-proxy-buying-works", text: "How proxy buying works, step by step" },
  ])}`,
    });
  }

  // =========================================================================
  // Guide 3: consolidation
  // =========================================================================
  {
    const rate = (cc, w) => lookupEmsRate(ems, cc, w).amount;
    const scen = [
      { label: "three manga volumes", g: 200, n: 3 },
      { label: "three boxed figures", g: 1000, n: 3 },
    ];
    const rows = countries.map((cc) => ({
      cc, cn: countryName(cc),
      s: scen.map((x) => ({ sep: x.n * rate(cc, x.g), tog: rate(cc, x.g * x.n) })),
    }));
    const tr = rows.map((r) => `<tr><td>${esc(r.cn)}</td>${r.s.map((x) => `<td class="num">${yen(x.sep)}</td><td class="num">${yen(x.tog)}</td><td class="num"><strong>${yen(x.sep - x.tog)}</strong></td>`).join("")}</tr>`).join("");
    const fig = rows.map((r) => ({ cn: r.cn, save: r.s[1].sep - r.s[1].tog })).sort((a, b) => b.save - a.save);
    const manga = rows.map((r) => ({ cn: r.cn, save: r.s[0].sep - r.s[0].tog })).sort((a, b) => b.save - a.save);
    hl["consolidating-parcels"] = `Three boxed figures in one box instead of three save ${yen(fig.at(-1).save)} to ${yen(fig[0].save)} in EMS postage, depending on the country.`;
    const exCc = "GB";
    const exRows = ids.map((x) => {
      const one = run({ ...base, destination: exCc }).results.find((r) => r.proxyId === x.id);
      const box = run({ ...base, destination: exCc, itemPriceJpy: 30000, itemCount: 3, weightG: 3000, domesticShippingJpy: 2100 }).results.find((r) => r.proxyId === x.id);
      return { name: x.name, sep: 3 * one.grandTotal, tog: box.grandTotal };
    });
    const exSorted = [...exRows].sort((a, b) => (b.sep - b.tog) - (a.sep - a.tog));
    const exBest = exSorted[0], exWorst = exSorted.at(-1);
    const neo = ids.find((x) => x.p.packingFee?.type === "weight");
    const neoPack = (w) => { const k = neo.p.packingFee; return k.baseAmount + Math.max(0, Math.ceil((w - k.baseUpToG) / 1000)) * k.perAdditionalKg; };
    const storeRows = ids.map((x) => {
      const s = x.p.storage ?? {};
      const after = s.overstayPerDayPerItem ? `${yen(s.overstayPerDayPerItem)} per item per day`
        : s.overstayDailyByWeightG ? `${yen(s.overstayDailyByWeightG[0].amount)}–${yen(s.overstayDailyByWeightG.at(-1).amount)} a day by weight`
        : s.weeklyBySize ? `${yen(s.weeklyBySize.small.parcel)}–${yen(s.weeklyBySize.large.order)} a week by size` : "not published";
      return `<tr><td>${esc(x.name)}</td><td class="num">${s.freeDays ?? "—"} days</td><td>${after}</td><td>${s.maxDays ? `after ${s.maxDays} days` : s.disposeAfterDays ? `after ${s.disposeAfterDays} days` : s.maxUnpaidWeeks ? `after ${s.maxUnpaidWeeks} unpaid weeks` : "not published"}</td></tr>`;
    }).join("");

    pages.push({
      path: "/guides/consolidating-parcels",
      layout: "content-only",
      prefill: null,
      title: "Consolidating parcels from Japan: when one box saves money",
      description: `Three boxed figures sent together instead of separately save ${yen(fig.at(-1).save)}–${yen(fig[0].save)} in EMS postage, depending on the country. The numbers for nine countries, and what storage costs while you wait.`,
      body: `
  <h1>Consolidating parcels from Japan</h1>
  <p>Consolidation means letting several purchases collect at the proxy's warehouse and sending them in one box. EMS charges by weight band, and the first band is the most expensive per gram, so one heavier box almost always costs less than several light ones.</p>
  <div class="verdict"><p class="v">Three boxed figures sent in one box instead of three save ${yen(fig.at(-1).save)} to ${yen(fig[0].save)} in postage, depending on the country.</p></div>
  <h2>What it saves, country by country</h2>
  <table><thead><tr><th rowspan="2">Ship to</th><th colspan="3">Three manga (200 g each)</th><th colspan="3">Three boxed figures (1 kg each)</th></tr>
  <tr><th class="num">Separately</th><th class="num">One box</th><th class="num">Saved</th><th class="num">Separately</th><th class="num">One box</th><th class="num">Saved</th></tr></thead><tbody>${tr}</tbody></table>
  <p>The saving is largest to ${esc(fig[0].cn)} (${yen(fig[0].save)} on three figures) and smallest to ${esc(fig.at(-1).cn)} (${yen(fig.at(-1).save)}), because the further the zone, the more each EMS band costs.
  For light items the effect is even stronger in proportion: three manga sent separately each pay for a 500 g band, while together they still fit in the 1 kg band. That saves ${yen(manga[0].save)} to ${esc(manga[0].cn)}.</p>
  <h2>Worked through each service</h2>
  <p>Postage is only part of it. Here are three \u00a510,000 boxed figures from Mercari Japan, 1\u00a0kg each, sent to ${esc(countryName(exCc))} through each service: once as three separate orders, once collected and sent as one 3\u00a0kg box. The totals include every fee and the VAT.</p>
  <table><thead><tr><th>Service</th><th class="num">Three parcels</th><th class="num">One box</th><th class="num">Saved</th></tr></thead><tbody>${exRows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${yen(r.sep)}</td><td class="num">${yen(r.tog)}</td><td class="num"><strong>${yen(r.sep - r.tog)}</strong></td></tr>`).join("")}</tbody></table>
  <p>${esc(exBest.name)} saves the most by consolidating, ${yen(exBest.sep - exBest.tog)}; ${esc(exWorst.name)} saves the least, ${yen(exWorst.sep - exWorst.tog)}. The VAT falls too, because it is charged on the goods plus the international postage, and one box pays less postage than three.</p>
  <h2>What packing adds</h2>
  <p>${neo ? `${esc(neo.name)} charges for packing by weight: ${yen(neo.p.packingFee.baseAmount)} up to ${kg(neo.p.packingFee.baseUpToG)}, then ${yen(neo.p.packingFee.perAdditionalKg)} per extra kilogram. Three 1 kg parcels packed separately cost ${yen(3 * neoPack(1000))} in packing; one 3 kg box costs ${yen(neoPack(3000))}. The other three include packing in their service fee, so for them consolidation changes only the postage.` : "All four include packing in the service fee, so consolidation changes only the postage."}</p>
  <h2>How long you can wait</h2>
  <p>Consolidation only works while your purchases are in free storage. The clock starts when each item reaches the warehouse, so the first purchase sets the deadline for the box.</p>
  <table><thead><tr><th>Service</th><th class="num">Free storage</th><th>After that</th><th>Disposed of</th></tr></thead><tbody>${storeRows}</tbody></table>
  <h2>When not to consolidate</h2>
  <p>Do not let a box cross a band boundary for the sake of one more item. The step from ${kg(1000)} to ${kg(1500)} to ${esc(countryName("US"))} is ${yen(rate("US", 1500) - rate("US", 1000))}, more than some of the items you might add. The <a href="/guides/ems-weight-bands">EMS weight bands</a> guide lists every step for every country.</p>
  ${related([
    { href: "/guides/ems-weight-bands", text: "EMS weight bands and what each step costs" },
    { href: "/guides/how-proxy-buying-works", text: "How proxy buying works, step by step" },
  ])}`,
    });
  }

  // =========================================================================
  // Guide 4: EMS weight bands
  // =========================================================================
  {
    const bands = ems.rates.map((r) => r.weightG);
    const byZone = {};
    for (const c of ems.targetCountries) (byZone[c.zone] ||= []).push(c);
    const zones = Object.keys(byZone).sort();
    const tr = bands.map((w) => `<tr><td>Up to ${kg(w)}</td>${zones.map((z) => `<td class="num">${ems.rates.find((r) => r.weightG === w)[z] != null ? yen(ems.rates.find((r) => r.weightG === w)[z]) : "—"}</td>`).join("")}</tr>`).join("");
    const steps = zones.map((z) => {
      const list = bands.map((w) => ({ w, a: ems.rates.find((r) => r.weightG === w)[z] }));
      const jumps = list.slice(1).map((x, i) => ({ from: list[i].w, to: x.w, add: x.a - list[i].a, perKg: (x.a - list[i].a) / ((x.w - list[i].w) / 1000) }));
      return { z, list, jumps, perKgFirst: list[0].a / 0.5, perKgLast: list.at(-1).a / 5 };
    });
    const zoneName = (z) => listJoin(byZone[z].map((c) => esc(c.name)));
    const far = steps.at(-1), near = steps[0];
    const shares = countries.map((cc) => { const r = run({ ...base, destination: cc }).results[0]; return { cn: countryName(cc), share: amountOf(r, "intl") / r.grandTotal }; }).sort((a, b) => b.share - a.share);
    hl["ems-weight-bands"] = `To ${zoneName(far.z)}, a 500 g parcel costs the equivalent of ${yen(far.perKgFirst)} per kg; a 5 kg parcel, ${yen(far.perKgLast)} per kg.`;

    pages.push({
      path: "/guides/ems-weight-bands",
      layout: "content-only",
      prefill: null,
      title: "EMS from Japan: the weight bands and what each step costs",
      description: `Japan Post EMS prices for ${countries.length} countries in one table, and where a few grams over a band costs up to ${yen(Math.max(...steps.flatMap((s) => s.jumps.map((j) => j.add))))}.`,
      body: `
  <h1>EMS from Japan: the weight bands</h1>
  <p>Every total on this site uses Japan Post's EMS, the service all four proxies offer. EMS is not charged by the gram. It is charged in bands, and a parcel pays for the whole band it falls in. Here is the full table for the countries this site covers.</p>
  <h2>The table</h2>
  <table><thead><tr><th>Weight</th>${zones.map((z) => `<th class="num">${zoneName(z)}</th>`).join("")}</tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">Japan Post EMS, checked ${esc(ems._meta.updated)}. Countries in the same column share a price zone. Bands between those shown are not used on this site; a parcel is priced at the next band up.</p>
  <h2>What each extra step costs</h2>
  <p>To ${zoneName(far.z)}, the steps are ${far.jumps.map((j) => `${yen(j.add)} from ${kg(j.from)} to ${kg(j.to)}`).join(", ")}. To ${zoneName(near.z)}, the same steps are ${near.jumps.map((j) => yen(j.add)).join(", ")}.</p>
  <p>Per kilogram, heavier parcels are much cheaper. To ${zoneName(far.z)}, a 500 g parcel costs the equivalent of ${yen(far.perKgFirst)} per kg; a 5 kg parcel costs ${yen(far.perKgLast)} per kg. That is the arithmetic behind <a href="/guides/consolidating-parcels">consolidating purchases</a> into one box.</p>
  <h2>How much of an order is postage</h2>
  <p>On a \u00a510,000, 1\u00a0kg Mercari order through the cheapest service, EMS makes up ${shares.map((x) => `${pct(x.share)} of the total to ${esc(x.cn)}`).join(", ")}. It is the same whichever proxy you use, so no choice of service makes it go away. Only the weight and the destination change it.</p>
  <h2>Weight once packed, not item weight</h2>
  <p>The weight that counts is the parcel's, including the box and padding the warehouse adds. A boxed figure that weighs 800 g on its own can cross into the next band once packed. If you are close to a boundary, check the packed weight the warehouse reports before you pay for international shipping.</p>
  <h2>Where the band boundaries bite</h2>
  <p>The single biggest step in this table is ${(() => { const all = steps.flatMap((s) => s.jumps.map((j) => ({ ...j, z: s.z }))).sort((a, b) => b.add - a.add)[0]; return `${yen(all.add)}, from ${kg(all.from)} to ${kg(all.to)} to ${zoneName(all.z)}`; })()}.
  The cheapest step is ${(() => { const all = steps.flatMap((s) => s.jumps.map((j) => ({ ...j, z: s.z }))).sort((a, b) => a.add - b.add)[0]; return `${yen(all.add)}, from ${kg(all.from)} to ${kg(all.to)} to ${zoneName(all.z)}`; })()}. Either way, one gram over a boundary costs the whole step.</p>
  <h2>Shipping costs for common items</h2>
  <ul>${countries.map((cc) => `<li><a href="/ship-scale-figure-from-japan-to-${COUNTRY_SLUGS[cc]}">A boxed figure to ${esc(countryName(cc))}</a> or <a href="/ship-manga-from-japan-to-${COUNTRY_SLUGS[cc]}">a manga volume</a></li>`).join("")}</ul>
  ${related([
    { href: "/guides/consolidating-parcels", text: "When one box saves money" },
    { href: "/guides/is-it-worth-it", text: "When an item from Japan is worth the shipping" },
  ])}`,
    });
  }

  // =========================================================================
  // Guide 5: is it worth it
  // =========================================================================
  {
    const prices = [1000, 2000, 3000, 5000, 10000, 20000, 50000];
    const rows = countries.map((cc) => ({
      cc, cn: countryName(cc),
      xs: prices.map((p) => { const r = run({ ...base, destination: cc, itemPriceJpy: p }).results[0]; return { p, over: (r.grandTotal - p) / p, minimum: r.grandTotalIsMinimum }; }),
    }));
    const tr = rows.map((r) => `<tr><td>${esc(r.cn)}</td>${r.xs.map((x) => `<td class="num"${x.over <= 0.5 ? ' style="background:var(--green-soft)"' : ""}>${pct(x.over)}${x.minimum ? "*" : ""}</td>`).join("")}</tr>`).join("");
    const firstUnder = (r, lim) => r.xs.find((x) => x.over <= lim)?.p;
    const half = rows.map((r) => ({ cn: r.cn, p: firstUnder(r, 0.5) })).sort((a, b) => (a.p ?? 1e9) - (b.p ?? 1e9));
    const at1k = rows.map((r) => ({ cn: r.cn, o: r.xs[0].over })).sort((a, b) => a.o - b.o);
    const mixCc = "GB";
    const mix = run({ ...base, destination: mixCc, itemPriceJpy: 3000 }).results[0];
    const LBL = { service: "Service fee", packing: "Packing", payment: "Payment fees", domestic: "Postage inside Japan", intl: "International postage", tax: "Import tax", plan: "Protection plan" };
    const mixParts = Object.keys(LBL).map((k) => ({ label: LBL[k], v: amountOf(mix, k) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const light = countries.map((cc) => { const r = run({ ...base, destination: cc, itemPriceJpy: 3000, weightG: 500 }).results[0]; return { cn: countryName(cc), o: (r.grandTotal - 3000) / 3000 }; }).sort((a, b) => a.o - b.o);
    hl["is-it-worth-it"] = `On a 1 kg parcel, the costs on top of a ¥1,000 item come to ${pct(at1k[0].o)} to ${pct(at1k.at(-1).o)} of its price.`;

    pages.push({
      path: "/guides/is-it-worth-it",
      layout: "content-first",
      prefill: { ...base, destination: "US", itemPriceJpy: 3000 },
      title: "When is an item from Japan worth the shipping?",
      description: `On a 1 kg parcel, everything on top of a ¥1,000 item adds ${pct(at1k[0].o)} to ${pct(at1k.at(-1).o)} of its price. The point where the overhead drops below half, for nine countries.`,
      body: `
  <h1>When is an item from Japan worth the shipping?</h1>
  <p>The fees, postage and tax on an order from Japan are mostly fixed, so they swamp a cheap item and barely register on an expensive one. This table shows how much everything on top of the item adds, as a share of its price, for a 1 kg parcel through the cheapest service.</p>
  <h2>The overhead at each price</h2>
  <table><thead><tr><th>Ship to</th>${prices.map((p) => `<th class="num">${yen(p)}</th>`).join("")}</tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">Everything on top of the item (service fee, packing, postage in Japan, EMS, payment fees and import tax) divided by the item price. Green is 50% or less. * The United States and Canada exclude import charges that depend on the item or the province, so the true share is higher.</p>
  <h2>Reading the table</h2>
  <p>On a ¥1,000 item the overhead is ${pct(at1k[0].o)} to ${esc(at1k[0].cn)} and ${pct(at1k.at(-1).o)} to ${esc(at1k.at(-1).cn)}: you pay several times the item's price to get it. The overhead first drops to half the item price or less at ${half.filter((h) => h.p).map((h) => `${yen(h.p)} for ${esc(h.cn)}`).join(", ")}.</p>
  <p>That is not a rule about what to buy. A ¥2,000 out-of-print book you cannot find anywhere else may be worth three times its price to you. It is a rule about how to buy: if the item is cheap, wait until you have several, and send them together. The postage is shared, and a per-order service fee is paid once.</p>
  <h2>What the overhead is made of</h2>
  <p>For a \u00a53,000 item, 1\u00a0kg, to ${esc(countryName(mixCc))} through ${esc(mix.name)}, the ${yen(mix.grandTotal - 3000)} on top of the item breaks down as ${mixParts.map((x) => `${x.label.charAt(0).toLowerCase() + x.label.slice(1)} ${yen(x.v)} (${pct(x.v / (mix.grandTotal - 3000))})`).join(", ")}. The international postage is the biggest share by far, which is why weight matters more than the choice of service.</p>
  <h2>Lighter parcels</h2>
  <p>A 500\u00a0g parcel pays a lower EMS band. At that weight the overhead on a \u00a53,000 item drops to ${light.map((x) => `${pct(x.o)} to ${esc(x.cn)}`).join(", ")}.</p>
  <h2>Making a cheap item worth it</h2>
  <ul>
    <li><strong>Bundle it.</strong> Three light items in one box pay one EMS band instead of three. See <a href="/guides/consolidating-parcels">consolidating parcels</a>.</li>
    <li><strong>Keep it light.</strong> A 500 g parcel costs less than a 1 kg one. See <a href="/guides/ems-weight-bands">the EMS weight bands</a>.</li>
    <li><strong>Check whether you need a proxy at all.</strong> New items from some Japanese shops can be bought directly from shops that ship overseas, which removes the proxy's fees. The calculator suggests some when you choose a shop rather than an auction.</li>
  </ul>
  ${related([
    { href: "/guides/consolidating-parcels", text: "When one box saves money" },
    { href: "/guides/which-proxy-is-cheapest", text: "Which proxy is cheapest?" },
  ])}`,
    });
  }

  // =========================================================================
  // Guide 6: paying tax up front
  // =========================================================================
  {
    const fx = importTax.fx;
    const cellFor = (x, cc) => {
      const r = (x.p.taxPrepay ?? []).find((t) => t.country === cc);
      if (!r) return "On arrival";
      if (r.onlyCarriers && !r.onlyCarriers.includes("ems")) return `On arrival by EMS (${esc(r.onlyCarriers.join(", ").toUpperCase())} only)`;
      if (r.unverifiedRate || r.rate == null) return "Collects, rate not published";
      const th = r.thresholdValue ? ` under ${r.thresholdCurrency} ${r.thresholdValue.toLocaleString("en-US")}` : "";
      return `<strong>At checkout</strong>, ${pct(r.rate, r.rate * 100 % 1 ? 1 : 0)}${th}`;
    };
    const taxed = countries.filter((cc) => importTax.countries[cc]?.vatRate !== 0);
    const tr = taxed.map((cc) => `<tr><td>${esc(countryName(cc))}</td>${ids.map((x) => `<td>${cellFor(x, cc)}</td>`).join("")}</tr>`).join("");
    const prepayCount = ids.map((x) => ({ ...x, n: taxed.filter((cc) => cellFor(x, cc).startsWith("<strong>")).length, m: taxed.filter((cc) => cellFor(x, cc) === "Collects, rate not published").length })).sort((a, b) => b.n - a.n);
    hl["paying-import-tax-up-front"] = prepayCount.filter((x) => x.n).length
      ? `${prepayCount.filter((x) => x.n).map((x) => `${esc(x.name)} collects tax at checkout for ${x.n} of ${taxed.length} countries`).join("; ")}.`
      : "None of the four collects tax at checkout for these countries.";
    const overEx = (() => {
      const cc = "AU";
      if (!countries.includes(cc)) return null;
      const lo = 50000, hi = 150000;
      const a = run({ ...base, destination: cc, itemPriceJpy: lo }), b = run({ ...base, destination: cc, itemPriceJpy: hi });
      return { cc, lo, hi, rows: ids.map((x) => ({ name: x.name, loT: a.results.find((r) => r.proxyId === x.id).taxTiming, hiT: b.results.find((r) => r.proxyId === x.id).taxTiming })) };
    })();
    const ex = ["GB", "AU", "SG"].filter((cc) => countries.includes(cc)).map((cc) => {
      const res = run({ ...base, destination: cc });
      return { cc, res };
    });
    const exRows = ex.map(({ cc, res }) => ids.map((x) => {
      const r = res.results.find((y) => y.proxyId === x.id);
      return `<tr><td>${esc(countryName(cc))}</td><td>${esc(x.name)}</td><td class="num">${yen(r.payNow.total)}</td><td class="num">${yen(r.payOnDelivery.total)}</td><td class="num"><strong>${yen(r.grandTotal)}</strong></td></tr>`;
    }).join("")).join("");
    const thresholds = ids.flatMap((x) => (x.p.taxPrepay ?? []).filter((t) => countries.includes(t.country) && t.thresholdValue && t.rate && (!t.onlyCarriers || t.onlyCarriers.includes("ems")))
      .map((t) => `${esc(x.name)} to ${esc(countryName(t.country))}: ${t.thresholdCurrency} ${t.thresholdValue.toLocaleString("en-US")}${fx?.jpyPer?.[t.thresholdCurrency] ? `, about ${yen(t.thresholdValue * fx.jpyPer[t.thresholdCurrency])}` : ""}`));

    pages.push({
      path: "/guides/paying-import-tax-up-front",
      layout: "content-only",
      prefill: null,
      title: "Paying import tax up front or on delivery: what each proxy does",
      description: `Which of Buyee, ZenMarket, Neokyo and FROM JAPAN collect VAT or GST at checkout for which countries, the value limits on it, and what it does to the total.`,
      body: `
  <h1>Paying import tax up front or on delivery</h1>
  <p>Some proxies collect your country's VAT or GST when you pay for shipping, so nothing is due when the parcel arrives. Others leave it to the courier, who pays it at the border and then collects it from you, usually with a handling fee on top. The tax itself is the same either way. This guide is about the timing, and about the catches.</p>
  <h2>Who collects what, where</h2>
  <table><thead><tr><th>Ship to</th>${ids.map((x) => `<th>${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">For EMS parcels, from each company's published rules. ${countries.filter((cc) => importTax.countries[cc]?.vatRate === 0).map((cc) => esc(countryName(cc))).join(", ")} ${countries.filter((cc) => importTax.countries[cc]?.vatRate === 0).length ? "is left out because it charges no import tax on general goods." : ""}</p>
  <p>${prepayCount.filter((x) => x.n).map((x) => `${esc(x.name)} collects at checkout for ${x.n} of the ${taxed.length} countries here`).join("; ") || "None of the four collects at checkout for these countries"}.
  ${prepayCount.filter((x) => !x.n && x.m).map((x) => `${esc(x.name)} says it collects the tax at checkout for ${x.m} of them but does not publish the rate, so its totals on this site assume you pay on arrival.`).join(" ")}
  ${prepayCount.filter((x) => !x.n && !x.m).length ? `${listJoin(prepayCount.filter((x) => !x.n && !x.m).map((x) => esc(x.name)))} ${prepayCount.filter((x) => !x.n && !x.m).length === 1 ? "does" : "do"} not collect it up front for any of them on EMS.` : ""}</p>
  <h2>Same tax, different timing</h2>
  <p>On a ¥10,000, 1 kg Mercari order, here is what you pay at checkout and on arrival through each service:</p>
  <table><thead><tr><th>Ship to</th><th>Service</th><th class="num">At checkout</th><th class="num">On arrival</th><th class="num">Total</th></tr></thead><tbody>${exRows}</tbody></table>
  <p>Compare the totals rather than the checkout figure. A service that collects the tax looks dearer at checkout by exactly the amount of the tax, which you would otherwise pay at the door.</p>
  ${thresholds.length ? `<h2>The value limits</h2>
  <p>Up-front collection usually only covers low-value parcels. Above the limit, the parcel goes through customs as a formal import and you pay at the border after all, with customs duty possibly on top:</p>
  <ul>${thresholds.map((t) => `<li>${t}</li>`).join("")}</ul>
  <p class="cap">Yen figures use exchange rates from ${esc(fx?.asOf ?? "")} and are approximate.</p>` : ""}
  ${overEx ? `<h2>Above the limit, in practice</h2>
  <p>To ${esc(countryName(overEx.cc))}, here is the same 1\u00a0kg Mercari order at ${yen(overEx.lo)} and at ${yen(overEx.hi)}. At the lower price ${listJoin(overEx.rows.filter((r) => r.loT === "prepaid").map((r) => esc(r.name)))} collect the tax at checkout. At the higher price ${overEx.rows.filter((r) => r.loT === "prepaid" && r.hiT !== "prepaid").length ? `${listJoin(overEx.rows.filter((r) => r.loT === "prepaid" && r.hiT !== "prepaid").map((r) => esc(r.name)))} no longer do, and the parcel is taxed at the border instead` : "the same services still collect it"}.</p>
  <table><thead><tr><th>Service</th><th>At ${yen(overEx.lo)}</th><th>At ${yen(overEx.hi)}</th></tr></thead><tbody>${overEx.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.loT === "prepaid" ? "At checkout" : "On arrival"}</td><td>${r.hiT === "prepaid" ? "At checkout" : "On arrival"}</td></tr>`).join("")}</tbody></table>` : ""}
  <h2>The handling fee</h2>
  <p>When the courier pays your tax at the border, it charges you for doing so. None of the four services publishes that fee because it is the courier's, not theirs, and it varies by carrier and country, so it is not in any total on this site. It is the practical reason to prefer up-front collection where you have the choice.</p>
  ${related([
    { href: "/import-tax", text: "Import tax by country" },
    { href: "/compare", text: "Compare the four services" },
  ])}`,
    });
  }

  // =========================================================================
  // ハブ: /guides
  // =========================================================================
  pages.push({
    path: "/guides",
    layout: "content-only",
    prefill: null,
    title: "Guides to buying from Japan through a proxy",
    description: "How proxy buying works, which service is cheapest, consolidation, EMS weight bands, when an item is worth the shipping, and paying tax up front.",
    body: `
  <h1>Guides</h1>
  <p>Longer reads on how the costs of buying from Japan work. Every number in them comes from the same fee, postage and tax data as the calculator.</p>
  <ul class="guide-list">${GUIDES.map((g) => `<li><a href="/guides/${g.slug}"><b>${esc(g.title)}</b><span>${esc(g.blurb)}</span></a></li>`).join("")}</ul>
  <h2>Where to start</h2>
  <p>If this is your first order through a proxy, read how it works first: it walks one real order from the purchase to the doorstep and
  shows what each step costs. If you already use a service and want to know whether another would be cheaper, the 1,512-order count
  answers that for typical orders. If you buy cheap items, the guides on consolidation and on when an item is worth the shipping will
  save you the most money.</p>
  <h2>What the guides found</h2>
  <p>Each guide runs the calculator across many orders rather than describing a single example. In one line each:</p>
  <ul>${GUIDES.map((g) => `<li><a href="/guides/${g.slug}">${esc(g.title)}</a>: ${hl[g.slug] ?? ""}</li>`).join("")}</ul>
  <p>All of them use the same fee, EMS and tax data as the rest of the site, checked against each company's and each authority's own pages.
  When a rule is not published, the guides say so rather than filling the gap with a guess. If you spot a figure that has changed, the
  <a href="/contact">contact page</a> is the quickest way to get it corrected.</p>
  <h2>Reference pages</h2>
  <ul>
    <li><a href="/compare">Compare the four services, country by country</a></li>
    <li><a href="/import-tax">Import tax by country</a></li>
    <li><a href="/what-you-cannot-ship-from-japan">What you cannot ship out of Japan</a></li>
    <li><a href="/how-we-calculate">How the numbers are worked out</a></li>
  </ul>`,
  });

  return pages;
}
