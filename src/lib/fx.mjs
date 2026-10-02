/**
 * 円の金額を、配送先の国の通貨で「目安」として添える（2026-10-02）。
 * レートは data/fx.json（欧州中央銀行の参照レート、台湾ドルのみ米連邦準備制度H.10）。
 * 計算と順位は常に円で行い、外貨はあくまで表示用。使った日付と出典を必ずどこかに併記すること。
 */
export function localPrice(yen, cc, fx) {
  const cur = fx?.currencyOf?.[cc];
  const rate = cur ? fx?.jpyPer?.[cur] : null;
  if (!cur || !rate || !Number.isFinite(yen)) return null;
  return `${fx.symbol[cur]}${Math.round(yen / rate).toLocaleString("en-US")}`;
}

/** 「≈ US$105」の形。換算できなければ空文字 */
export function approx(yen, cc, fx) {
  const p = localPrice(yen, cc, fx);
  return p ? `≈ ${p}` : "";
}

/** 換算に使ったレートの説明（1文） */
export function fxNote(cc, fx) {
  const cur = fx?.currencyOf?.[cc];
  const rate = cur ? fx?.jpyPer?.[cur] : null;
  if (!cur || !rate) return "";
  const src = cur === "TWD"
    ? `the US Federal Reserve's H.10 rates of ${fx._meta.asOf.fedH10}`
    : `the European Central Bank reference rate of ${fx._meta.asOf.ecb}`;
  return `Local-currency figures are approximate, converted at ${src} (1 ${fx.symbol[cur]} = ¥${rate.toFixed(rate < 10 ? 2 : 1)}). Your card or the proxy will use its own rate on the day.`;
}
