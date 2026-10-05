/**
 * 米国関税の目安を文と表にする部品（2026-10-05）。数字は import-tax.json の dutyEstimate と calc.mjs の estimateDuty から。
 *
 * ■ 総額には足さない（calc.mjs の estimateDuty の説明を参照）。表示する所には必ず「総額に含まない」と書く
 * ■ 誰がいつ徴収するか・手数料は確認できていないので、断言しない
 */
import { estimateDuty } from "./calc.mjs";
import { esc } from "./layout.mjs";

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");

/** 表のセル用の短い表記 */
export function dutyCell(country, price, category) {
  const e = estimateDuty(country, price, category);
  if (!e) return null;
  return e.kind === "exempt" ? "none expected" : `${e.kind === "floor" ? "at least" : "about"} ${yen(e.amount)}`;
}

/** 「その品目なら関税はいくらか」の1文 */
export function dutySentence(country, price, category, what) {
  const e = estimateDuty(country, price, category);
  if (!e) return "";
  if (e.kind === "exempt") return `Publications, films, records, CDs and other informational materials are exempt from the US duty on Japanese goods, so for ${esc(what)} no duty is expected.`;
  if (e.kind === "exact") return `The normal US duty on ${esc(what)} is zero, so goods made in Japan pay the 12.5% that has applied since ${fmtDate(e.effectiveFrom)}: about ${yen(e.amount)} on a ¥${price.toLocaleString("en-US")} item.`;
  return `Goods made in Japan pay at least 12.5% since ${fmtDate(e.effectiveFrom)}, more where the item's normal US duty is higher: at least ${yen(e.amount)} on a ¥${price.toLocaleString("en-US")} item.`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const fmtDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/** 米国の国別ガイドに載せる節（dutyEstimate を持つ国だけ） */
export function dutySection(country, genres) {
  const d = country?.dutyEstimate;
  if (!d) return "";
  const rows = genres.map((g) => {
    const o = g.order;
    const e = estimateDuty(country, o.price, o.category);
    return `<tr><td><a href="/guides/${g.slug}">${esc(g.name.charAt(0).toUpperCase() + g.name.slice(1))}</a></td><td>${esc(e.labelEn)}</td><td>${esc(o.what)}, ¥${o.price.toLocaleString("en-US")}</td><td class="num">${dutyCell(country, o.price, o.category)}</td></tr>`;
  }).join("");
  const exact = genres.filter((g) => estimateDuty(country, g.order.price, g.order.category)?.kind === "exact").map((g) => esc(g.name));
  // 「CDs and Blu-rays」のように名前に and を含むジャンルは分けて並べる（and が二重になるため）
  const exempt = genres.filter((g) => estimateDuty(country, g.order.price, g.order.category)?.kind === "exempt").flatMap((g) => g.name.split(" and ")).map(esc);
  const lj = (a) => a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
  return `<h2 id="how-much-duty">How much US duty to expect</h2>
  <p>The totals on this site leave US duty out, because the exact rate depends on the tariff code of the item. The rules for goods made in Japan are simple enough to give a guide, though.
  Since ${fmtDate(d.effectiveFrom)}, a product of Japan pays a combined 12.5% where its normal US duty is below 12.5%, and its normal duty alone where that is 12.5% or more.
  Publications, films, posters, records, photographs, tapes, CDs, CD-ROMs and artworks are exempt.</p>
  <table><thead><tr><th>Buying</th><th>Duty rate</th><th>Assumed item</th><th class="num">Duty</th></tr></thead><tbody>${rows}</tbody></table>
  <p>${exact.length ? `For ${lj(exact)}, the normal duty is zero, so the 12.5% is the whole of it. ` : ""}${exempt.length ? `${lj(exempt).charAt(0).toUpperCase() + lj(exempt).slice(1)} fall under the exemption for informational materials. ` : ""}Mixed merchandise is shown as "at least" because some of it, clothing and bags in particular, has a normal duty above 12.5%.</p>
  <p>The normal US duty on some common items, from the US tariff schedule:</p>
  <table><thead><tr><th>Item</th><th>Tariff heading</th><th class="num">Normal duty</th></tr></thead><tbody>${d.normalDutyEn.map((x) => `<tr><td>${esc(x.what)}</td><td>${esc(x.hts)}</td><td class="num">${esc(x.normal)}</td></tr>`).join("")}</tbody></table>
  <h3>What this estimate does not cover</h3>
  <ul>
    <li>The rate is applied to the item price. US customs value goods at the price paid, without the international postage.</li>
    <li>Goods made in China, as many figures are, have their own line in the tariff: 12.5% on top of the normal duty, which also comes to 12.5% where the normal duty is zero. Older China-specific duties apply to some products.</li>
    <li>The notice that set the 12.5% also lists specific products that are excluded. That list is published as images and we have not checked it line by line; a product on it pays less than shown here.</li>
    <li>Who collects the duty on a Japan Post parcel, and what they charge for doing it, we could not confirm for any of the services on this site. Ask your service before you buy.</li>
  </ul>
  <p class="cap">Sources, checked ${fmtDate(d.verifiedAt)}: ${d.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.labelEn)}</a>`).join("; ")}.</p>`;
}
