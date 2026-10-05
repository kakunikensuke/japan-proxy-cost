/**
 * 比較している代行会社の数と名前を、文章に埋め込む形で出す（2026-10-05）。
 *
 * 以前は本文に "all four" "the four services" "Buyee, ZenMarket, Neokyo and FROM JAPAN" が
 * 60か所以上手書きされていて、会社を1社足すと全部が嘘になる状態だった。
 * 本文で会社の数や名前の一覧を書くときは、必ずここから取ること（プリレンダ専用。計算機は使わない）。
 */
import proxies from "../../data/proxies.json" with { type: "json" };

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const listJoin = (arr) => arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const names = proxies.proxies.map((p) => p.shortName ?? p.name);

/** 比較している会社の数（数字） */
export const N_PROXIES = names.length;
/** 同じく英単語（"five"） */
export const NW = WORDS[N_PROXIES] ?? String(N_PROXIES);
/** 文頭用（"Five"） */
export const NWC = NW.charAt(0).toUpperCase() + NW.slice(1);
/** 「残りの会社」の数（"four"）。比較表の「The other …」に使う */
export const NW_OTHERS = WORDS[N_PROXIES - 1] ?? String(N_PROXIES - 1);
/** 本文用の社名一覧（"FROM JAPAN, Buyee, ZenMarket, Neokyo and Doorzo"） */
export const PROXY_NAME_LIST = listJoin(names);
/** title・description 用。検索されやすい順に並べ、知らない会社は末尾に足す */
const TITLE_ORDER = ["Buyee", "ZenMarket", "FROM JAPAN", "Neokyo"];
const titleNames = [...TITLE_ORDER.filter((n) => names.includes(n)), ...names.filter((n) => !TITLE_ORDER.includes(n))];
export const PROXY_TITLE_LIST = listJoin(titleNames);
export const PROXY_TITLE_AMP = titleNames.length <= 1 ? titleNames.join("") : `${titleNames.slice(0, -1).join(", ")} & ${titleNames.at(-1)}`;
export const numberWord = (n) => WORDS[n] ?? String(n);

/**
 * 代行手数料1件ぶんの表示。固定額（¥500）と料率型（3%・下限¥200・上限¥300）の両方を扱う。
 * 料率型を固定額として読むと「¥NaN」になる（2026-10-05、Doorzo を足したときに実際に出た）。
 */
export function feeText(v) {
  const yen = (n) => "\u00a5" + Math.round(n).toLocaleString("en-US");
  if (v == null) return "not published";
  if (typeof v === "object" && v.type === "rate") {
    return `${+(v.rate * 100).toFixed(1)}% of the item price (${yen(v.min)}\u2013${yen(v.max)})`;
  }
  return yen(typeof v === "object" ? v.amount : v);
}
/** 固定額としての最小・最大（料率型は下限・上限）。範囲表示用 */
export function feeBounds(v) {
  if (typeof v === "object" && v.type === "rate") return [v.min, v.max];
  const a = typeof v === "object" ? v.amount : v;
  return [a, a];
}
