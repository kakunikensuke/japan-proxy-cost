/**
 * ジャンル別ガイド（2026-10-02）。「ship figures from Japan」のように、物の種類で検索する読者に答える。
 *
 * ■ 似たページを量産しないために
 * ジャンルごとに「想定する注文」（重さ・価格・点数・仕入れ元）を変え、計算結果そのものが違うようにする。
 * 漫画・CD・グッズ・トレカは同じ500g帯に入りがちなので、点数やまとめ方で差をつけている。
 * 想定の重さと価格は本文に「assumed」と明記する（実際の商品で変わるため）。
 *
 * ■ 書いてよいこと
 * 数字は calculateAll / lookupEmsRate / checkShippable の結果だけ。ジャンルの説明文も、データ
 * （restrictions.json の属性・stores.json の店）から言えることに限る。各マーケットの規約や
 * 商品の相場など、データに無い事実は書かない。
 */
import { calculateAll, checkShippable, lookupEmsRate } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { amountOf, costBarHtml, legendHtml, perServiceLines } from "./enrich.mjs";
import { sourcesAtWeight } from "./enrich2.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const pct = (x) => `${Math.round(x * 100)}%`;
const listJoin = (arr) => arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const kg = (g) => (g >= 1000 ? `${+(g / 1000).toFixed(1)} kg` : `${g} g`);
const related = (items) => `<nav class="related"><h2>Related</h2><ul>${items.map((i) => `<li><a href="${i.href}">${esc(i.text)}</a></li>`).join("")}</ul></nav>`;
const SMALL_NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n) => SMALL_NUM[n] ?? String(n);
const VERDICT = { ok: "Ships", conditional: "With conditions", carrier_limited: "With conditions", unknown: "Not stated", prohibited: "Refused" };

export const GENRES = [
  {
    slug: "buying-figures-from-japan",
    name: "figures",
    title: "Buying figures from Japan: what it costs to ship, and what can stop it",
    h1: "Buying figures from Japan",
    blurb: "Boxed scale figures, prize figures and figures with lights, priced to nine countries.",
    order: { what: "a second-hand boxed scale figure", source: "mercari", price: 15000, weightG: 1000, count: 1, attrs: [] },
    variants: [
      { what: "a prize figure", note: "lighter and cheaper, so the postage is a bigger share", price: 3000, weightG: 400 },
      { what: "a figure with an LED or sound base", note: "the base contains a lithium battery, which is judged on its own", attrs: ["lithium_battery"] },
    ],
    bundle: { what: "three prize figures", n: 3, unitG: 400, unitPrice: 3000 },
    storeCats: ["figure"],
    intro: "A boxed figure is the typical proxy purchase: not heavy, not fragile in the way glass is, and usually second-hand from Mercari or Yahoo! Auctions. The figure itself is almost never the problem. What changes the answer is the box size, and whether anything in it has a battery.",
    see: ["/can-you-ship-lithium-batteries-from-japan", "/ship-scale-figure-from-japan-to-united-states"],
  },
  {
    slug: "buying-gunpla-and-model-kits-from-japan",
    name: "model kits",
    title: "Buying Gunpla and model kits from Japan: the kit ships, the paint does not",
    h1: "Buying Gunpla and model kits from Japan",
    blurb: "Plastic kits ship anywhere. Paint, thinner and spray cans do not, whoever you use.",
    order: { what: "a new plastic model kit", source: "amazon_jp", price: 5000, weightG: 800, count: 1, attrs: [] },
    variants: [
      { what: "a kit bundled with a bottle of model paint", note: "the paint is a flammable liquid", attrs: ["flammable_liquid"] },
      { what: "a kit bundled with a can of spray topcoat", note: "a pressurised can", attrs: ["aerosol"] },
    ],
    bundle: { what: "three kits", n: 3, unitG: 800, unitPrice: 5000 },
    storeCats: ["model_kit"],
    intro: "Plastic model kits are one of the easiest things to send from Japan: no batteries, no liquids, nothing shaped like a weapon. The trouble starts when a listing includes the paints and finishing sprays that go with them, because those cannot travel by air at all.",
    see: ["/can-you-ship-model-paint-from-japan", "/can-you-ship-spray-cans-from-japan"],
  },
  {
    slug: "buying-manga-from-japan",
    name: "manga",
    title: "Buying manga and artbooks from Japan: one volume or the whole set",
    h1: "Buying manga and artbooks from Japan",
    blurb: "What a full set of volumes costs to bring over, and why one at a time costs so much more.",
    order: { what: "a set of ten manga volumes", source: "mercari", price: 6000, weightG: 2000, count: 1, attrs: [] },
    variants: [
      { what: "a single volume", note: "a 200 g parcel still pays for the 500 g band", price: 600, weightG: 200 },
      { what: "a large artbook", note: "heavier than it looks", price: 4000, weightG: 1000 },
    ],
    bundle: { what: "ten volumes bought one at a time", n: 10, unitG: 200, unitPrice: 600, compareAs: "set" },
    storeCats: ["book"],
    intro: "Books are heavy for their price. A single paperback volume costs little in Japan and a lot to post, so how you buy manga matters more than which proxy you use: as a set listed by one seller, or volume by volume from different sellers.",
    see: ["/ship-manga-from-japan-to-united-states", "/guides/consolidating-parcels"],
  },
  {
    slug: "buying-trading-cards-from-japan",
    name: "trading cards",
    title: "Buying trading cards from Japan: tiny parcels, and the tax on valuable singles",
    h1: "Buying trading cards from Japan",
    blurb: "A 60 g parcel pays a 500 g postage band, and an expensive single can cross a tax limit.",
    order: { what: "a few trading cards", source: "mercari", price: 3000, weightG: 60, count: 1, attrs: [] },
    variants: [
      { what: "a valuable single card", note: "the value, not the weight, sets the tax", price: 50000, weightG: 60 },
      { what: "a sealed booster box", note: "heavier, so it moves up a band", price: 6000, weightG: 1000 },
    ],
    bundle: { what: "five separate card purchases", n: 5, unitG: 60, unitPrice: 3000 },
    storeCats: [],
    intro: "Cards weigh almost nothing, so on paper they are the cheapest thing to send. In practice the smallest EMS band is 500 g, so a few cards pay for half a kilogram of postage. And because tax follows value rather than weight, a single expensive card can cost more in tax than in shipping.",
    see: ["/guides/is-it-worth-it", "/import-tax"],
  },
  {
    slug: "buying-doujinshi-from-japan",
    name: "doujinshi",
    title: "Buying doujinshi from Japan: costs, and the rules on adult titles",
    h1: "Buying doujinshi from Japan",
    blurb: "Light parcels, a per-item fee that adds up, and which services refuse adult titles where.",
    order: { what: "five doujinshi from different sellers", source: "mercari", price: 5000, weightG: 400, count: 5, attrs: [] },
    variants: [
      { what: "five adult (R18) doujinshi", note: "some services and some countries treat these differently", attrs: ["adult"] },
      { what: "a single doujinshi", note: "one light purchase on its own", price: 1000, weightG: 100, count: 1 },
    ],
    bundle: { what: "five doujinshi", n: 5, unitG: 80, unitPrice: 1000 },
    storeCats: [],
    intro: "Doujinshi are thin and light, and they are usually bought several at a time from different sellers. That makes the service fee the line to watch: some services charge it per item, others per purchase. Adult titles add a second question, because not every service and not every country accepts them.",
    see: ["/can-you-ship-adult-doujinshi-from-japan", "/guides/which-proxy-is-cheapest"],
  },
  {
    slug: "buying-game-consoles-from-japan",
    name: "game consoles",
    title: "Buying game consoles and handhelds from Japan: the battery decides the route",
    h1: "Buying game consoles and handhelds from Japan",
    blurb: "A console with a built-in battery cannot go by Japan Post to some countries at all.",
    order: { what: "a boxed handheld console", source: "mercari", price: 30000, weightG: 2000, count: 1, attrs: ["lithium_battery"] },
    variants: [
      { what: "games only, no console", note: "cartridges and discs are judged on their own", attrs: [], price: 6000, weightG: 500 },
    ],
    bundle: null,
    storeCats: [],
    intro: "A handheld or a console with a built-in battery is not judged as a game. It is judged as a lithium battery, and Japan Post's rules for batteries depend on the destination. That makes consoles the clearest case on this site of the destination, not the proxy, deciding whether something can be posted.",
    see: ["/can-you-ship-lithium-batteries-from-japan", "/what-you-cannot-ship-from-japan"],
  },
  {
    slug: "buying-anime-merchandise-from-japan",
    name: "anime merchandise",
    title: "Buying anime merchandise from Japan: many small items, one parcel",
    h1: "Buying anime merchandise from Japan",
    blurb: "Acrylic stands, badges and keyrings: why ten small items cost so differently between services.",
    order: { what: "ten small merchandise items from one shop", source: "other_shop", price: 8000, weightG: 1000, count: 10, sameShop: true, attrs: [] },
    variants: [
      { what: "the same ten items from ten different marketplace sellers", note: "no longer one order", source: "mercari", sameShop: false },
      { what: "a single acrylic stand", note: "one light item on its own", price: 1500, weightG: 200, count: 1, sameShop: false },
    ],
    bundle: { what: "ten small items", n: 10, unitG: 100, unitPrice: 800 },
    storeCats: ["anime_goods"],
    intro: "Merchandise is bought in quantity: a handful of badges, a few acrylic stands, a keyring or two. Each item is light and cheap, so the fees that matter are the ones charged per item, and the question of whether ten items count as one order or ten.",
    see: ["/guides/which-proxy-is-cheapest", "/guides/consolidating-parcels"],
  },
  {
    slug: "buying-cds-and-blu-rays-from-japan",
    name: "CDs and Blu-rays",
    title: "Buying CDs and Blu-rays from Japan: light, cheap to post, easy to bundle",
    h1: "Buying CDs and Blu-rays from Japan",
    blurb: "Discs are among the easiest things to send: what three of them cost, new or second-hand.",
    order: { what: "three CDs from one shop", source: "amazon_jp", price: 9000, weightG: 600, count: 3, sameShop: true, attrs: [] },
    variants: [
      { what: "three second-hand CDs from different sellers", note: "three purchases rather than one order", source: "mercari", sameShop: false },
      { what: "a Blu-ray box set", note: "heavier and more valuable", price: 20000, weightG: 1500, count: 1, sameShop: false },
    ],
    bundle: { what: "three discs", n: 3, unitG: 200, unitPrice: 3000 },
    storeCats: ["cd", "bluray"],
    intro: "Discs have no batteries, no liquids and no restricted content in the ordinary case, and they are light. The cost question is mostly about how many you buy at once, and whether they come from one shop or from several sellers.",
    see: ["/guides/ems-weight-bands", "/compare"],
  },
];

export function buildGenreGuides(data, { COUNTRY_SLUGS, countryName }) {
  const { restrictions, stores, ems } = data;
  const countries = Object.keys(COUNTRY_SLUGS);
  const run = (input) => calculateAll(input, data);
  const inputOf = (o, cc) => ({
    source: o.source, itemPriceJpy: o.price, itemCount: o.count ?? 1, sameShop: o.sameShop ?? false,
    weightG: o.weightG, destination: cc, domesticShippingJpy: 700 * Math.min(o.count ?? 1, o.sameShop ? 1 : (o.count ?? 1)),
    buyeePlan: "light", attributes: o.attrs ?? [],
  });
  const SHIPS = ["ok", "conditional", "carrier_limited"];
  const ships = (r) => SHIPS.includes(r.shippable.level);
  const okFirst = (res) => res.results.find(ships);
  const names = (rs) => listJoin(rs.map((r) => esc(r.name)));
  /** 1か国ぶんの状況を短い文にする */
  const statusOf = (res) => {
    const all = res.results;
    const clean = all.filter((r) => r.shippable.level === "ok");
    const cond = all.filter((r) => ships(r) && r.shippable.level !== "ok");
    const unknown = all.filter((r) => r.shippable.level === "unknown");
    const refused = all.filter((r) => r.shippable.level === "prohibited");
    const byPost = refused.length === all.length && all.every((r) => r.shippable.blockers.some((b) => b.axis === "destination"));
    if (clean.length === all.length) return { key: "all", text: "all four ship it" };
    if (byPost) return { key: "post", text: "Japan Post will not carry it, whichever service you use" };
    const bits = [];
    if (clean.length) bits.push(`${names(clean)} ${clean.length === 1 ? "ships" : "ship"} it`);
    if (cond.length) bits.push(`${names(cond)} ${cond.length === 1 ? "ships" : "ship"} it with conditions`);
    if (unknown.length) bits.push(`${names(unknown)} ${unknown.length === 1 ? "publishes" : "publish"} no rule`);
    if (refused.length) bits.push(`${names(refused)} ${refused.length === 1 ? "refuses" : "refuse"} it`);
    return { key: bits.join("|"), text: bits.join("; ") };
  };

  return GENRES.map((g) => {
    const o = g.order;
    const byCountry = countries.map((cc) => {
      const res = run(inputOf(o, cc));
      return { cc, cn: countryName(cc), res, best: okFirst(res), okCount: res.results.filter((r) => r.shippable.level === "ok").length, status: statusOf(res) };
    });

    // ---- 送れるかどうか（9か国） ----
    const groups = new Map();
    for (const x of byCountry) { if (!groups.has(x.status.key)) groups.set(x.status.key, { text: x.status.text, list: [] }); groups.get(x.status.key).list.push(x.cn); }
    const shipLine = groups.size === 1 && byCountry[0].status.key === "all"
      ? `All four services will ship ${esc(o.what)} to all ${countries.length} countries this site covers.`
      : [...groups.values()].map((gr) => `To ${listJoin(gr.list.map(esc))}: ${gr.text}.`).join(" ");
    // 条件の中身（こちらの説明文 noteEn。公式原文ではないので引用符で囲まない）
    // 会社の条件と、配送先（日本郵便）の条件を分けて、それぞれ最初に出たものだけ残す
    const condNotes = [];
    const seen = new Set();
    for (const x of byCountry) {
      for (const r of x.res.results.filter((y) => ships(y) && y.shippable.level !== "ok")) {
        for (const b of r.shippable.blockers.filter((bb) => bb.reasonEn)) {
          const key = b.axis === "destination" ? `dest|${x.cc}|${b.attribute}` : `proxy|${r.proxyId}|${b.attribute}`;
          if (seen.has(key)) continue;
          seen.add(key);
          condNotes.push(b.axis === "destination"
            ? `<li><strong>Japan Post, to ${esc(x.cn)}:</strong> ${esc(b.reasonEn)}</li>`
            : `<li><strong>${esc(r.name)}:</strong> ${esc(b.reasonEn)}</li>`);
        }
      }
    }
    condNotes.sort((a, b) => (a.includes("Japan Post, to") ? 1 : 0) - (b.includes("Japan Post, to") ? 1 : 0));

    // ---- 国ごとの費用 ----
    const priced = byCountry.filter((x) => x.best);
    const tr = byCountry.map((x) => x.best
      ? `<tr><td>${esc(x.cn)}</td><td>${esc(x.best.name)}${x.best.shippable.level !== "ok" ? " (with conditions)" : ""}</td><td class="num">${x.best.grandTotalIsMinimum ? "not estimated" : yen(amountOf(x.best, "tax"))}</td><td class="num">${yen(x.best.grandTotal)}${x.best.grandTotalIsMinimum ? " +duty" : ""}</td><td class="num">${pct((x.best.grandTotal - o.price) / o.price)}</td></tr>`
      : `<tr class="row-exception"><td>${esc(x.cn)}</td><td colspan="4">${x.status.key === "post" ? "Japan Post will not carry it" : "No service confirms it can ship it"}</td></tr>`).join("");
    const winners = {};
    for (const x of priced) {
      const top = x.res.results.filter((r) => ships(r) && r.grandTotal === x.best.grandTotal);
      for (const r of top) winners[r.name] = (winners[r.name] ?? 0) + 1;
    }
    const winList = Object.entries(winners).sort((a, b) => b[1] - a[1]);
    const cheapestC = [...priced].sort((a, b) => a.best.grandTotal - b.best.grandTotal)[0];
    const dearestC = [...priced].sort((a, b) => b.best.grandTotal - a.best.grandTotal)[0];
    const us = byCountry.find((x) => x.cc === "GB")?.best ?? priced[0]?.best;

    // ---- 条件を変えると ----
    const variantHtml = g.variants.map((v) => {
      const vo = { ...o, ...v, attrs: v.attrs ?? o.attrs };
      const rows = countries.map((cc) => { const res = run(inputOf(vo, cc)); return { cc, cn: countryName(cc), best: okFirst(res), ok: res.results.filter((r) => r.shippable.level === "ok").length, res, status: statusOf(res) }; });
      const blocked = rows.filter((r) => !r.best);
      const some = rows.filter((r) => r.best && r.ok < 4);
      const refusers = [...new Set(rows.flatMap((r) => r.res.results.filter((x) => x.shippable.level === "prohibited" && x.shippable.blockers.some((b) => b.axis === "proxy")).map((x) => x.name)))];
      const destOnly = blocked.filter((r) => r.res.results.every((x) => x.shippable.blockers.some((b) => b.axis === "destination")));
      const ref = rows.find((r) => r.cc === "GB")?.best;
      const base = byCountry.find((x) => x.cc === "GB")?.best;
      const parts = [];
      if (!blocked.length && !some.length) parts.push(`All four services will still ship it to all ${countries.length} countries.`);
      else {
        const vg = new Map();
        for (const r of rows) { if (!vg.has(r.status.key)) vg.set(r.status.key, { text: r.status.text, list: [] }); vg.get(r.status.key).list.push(r.cn); }
        parts.push([...vg.values()].map((gr) => `To ${listJoin(gr.list.map(esc))}: ${gr.text}.`).join(" "));
      }
      if (false && refusers.length) parts.push(`${listJoin(refusers.map(esc))} refuse${refusers.length === 1 ? "s" : ""} it under ${refusers.length === 1 ? "its" : "their"} own rules.`);
      if (false && destOnly.length) parts.push(`Japan Post will not carry it to ${listJoin(destOnly.map((r) => esc(r.cn)))}, whichever service you use.`);
      if (blocked.length === countries.length) parts.push(`No service can send it to any of the ${countries.length} countries.`);
      else if (ref && base && (vo.price !== o.price || vo.weightG !== o.weightG || vo.count !== o.count || vo.source !== o.source || vo.sameShop !== o.sameShop)) {
        const tax = amountOf(ref, "tax"), baseTax = amountOf(base, "tax");
        parts.push(`To the United Kingdom it comes to ${yen(ref.grandTotal)} through ${esc(ref.name)}, against ${yen(base.grandTotal)} for ${esc(o.what)}${tax !== baseTax ? `; the VAT alone goes from ${yen(baseTax)} to ${yen(tax)}` : ""}.`);
      }
      return `<h3>If it is ${esc(v.what)}</h3><p>${esc(v.note.charAt(0).toUpperCase() + v.note.slice(1))}. ${parts.join(" ")}</p>`;
    }).join("");

    // ---- まとめ送り ----
    let bundleHtml = "";
    if (g.bundle) {
      const b = g.bundle;
      const rate = (cc, w) => lookupEmsRate(ems, cc, w).amount;
      const together = b.n * b.unitG;
      if (together <= 5000) {
        const rows = countries.map((cc) => ({ cn: countryName(cc), sep: b.n * rate(cc, b.unitG), tog: rate(cc, together) })).filter((r) => r.sep != null && r.tog != null);
        const best = [...rows].sort((a, c) => (c.sep - c.tog) - (a.sep - a.tog))[0];
        const band = lookupEmsRate(ems, "US", together).appliedWeightG;
        const unitBand = lookupEmsRate(ems, "US", b.unitG).appliedWeightG;
        bundleHtml = `<h2>One parcel or ${num(b.n)}?</h2>
  <p>${esc(b.what.charAt(0).toUpperCase() + b.what.slice(1))} at about ${kg(b.unitG)} each come to ${kg(together)} together. Sent as ${num(b.n)} separate EMS parcels they pay for the ${kg(unitBand)} band ${num(b.n)} times; sent as one they pay for the ${kg(band)} band once. The postage saved is largest to ${esc(best.cn)}, at ${yen(best.sep - best.tog)}.</p>
  <table><thead><tr><th>Ship to</th><th class="num">${num(b.n)} parcels</th><th class="num">One parcel</th><th class="num">Saved</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.cn)}</td><td class="num">${yen(r.sep)}</td><td class="num">${yen(r.tog)}</td><td class="num"><strong>${yen(r.sep - r.tog)}</strong></td></tr>`).join("")}</tbody></table>
  <p class="cap">EMS postage only. Fees and tax come on top in both cases; the <a href="/guides/consolidating-parcels">consolidation guide</a> works through the full totals.</p>`;
      }
    }

    // ---- 新品なら直販 ----
    const shop = (stores.stores ?? []).filter((s) => s.affiliateUrl && (s.categories ?? []).some((c) => g.storeCats.includes(c)));
    let storeHtml = "";
    if (shop.length) {
      const newRes = run({ ...inputOf(o, "US"), source: "amazon_jp", attributes: [] });
      const fees = Math.min(...newRes.results.map((r) => r.proxyFeesOnly - amountOf(r, "intl") - amountOf(r, "domestic")).filter(Number.isFinite));
      storeHtml = `<h2>If it is new and in stock</h2>
  <p>A proxy is the only way to buy second-hand from Mercari or Yahoo! Auctions. For new items there is another route: some Japanese shops sell overseas directly and post the parcel themselves, so the proxy's own fees, at least ${yen(fees)} on this order, are not charged at all. ${shop.map((s) => `<a href="${esc(s.affiliateUrl)}" target="_blank" rel="noopener noreferrer sponsored">${esc(s.name)}</a> sells ${esc(s.sellsEn)}${s.shippingNoteEn ? ` (${esc(s.shippingNoteEn)})` : ""}`).join("; ")}.</p>
  <p class="cap">We do not have the shop's own prices or shipping charges, so we do not claim it is cheaper; only that the proxy's fees disappear. This link is an affiliate link.</p>`;
    }

    // ---- 送れない場合の助言（データの英文） ----
    const attrIds = [...new Set([...(o.attrs ?? []), ...g.variants.flatMap((v) => v.attrs ?? [])])];
    const adviceHtml = attrIds.length ? `<h2>When it cannot be sent</h2>${attrIds.map((id) => {
      const a = restrictions.attributes.find((x) => x.id === id);
      return a?.whenBlockedEn ? `<p><strong>${esc(a.labelEn)}.</strong> ${esc(a.whenBlockedEn)}</p>` : "";
    }).join("")}` : "";

    // ---- 会社ごとの規則（このジャンルに関わる属性） ----
    const ruleTable = attrIds.length ? `<h2>What each service says</h2>
  <table><thead><tr><th>Service</th>${attrIds.map((id) => `<th>${esc(restrictions.attributes.find((a) => a.id === id)?.labelEn ?? id)}</th>`).join("")}</tr></thead><tbody>${
    data.proxies.proxies.map((p) => `<tr><td>${esc(p.shortName ?? p.name)}</td>${attrIds.map((id) => `<td>${VERDICT[checkShippable([id], { proxyId: p.id, destination: "US" }, restrictions).level]}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <p class="cap">Each company's own rule, shipping to the United States. Destination rules can still block a route on top of this; the table further up accounts for both.</p>` : "";

    const tableTitle = "What it costs, country by country";
    return {
      path: `/guides/${g.slug}`,
      layout: "content-first",
      prefill: inputOf(o, "US"),
      title: g.title,
      description: `${g.blurb} Totals for nine countries through Buyee, ZenMarket, Neokyo and FROM JAPAN, worked out from each company's published fees.`,
      body: `
  <h1>${esc(g.h1)}</h1>
  <p>${esc(g.intro)}</p>
  ${us ? `<div class="verdict"><p class="v">${esc(o.what.charAt(0).toUpperCase() + o.what.slice(1))} at ¥${o.price.toLocaleString("en-US")} costs ${yen(cheapestC.best.grandTotal)} to ${yen(dearestC.best.grandTotal)} delivered, depending on the country.</p>
  ${costBarHtml(us, us.grandTotal)}<div style="height:12px"></div>${legendHtml([us])}
  <p class="cap">The bar is the United Kingdom through ${esc(us.name)}. Assumed: ${esc(o.what)}, ${kg(o.weightG)} packed, from ${o.source === "amazon_jp" ? "a Japanese shop" : o.source === "other_shop" ? "one Japanese shop" : "Mercari Japan"}, with ¥700 of postage inside Japan per seller.</p></div>` : ""}
  <h2>Can it be sent?</h2>
  <p>${shipLine}</p>
  ${condNotes.length ? `<p>The conditions:</p><ul>${condNotes.join("")}</ul>` : ""}
  <h2>${tableTitle}</h2>
  <p>The cheapest service that will take it, for each country, with everything included: the item, fees, postage inside Japan, EMS, and import tax where it can be calculated.
  ${winList.length ? `${listJoin(winList.map(([n, c]) => `${esc(n)} is cheapest (or joint cheapest) for ${c}`))} of the ${priced.length} countries it can go to.` : ""}</p>
  <table><thead><tr><th>Ship to</th><th>Cheapest service</th><th class="num">Import tax</th><th class="num">Total</th><th class="num">On top of the item</th></tr></thead><tbody>${tr}</tbody></table>
  ${priced.length ? `<p>The spread runs from ${yen(cheapestC.best.grandTotal)} to ${esc(cheapestC.cn)} up to ${yen(dearestC.best.grandTotal)} to ${esc(dearestC.cn)}. Most of that gap is EMS postage and import tax, which are the same whichever proxy you use.</p>` : ""}
  ${(() => { const u = byCountry.find((x) => x.cc === "US"); if (!u?.best) return ""; const shipped = u.res.results.filter(ships);
    return `<h2>Each service, line by line</h2>
  <p>The same order to the United States through each service that will take it. Postage is identical; the lines that differ are the fees${shipped.some((r) => r.taxTiming === "prepaid") ? " and whether the tax is collected at checkout" : ""}.</p>
  ${perServiceLines(shipped)}
  <h2>Where you buy it</h2>
  ${sourcesAtWeight(inputOf(o, "US"), data)}`; })()}
  <h2>What changes the answer</h2>
  ${variantHtml}
  ${bundleHtml}
  ${ruleTable}
  ${adviceHtml}
  ${storeHtml}
  ${related([
    ...g.see.map((href) => ({ href, text: href.startsWith("/can-you-ship-") ? `Can you ship ${href.replace("/can-you-ship-", "").replace("-from-japan", "").replace(/-/g, " ")} from Japan?` : href.startsWith("/ship-") ? "Shipping costs by weight" : href === "/import-tax" ? "Import tax by country" : href === "/compare" ? "Compare the four services" : "Guide: " + href.replace("/guides/", "").replace(/-/g, " ") })),
    { href: "/guides", text: "All guides" },
  ])}`,
    };
  });
}
