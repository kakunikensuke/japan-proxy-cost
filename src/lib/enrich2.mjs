/**
 * enrich.mjs の続き。重量別ページ・配送可否ページ・輸入税ページに足す部品。
 * 方針は enrich.mjs の冒頭と同じ（実計算からしか書かない／条件で結論が変わるものだけ）。
 */
import { calculateAll, checkShippable } from "./calc.mjs";
import { esc } from "./layout.mjs";
import { amountOf, SOURCE_NAMES } from "./enrich.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const listJoin = (arr) => arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;

// 重量帯ごとに「この重さで実際に送られがちな物」。配送可否は物の属性で決まるので、帯ごとに見る物を変える。
const PRESETS_BY_WEIGHT = {
  manga: ["manga", "trading_cards", "doujinshi_r18", "character_food"],
  "scale-figure": ["scale_figure", "figure_led", "model_kit", "model_paint"],
  "2kg": ["game_console", "figure_led", "model_kit", "spray_paint"],
  "3kg": ["game_console", "airsoft", "replica_sword", "model_kit"],
};

/** この重さ・この国で、よくある中身ごとに何社が送れるか */
export function presetsAtWeight(slug, cc, cn, data) {
  const { restrictions, proxies } = data;
  const presets = (PRESETS_BY_WEIGHT[slug] ?? []).map((id) => restrictions.categoryPresets.find((p) => p.id === id)).filter(Boolean);
  if (!presets.length) return "";
  const rows = presets.map((preset) => {
    const checks = proxies.proxies.map((p) => ({ name: p.shortName ?? p.name, ...checkShippable(preset.attributes ?? [], { proxyId: p.id, destination: cc }, restrictions) }));
    const ok = checks.filter((c) => c.level === "ok");
    const refused = checks.filter((c) => c.level === "prohibited");
    const unsure = checks.filter((c) => !["ok", "prohibited"].includes(c.level));
    const dest = (preset.attributes ?? []).some((a) => restrictions.byDestination?.[cc]?.[a]?.level === "prohibited");
    return { preset, ok, refused, unsure, dest };
  });
  const tr = rows.map((r) => `<tr${r.refused.length ? ' class="row-exception"' : ""}><td>${esc(r.preset.labelEn)}</td><td>${r.ok.length} of ${r.ok.length + r.refused.length + r.unsure.length}</td><td>${r.refused.length ? (r.dest ? "All, by Japan Post rule" : listJoin(r.refused.map((c) => esc(c.name)))) : "—"}</td></tr>`).join("");
  const clean = rows.filter((r) => !r.refused.length && !r.unsure.length);
  const blocked = rows.filter((r) => r.refused.length);
  const destBlocked = rows.filter((r) => r.dest);
  return `<p>${clean.length === rows.length
    ? `All four services will send every one of these to ${esc(cn)}.`
    : `${clean.length ? `${listJoin(clean.map((r) => esc(lc(r.preset.labelEn))))} can go through any of the four. ` : ""}${blocked.length ? `${listJoin(blocked.map((r) => esc(lc(r.preset.labelEn))))} ${blocked.length === 1 ? "is" : "are"} refused by at least one service on this route, so the cheapest total above is only the answer if the cheapest service will take it.` : ""}`}
  ${destBlocked.length ? `For ${listJoin(destBlocked.map((r) => esc(lc(r.preset.labelEn))))}, the block is Japan Post's own rule for ${esc(cn)}, so no service can send it.` : ""}</p>
  <table><thead><tr><th>If the parcel is</th><th>Services that will ship it</th><th>Refused by</th></tr></thead><tbody>${tr}</tbody></table>`;
}

/** この重さ・この国で、仕入れ元ごとの最安 */
export function sourcesAtWeight(input, data) {
  const rows = Object.entries(SOURCE_NAMES).map(([src, label]) => {
    const res = calculateAll({ ...input, source: src }, data);
    return { label, best: res.results[0], second: res.results[1] };
  });
  const names = [...new Set(rows.map((r) => r.best.name))];
  const tr = rows.map((r) => `<tr><td>${r.label}</td><td>${esc(r.best.name)}</td><td class="num">${yen(r.best.grandTotal)}</td><td class="num">${r.second.grandTotal === r.best.grandTotal ? "tie" : yen(r.second.grandTotal - r.best.grandTotal)}</td></tr>`).join("");
  return `<p>${names.length === 1
    ? `${esc(names[0])} is cheapest at this weight whichever marketplace the item comes from.`
    : `At this weight the cheapest service depends on the marketplace: ${listJoin(names.map((n) => `${esc(n)} on ${listJoin(rows.filter((r) => r.best.name === n).map((r) => r.label))}`))}.`}
  The last column is how far ahead it is of the next cheapest; where the lead is a few hundred yen, what each includes may matter more than the price.</p>
  <table><thead><tr><th>Buying from</th><th>Cheapest</th><th class="num">Total</th><th class="num">Lead over next</th></tr></thead><tbody>${tr}</tbody></table>`;
}

/** 配送可否ページ: 倉庫で断られた場合に何が戻らないか（会社ごと） */
export function refusalCost(data, attrId) {
  const base = { source: "yahoo_auction", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light" };
  const res = calculateAll(base, data);
  const rows = data.proxies.proxies.map((p) => {
    const r = res.results.find((x) => x.proxyId === p.id);
    const sunk = amountOf(r, "item") + amountOf(r, "domestic") + amountOf(r, "service") + amountOf(r, "plan");
    const level = data.restrictions.byProxy?.[p.id]?.[attrId]?.level ?? "unknown";
    const disposal = p.disposalFee ? `${yen(p.disposalFee.perKg)} per kg plus ${yen(p.disposalFee.laborPer15min)} per 15 minutes` : "not published";
    return { name: p.shortName ?? p.name, sunk, level, disposal };
  });
  const tr = rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${{ ok: "Ships", conditional: "With conditions", carrier_limited: "With conditions", unknown: "Not stated", prohibited: "Refused" }[r.level]}</td><td class="num">${yen(r.sunk)}</td><td>${r.disposal}</td></tr>`).join("");
  const risky = rows.filter((r) => r.level !== "ok");
  return `<p>${risky.length
    ? `With ${listJoin(risky.map((r) => esc(r.name)))}, this is the money at risk on a ¥10,000 Yahoo! Auctions win if the item is turned away at the warehouse. It has already been spent by the time anyone looks inside the box.`
    : `None of the four refuses this outright, but the table shows what would be at stake on a ¥10,000 Yahoo! Auctions win if a warehouse did.`}</p>
  <table><thead><tr><th>Service</th><th>Its rule</th><th class="num">Already spent</th><th>Disposal charge</th></tr></thead><tbody>${tr}</tbody></table>
  <p class="cap">"Already spent" is the item, ¥700 of postage inside Japan and the service fee. International postage is not included because the parcel never ships.</p>`;
}

/** 輸入税ページ: 9か国の中での位置づけ */
export function taxAmongCountries(cc, data, countries, countryName) {
  const base = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, domesticShippingJpy: 700, buyeePlan: "light" };
  const rows = countries.map((c) => {
    const best = calculateAll({ ...base, destination: c }, data).results[0];
    return { c, cn: countryName(c), tax: amountOf(best, "tax"), total: best.grandTotal, known: !best.grandTotalIsMinimum };
  });
  const known = rows.filter((r) => r.known).sort((a, b) => a.total - b.total);
  const me = rows.find((r) => r.c === cc);
  const rank = known.findIndex((r) => r.c === cc) + 1;
  const tr = known.map((r) => `<tr${r.c === cc ? ' class="best"' : ""}><td>${esc(r.cn)}</td><td class="num">${yen(r.tax)}</td><td class="num">${yen(r.total)}</td></tr>`).join("");
  return `<p>${me.known
    ? `Of the ${known.length} countries where the tax can be calculated, ${esc(me.cn)} is the ${rank === 1 ? "cheapest" : rank === known.length ? "most expensive" : `${rank}${["", "st", "nd", "rd"][rank] ?? "th"} cheapest`} place to receive the same ¥10,000, 1 kg order, at ${yen(me.total)}. ${me.tax ? `${yen(me.tax)} of that is tax.` : "None of it is tax."} The postage differs too, since EMS prices by zone.`
    : `The tax for ${esc(me.cn)} cannot be calculated in advance, so it is left out of this comparison. For the other countries, here is the same ¥10,000, 1 kg order:`}</p>
  <table><thead><tr><th>Ship to</th><th class="num">Tax</th><th class="num">Total</th></tr></thead><tbody>${tr}</tbody></table>`;
}
