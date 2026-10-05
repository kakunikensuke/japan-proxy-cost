/**
 * 配送方法（日本郵便のEMS・小形包装物の航空便・国際小包の航空便/船便）の比較（2026-10-02）。
 *
 * 料金は data/shipping-post.json（日本郵便の公表料金表）。各社が扱うかどうかは同ファイルの offeredBy で、
 * 公式ページに名前が出ているものだけを「扱う」とする。扱うと確認できない会社は最安に数えない。
 * 届くまでの日数はデータに無いので、日数を断言しない。書くなら会社自身の説明として引用する（Neokyo）。
 */
import { calculateAll, CARRIER_LABELS } from "./calc.mjs";
import { esc } from "./layout.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const listJoin = (arr) => arr.length <= 1 ? arr.join("")
  // 要素自体に and を含む（"plants and seeds" など）ときは区切りをセミコロンにして and の二重を避ける
  : arr.some((x) => / and /.test(x)) ? `${arr.slice(0, -1).join("; ")}; and ${arr[arr.length - 1]}`
  : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const kg = (g) => (g >= 1000 ? `${+(g / 1000).toFixed(1)} kg` : `${g} g`);
const SHIPS = ["ok", "conditional", "carrier_limited"];
export const CARRIERS = ["ems", "small_packet_air", "intl_parcel_air", "intl_parcel_sea"];

/** 1つの注文を4つの配送方法で計算し、それぞれ「扱うと確認できる会社の中で最安」を返す */
export function compareMethods(input, data) {
  return CARRIERS.map((carrier) => {
    const res = calculateAll({ ...input, carrier }, data);
    if (res.shipping.error) return { carrier, error: res.shipping.error };
    const best = res.results.find((r) => SHIPS.includes(r.shippable.level) && r.methodListed);
    return { carrier, postage: res.shipping.amount, best, res };
  });
}

/** ページに差し込む表と1文。EMSと比べていくら変わるかを実数で言う */
export function methodsTable(input, data, { lead = "" } = {}) {
  const rows = compareMethods(input, data);
  const ems = rows.find((r) => r.carrier === "ems");
  const priced = rows.filter((r) => r.best);
  if (!priced.length) return "";
  const cheapest = [...priced].sort((a, b) => a.best.grandTotal - b.best.grandTotal)[0];
  const tr = rows.map((r) => {
    if (r.error) return `<tr><td>${CARRIER_LABELS[r.carrier]}</td><td colspan="4">${/up to/.test(r.error) ? "Too heavy for this method" : "Not available"}</td></tr>`;
    if (!r.best) return `<tr><td>${CARRIER_LABELS[r.carrier]}</td><td class="num">${yen(r.postage)}</td><td colspan="3">No service that lists this method will take it</td></tr>`;
    const d = ems?.best ? r.best.grandTotal - ems.best.grandTotal : 0;
    return `<tr${r === cheapest ? ' class="best"' : ""}><td>${CARRIER_LABELS[r.carrier]}</td><td class="num">${yen(r.postage)}</td><td>${esc(r.best.name)}</td><td class="num">${yen(r.best.grandTotal)}${r.best.grandTotalIsMinimum ? " +duty" : ""}</td><td class="num">${r.carrier === "ems" || !ems?.best ? "—" : (d < 0 ? "−" : "+") + yen(Math.abs(d))}</td></tr>`;
  }).join("");
  let text;
  if (!ems?.best) text = `${CARRIER_LABELS[cheapest.carrier]} is the cheapest way to send it, at ${yen(cheapest.best.grandTotal)} through ${esc(cheapest.best.name)}.`;
  else if (cheapest.carrier === "ems") text = `EMS is already the cheapest way to send this.`;
  else text = `Sent by ${CARRIER_LABELS[cheapest.carrier].toLowerCase()} instead of EMS, the same order comes to ${yen(cheapest.best.grandTotal)} through ${esc(cheapest.best.name)}, ${yen(ems.best.grandTotal - cheapest.best.grandTotal)} less. The trade-off is time: EMS is Japan Post's fastest service and surface parcels its slowest.`;
  return `<p>${lead}${text}</p>
  <table><thead><tr><th>Method</th><th class="num">Postage</th><th>Cheapest service that lists it</th><th class="num">Total</th><th class="num">vs EMS</th></tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">Japan Post's published rates. A service is only counted where its own site lists the method; <a href="/guides/shipping-methods">the shipping methods guide</a> shows which do. SAL (economy air) is not shown because Japan Post has suspended it.</p>`;
}

export function buildShippingGuide(data, { COUNTRY_SLUGS, countryName }) {
  const { post, proxies, ems } = data;
  const countries = Object.keys(COUNTRY_SLUGS);
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, domesticShippingJpy: 700, buyeePlan: "light" };
  const weights = [500, 1000, 2000, 5000];

  // 国×重さで、最も安い配送方法と、EMSとの差
  const grid = countries.map((cc) => ({
    cc, cn: countryName(cc),
    xs: weights.map((w) => {
      const rows = compareMethods({ ...base, destination: cc, weightG: w }, data);
      const emsRow = rows.find((r) => r.carrier === "ems");
      const cheapest = rows.filter((r) => r.best).sort((a, b) => a.best.grandTotal - b.best.grandTotal)[0];
      return { w, rows, emsRow, cheapest, save: emsRow?.best && cheapest ? emsRow.best.grandTotal - cheapest.best.grandTotal : 0 };
    }),
  }));
  const postageRows = (cc) => weights.map((w) => `<td class="num">${["ems", "small_packet_air", "intl_parcel_air", "intl_parcel_sea"].map((c) => {
    const r = grid.find((g) => g.cc === cc).xs.find((x) => x.w === w).rows.find((x) => x.carrier === c);
    return r.error ? "—" : yen(r.postage);
  }).join(" / ")}</td>`).join("");

  // 1kg の郵便料金を4方法で並べた表（国ごと）
  const at1k = countries.map((cc) => {
    const x = grid.find((g) => g.cc === cc).xs.find((y) => y.w === 1000);
    const p = (c) => { const r = x.rows.find((z) => z.carrier === c); return r.error ? null : r.postage; };
    return { cc, cn: countryName(cc), ems: p("ems"), sp: p("small_packet_air"), air: p("intl_parcel_air"), sea: p("intl_parcel_sea") };
  });
  const tr1k = at1k.map((r) => `<tr><td>${esc(r.cn)}</td><td class="num">${yen(r.ems)}</td><td class="num">${yen(r.sp)}</td><td class="num">${yen(r.air)}</td><td class="num">${yen(r.sea)}</td></tr>`).join("");
  const spSave = at1k.map((r) => ({ cn: r.cn, d: r.ems - r.sp, pct: (r.ems - r.sp) / r.ems })).sort((a, b) => b.d - a.d);

  // 重さごとに、何か国で EMS 以外が最安になるか
  const byWeight = weights.map((w) => {
    const xs = grid.map((g) => g.xs.find((x) => x.w === w));
    const winners = {};
    for (const x of xs) if (x.cheapest) winners[x.cheapest.carrier] = (winners[x.cheapest.carrier] ?? 0) + 1;
    const avgSave = xs.reduce((s, x) => s + x.save, 0) / xs.length;
    return { w, winners, avgSave };
  });

  // 会社ごとの取り扱い
  const offerRows = proxies.proxies.map((p) => {
    const o = post.offeredBy?.[p.id] ?? {};
    const cell = (c) => c === "ems" ? "Yes" : o[c]?.status === "listed" ? "Yes" : "Not listed";
    return `<tr><td>${esc(p.shortName ?? p.name)}</td>${CARRIERS.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`;
  }).join("");

  return {
    path: "/guides/shipping-methods",
    layout: "content-first",
    prefill: { ...base, destination: "US", weightG: 1000, carrier: "small_packet_air" },
    title: "EMS, airmail or surface: the cheapest way to ship from Japan",
    description: `Japan Post's airmail small packets cost ${yen(spSave.at(-1).d)} to ${yen(spSave[0].d)} less than EMS for a 1 kg parcel. Every method, priced for nine countries, and which proxies offer which.`,
    body: `
  <h1>EMS, airmail or surface: the cheapest way to ship from Japan</h1>
  <p>Most proxy comparisons, including the default on this site, price everything by EMS. EMS is fast and tracked, but it is not the only
  way Japan Post will carry a parcel, and for small or heavy parcels it is often not the cheapest. Here is every Japan Post method a proxy
  can use, priced for the nine countries this site covers.</p>
  <div class="verdict"><p class="v">For a 1 kg parcel, an airmail small packet costs ${yen(spSave.at(-1).d)} to ${yen(spSave[0].d)} less than EMS, depending on the country.</p>
  <p class="cap" style="margin:0">Postage only, from Japan Post's published rates (checked ${esc(post._meta.updated)}).</p></div>

  <h2>The methods</h2>
  <ul>
    <li><strong>EMS.</strong> Japan Post's express service, tracked, up to 30 kg. Every service on this site offers it, which is why it is the default.</li>
    <li><strong>Airmail small packet.</strong> For items up to 2 kg. Much cheaper than EMS at low weights, and the method ZenMarket recommends for small, cheap items.</li>
    <li><strong>Airmail parcel.</strong> An ordinary parcel sent by air, up to 30 kg. Cheaper than EMS at most weights, slower to arrive.</li>
    <li><strong>Surface (sea) parcel.</strong> Sent by ship. The cheapest by far for heavy parcels, and the slowest: Neokyo describes it as taking "a few months".</li>
    <li><strong>SAL (economy air).</strong> Still in Japan Post's rate tables, but Japan Post states that it has suspended SAL acceptance entirely, so it is left out.</li>
  </ul>

  <h2>Postage at 1 kg, country by country</h2>
  <table><thead><tr><th>Ship to</th><th class="num">EMS</th><th class="num">Small packet (air)</th><th class="num">Parcel (air)</th><th class="num">Parcel (surface)</th></tr></thead><tbody>${tr1k}</tbody></table>
  <p>The airmail small packet saves the most to ${esc(spSave[0].cn)} (${yen(spSave[0].d)}, ${Math.round(spSave[0].pct * 100)}% of the EMS price) and the least to ${esc(spSave.at(-1).cn)} (${yen(spSave.at(-1).d)}).
  At 1 kg the surface parcel and the small packet are close; above 2 kg the small packet is no longer an option and surface pulls well ahead.</p>

  <h2>Which method is cheapest at each weight</h2>
  <p>The same ¥10,000 Mercari order, totalled through the cheapest service that lists each method, for all nine countries:</p>
  <table><thead><tr><th>Parcel</th><th>Cheapest method (countries)</th><th class="num">Average saving vs EMS</th></tr></thead><tbody>${byWeight.map((b) =>
    `<tr><td>${kg(b.w)}</td><td>${Object.entries(b.winners).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${CARRIER_LABELS[c]} (${n})`).join(", ")}</td><td class="num">${yen(b.avgSave)}</td></tr>`).join("")}</tbody></table>
  <p>${(() => { const top = byWeight.at(-1); const best = Object.entries(top.winners).sort((x, y) => y[1] - x[1])[0]; return `At 5 kg, ${CARRIER_LABELS[best[0]].toLowerCase()} is cheapest for ${best[1] === countries.length ? `all ${countries.length}` : `${best[1]} of the ${countries.length}`} countries, saving ${yen(top.avgSave)} on average against EMS.`; })()}
  The saving grows with weight because EMS's price climbs much faster per kilogram than a surface parcel's.</p>

  <h2>Postage at every weight</h2>
  <p>EMS / small packet / air parcel / surface parcel, in that order. A dash means the method does not take a parcel that heavy.</p>
  <table><thead><tr><th>Ship to</th>${weights.map((w) => `<th class="num">${kg(w)}</th>`).join("")}</tr></thead><tbody>${countries.map((cc) => `<tr><td>${esc(countryName(cc))}</td>${postageRows(cc)}</tr>`).join("")}</tbody></table>

  <h2>Which proxies offer which method</h2>
  <p>A cheaper method is only useful if your proxy offers it. This table counts a method only where the company's own site names it.</p>
  <table><thead><tr><th>Service</th>${CARRIERS.map((c) => `<th>${CARRIER_LABELS[c]}</th>`).join("")}</tr></thead><tbody>${offerRows}</tbody></table>
  <p class="cap">"Not listed" means we could not find the method on the company's site, not that it is definitely unavailable. The calculator still shows those totals, marked, but does not count them as cheapest.</p>

  <h2>What changes with the method</h2>
  <ul>
    <li><strong>Batteries.</strong> Japan Post does not carry lithium batteries by surface mail to Australia or Singapore, and ZenMarket and Neokyo only accept devices with batteries by EMS.</li>
    <li><strong>Tax collected up front.</strong> FROM JAPAN collects Singapore's GST at checkout on EMS, but not on surface parcels, so the tax moves to the door.</li>
    <li><strong>Size.</strong> Small packets have size limits as well as the 2 kg weight limit. A boxed figure that is light enough may still be too large.</li>
    <li><strong>The United States.</strong> Japan Post currently marks every method to the United States, EMS included, as "partially accepted", and publishes separate notices about US consumer product (CPSC) rules from 8 July 2026. Check the latest status before sending.</li>
  </ul>

  <h2>Try it on your own order</h2>
  <p>The calculator below has a shipping method option. Set your item, weight and country, then switch between methods to see the totals change.</p>`,
  };
}
