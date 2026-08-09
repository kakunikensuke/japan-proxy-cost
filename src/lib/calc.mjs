/**
 * 購入代行サービスの着地総額を計算する。
 *
 * ■ 設計の中心にある考え方
 * 輸入時の税は「配送先の国」の制度であって、代行会社の性質ではない。
 * 代行会社が決めるのは “いつ払うか”（事前徴収 or 到着時払い）だけ。
 * したがって税を単純に足し算すると、正直に事前徴収している会社ほど高く見えてしまう。
 *
 * そこで結果を必ず3段に分けて返す:
 *   ① payNow        … いま代行会社に払う額
 *   ② payOnDelivery … 荷物の到着時に現地で払う額
 *   ③ grandTotal    … ①+② の最終総額（比較はこれで行う）
 *
 * 各行は表示用の英語ラベル(labelEn)を持つ。利用者が内訳を読めることを最優先する。
 */

/** EMS は重量帯ごとの階段状料金。線形補間せず「直近上位の重量帯」を採用する。 */
export function lookupEmsRate(emsData, countryCode, weightG) {
  const country = emsData.targetCountries.find((c) => c.code === countryCode);
  if (!country) return { amount: null, error: `No EMS rate data for ${countryCode}` };

  const zone = String(country.zone);
  const step = emsData.rates.find((r) => weightG <= r.weightG && r[zone] != null);
  if (!step) {
    const max = emsData.rates[emsData.rates.length - 1].weightG;
    return {
      amount: null,
      error: weightG > max
        ? `Shipping rates above ${max}g are not yet in our data (${weightG}g)`
        : `Rates for zone ${zone} are not yet in our data`,
    };
  }
  return { amount: step[zone], appliedWeightG: step.weightG, zone: country.zone };
}

/**
 * ZenMarket の Deposit Fee は「入金したい額の3.5%」ではなく「取引総額の3.5%」。
 * 必要額 X を口座に入れるには X/(1-0.035) を払う必要があり、実質負担は 3.627%。
 */
function calcPaymentFee(proxy, base) {
  const pf = proxy.paymentFee;
  if (!pf || pf.type === "none") return { amount: 0 };
  if (pf.type === "rate") {
    const amount = pf.grossUp
      ? Math.round(base * (pf.rate / (1 - pf.rate)))
      : Math.round(base * pf.rate);
    return { amount };
  }
  return { amount: 0, warning: `${proxy.shortName ?? proxy.name}: payment fee is not published; treated as ¥0` };
}

function calcServiceFee(proxy, { source, itemCount, sameShop }) {
  const raw = proxy.serviceFee.bySource[source];
  if (raw == null) {
    return { amount: 0, warning: `${proxy.shortName ?? proxy.name} does not publish a fee for ${source}` };
  }
  const amount = typeof raw === "object" ? raw.amount : raw;
  const unit = typeof raw === "object" ? raw.unit : proxy.serviceFee.unit;
  const unverified = typeof raw === "object" ? raw.unverified : false;

  // Buyee のみ仕入れ元ごとに課金単位が違う（フリマ/オークション=落札ごと、ショッピング=注文ごと）
  const multiplier = unit === "order" && sameShop ? 1 : itemCount;

  return {
    amount: amount * multiplier,
    unit,
    warning: unverified ? `${proxy.shortName ?? proxy.name}: ${source} fee is estimated, not published` : null,
  };
}

function calcPackingFee(proxy, weightG) {
  const pk = proxy.packingFee;
  if (!pk || pk.type === "included") return { amount: 0 };
  if (pk.type === "weight") {
    if (weightG <= pk.baseUpToG) return { amount: pk.baseAmount };
    const overKg = Math.ceil((weightG - pk.baseUpToG) / 1000);
    return { amount: pk.baseAmount + overKg * pk.perAdditionalKg };
  }
  if (pk.type === "paid") {
    return { amount: 0, warning: `${proxy.shortName ?? proxy.name} charges for consolidated packing but does not publish the price; your actual total will be higher` };
  }
  return { amount: 0, warning: `${proxy.shortName ?? proxy.name}: packing fee unknown` };
}

function calcPlanFee(proxy, planId) {
  // proxy.included は呼び出し側で合流させるので、ここでは返さない（二重計上になる）
  if (!proxy.plans) return { amount: 0, includes: [] };
  const plan = proxy.plans.find((p) => p.id === planId) ?? proxy.plans.find((p) => p.id === proxy.defaultPlan);
  const includes = [];
  if (plan.inspection) includes.push("inspection");
  if (plan.shippingGuarantee) includes.push("international_insurance");
  return { amount: plan.fee, planName: plan.nameEn ?? plan.name, includes };
}

function calcExportClearance(proxy, { itemTotal, carrier }) {
  const ec = proxy.exportClearanceFee;
  if (!ec) {
    return {
      amount: 0,
      warning: itemTotal > 200000
        ? `${proxy.shortName ?? proxy.name} does not publish whether an export clearance fee applies above ¥200,000`
        : null,
    };
  }
  if (itemTotal > ec.thresholdJpy && ec.carriers.includes(carrier)) return { amount: ec.amount };
  return { amount: 0 };
}

/** その代行会社が、この配送先の税を事前徴収するか */
function findPrepayRule(proxy, destination, carrier) {
  const rule = (proxy.taxPrepay ?? []).find((t) => t.country === destination);
  if (!rule) return null;
  if (rule.onlyCarriers && !rule.onlyCarriers.includes(carrier)) return null;
  if (rule.unverifiedRate || rule.rate == null) return { ...rule, unusable: true };
  return rule;
}

function taxBaseAmount(base, { itemTotal, intlShipping, otherCosts }) {
  if (base === "charge1") return itemTotal;
  if (base === "goods+intl") return itemTotal + intlShipping;
  return itemTotal + otherCosts; // charge1+charge2
}

/** 深刻な順。数字が大きいほど「送れない」に近い。 */
const LEVEL_SEVERITY = { ok: 0, conditional: 1, carrier_limited: 1, unknown: 2, prohibited: 3 };

/** 順位付け用。unknown を prohibited より前に置くのは「送れないと断定はできない」ため。 */
const LEVEL_RANK = { ok: 0, conditional: 1, carrier_limited: 1, unknown: 2, prohibited: 3 };

function worse(a, b) {
  return LEVEL_SEVERITY[a] >= LEVEL_SEVERITY[b] ? a : b;
}

/**
 * この商品を、この代行会社で、この配送先へ送れるか。
 *
 * 「送れない」を黙って通すと、利用者は落札してから知ることになる。
 * そのとき商品代・国内送料・キャンセル料だけ取られて商品は手に入らないので、
 * 金額を間違えるより深刻。判定できない場合は ok ではなく unknown を返す。
 *
 * 判定は2軸の重ね合わせ。
 *   軸1 byProxy       … 代行会社が自社ポリシーで拒否するか
 *   軸2 byDestination … 配送先の国（＝日本郵便の引受可否）が拒否するか
 * 輸入税と同じ考え方で、国側の制限は代行会社の性質ではないため全社に同条件で乗せる。
 *
 * carrier_limited は「その配送手段なら可」の意味だが、本ツールはEMSしか扱わないので、
 * allowedCarriers に現在の carrier が無ければ prohibited に落とす。
 */
export function checkShippable(attributes, { proxyId, destination, carrier = "ems" }, restrictions) {
  const blockers = [];
  let level = "ok";

  for (const attrId of attributes ?? []) {
    const attr = restrictions.attributes.find((a) => a.id === attrId);
    const labelEn = attr?.labelEn ?? attrId;

    for (const [axis, cell] of [
      ["proxy", restrictions.byProxy?.[proxyId]?.[attrId]],
      ["destination", restrictions.byDestination?.[destination]?.[attrId]],
    ]) {
      if (!cell) continue;

      let cellLevel = cell.level;
      if (cellLevel === "carrier_limited" && cell.allowedCarriers && !cell.allowedCarriers.includes(carrier)) {
        cellLevel = "prohibited";
      }
      if (cellLevel === "ok") continue;

      blockers.push({
        attribute: attrId,
        attributeLabelEn: labelEn,
        axis,
        level: cellLevel,
        reasonEn: cell.noteEn ?? null,
        quoteEn: cell.quoteEn ?? null,
        sourceUrl: cell.sourceUrl ?? restrictions.byProxy?.[proxyId]?._source?.sourceUrl ?? null,
        verifiedAt: cell.verifiedAt ?? restrictions.byProxy?.[proxyId]?._source?.verifiedAt ?? null,
      });
      level = worse(level, cellLevel);
    }
  }

  // 深刻な順に並べる。UIは先頭だけ出しても意味が通るようにしておく。
  blockers.sort((a, b) => LEVEL_SEVERITY[b.level] - LEVEL_SEVERITY[a.level]);
  return { level, blockers };
}

export function calculateAll(input, { proxies, ems, importTax, restrictions }) {
  const {
    source, itemPriceJpy, itemCount, weightG, destination,
    domesticShippingJpy, carrier = "ems", sameShop = false,
    buyeePlan = "light", attributes = [],
  } = input;

  const shipping = lookupEmsRate(ems, destination, weightG);
  const country = importTax.countries[destination];

  const results = proxies.proxies.map((proxy) => {
    const warnings = [];
    const push = (w) => { if (w) warnings.push(w); };

    const service = calcServiceFee(proxy, { source, itemCount, sameShop });
    push(service.warning);
    const plan = calcPlanFee(proxy, proxy.id === "buyee" ? buyeePlan : undefined);
    const packing = calcPackingFee(proxy, weightG);
    push(packing.warning);

    const intl = shipping.amount ?? 0;
    if (shipping.error) push(shipping.error);

    const clearance = calcExportClearance(proxy, { itemTotal: itemPriceJpy, carrier });
    push(clearance.warning);

    const beforePaymentFee = itemPriceJpy + service.amount + plan.amount + packing.amount
      + domesticShippingJpy + intl + clearance.amount;
    const payment = calcPaymentFee(proxy, beforePaymentFee);
    push(payment.warning);

    // ---- ① いま代行に払う ----
    const payNowLines = [
      { key: "item",     labelEn: "Item price",              amount: itemPriceJpy },
      { key: "service",  labelEn: "Proxy service fee",       amount: service.amount },
      { key: "plan",     labelEn: `Protection plan${plan.planName ? ` (${plan.planName})` : ""}`, amount: plan.amount },
      { key: "packing",  labelEn: "Packing / consolidation", amount: packing.amount },
      { key: "domestic", labelEn: "Domestic shipping in Japan", amount: domesticShippingJpy },
      { key: "intl",     labelEn: "International shipping",  amount: intl },
      { key: "clearance",labelEn: "Export clearance fee",    amount: clearance.amount },
      { key: "payment",  labelEn: "Payment / deposit fee",   amount: payment.amount },
    ].filter((l) => l.amount > 0);

    // ---- 税: 事前徴収なら①、そうでなければ② ----
    const otherCosts = payNowLines.reduce((s, l) => s + l.amount, 0) - itemPriceJpy;
    const prepay = findPrepayRule(proxy, destination, carrier);

    let taxTiming = "none";
    const payOnDeliveryLines = [];
    const deliveryNotes = [];
    let deliveryQuantified = true;

    if (prepay && !prepay.unusable) {
      const amount = Math.round(taxBaseAmount(prepay.base, { itemTotal: itemPriceJpy, intlShipping: intl, otherCosts }) * prepay.rate);
      payNowLines.push({
        key: "tax",
        labelEn: `${prepay.tax} collected up front (${(prepay.rate * 100).toFixed(prepay.rate * 100 % 1 ? 1 : 0)}%)`,
        amount,
        note: "Paid now, so nothing to pay when the parcel arrives.",
      });
      taxTiming = "prepaid";
    } else {
      if (prepay?.unusable) push(`${proxy.shortName ?? proxy.name} pre-collects ${prepay.tax} for ${destination} but does not publish the rate`);
      taxTiming = "on-delivery";

      if (country?.vatRate != null) {
        const amount = Math.round((itemPriceJpy + intl) * country.vatRate);
        payOnDeliveryLines.push({
          key: "import_tax",
          labelEn: `${country.vatLabel ?? "Import VAT"} (${(country.vatRate * 100).toFixed(country.vatRate * 100 % 1 ? 1 : 0)}%)`,
          amount,
          note: "Charged by your customs authority when the parcel arrives.",
        });
      } else if (country) {
        deliveryQuantified = false;
        deliveryNotes.push(country.displayEn?.body ?? "Import charges apply but cannot be estimated.");
      }
      deliveryNotes.push("Couriers usually add their own customs handling fee on top. Paying tax up front often avoids it.");
    }

    // 免税枠の廃止など、国側の重要な注意は税のタイミングに関係なく常に出す
    if (country?.displayEn && taxTiming === "prepaid" && country.dutyRateStatus === "unknown-by-hs-code") {
      deliveryQuantified = false;
      deliveryNotes.push(country.displayEn.body);
    }

    const payNowTotal = payNowLines.reduce((s, l) => s + l.amount, 0);
    const payOnDeliveryTotal = payOnDeliveryLines.reduce((s, l) => s + l.amount, 0);

    // 配送可否。restrictions が渡されない呼び出し（既存の試算スクリプト等）では判定しない。
    const shippable = restrictions
      ? checkShippable(attributes, { proxyId: proxy.id, destination, carrier }, restrictions)
      : { level: "ok", blockers: [] };

    if (shippable.level === "prohibited") {
      push(`${proxy.shortName ?? proxy.name} cannot ship this item — the price below is for reference only`);
    } else if (shippable.level === "unknown") {
      push(`${proxy.shortName ?? proxy.name} does not publish a rule for this kind of item; it may be refused after you buy`);
    }

    return {
      shippable,
      proxyId: proxy.id,
      name: proxy.shortName ?? proxy.name,
      url: proxy.url,
      planName: plan.planName,
      includes: [...new Set([...(proxy.included ?? []), ...(plan.includes ?? [])])],

      payNow:        { labelEn: "You pay the proxy now", total: payNowTotal, lines: payNowLines },
      payOnDelivery: {
        labelEn: "You pay on delivery",
        total: payOnDeliveryTotal,
        quantified: deliveryQuantified,
        lines: payOnDeliveryLines,
        notes: [...new Set(deliveryNotes)],
      },
      grandTotal:    payNowTotal + payOnDeliveryTotal,
      grandTotalIsMinimum: !deliveryQuantified,

      taxTiming,
      proxyFeesOnly: payNowTotal - itemPriceJpy,  // 商品代を除いた代行コスト（内部比較用）
      warnings,
      affiliate: proxy.affiliate,
    };
  });

  // 配送可否を第1キーにする。
  // 金額だけで並べると「送れないが安い会社」が1位＝おすすめとして出てしまい、
  // 元のバグ（送れない商品に見積もりを出す）より悪い結果になる。
  results.sort((a, b) =>
    LEVEL_RANK[a.shippable.level] - LEVEL_RANK[b.shippable.level] || a.grandTotal - b.grandTotal
  );

  const allBlocked = results.length > 0 && results.every((r) => r.shippable.level === "prohibited");
  const noneConfirmed = results.length > 0 && results.every((r) => r.shippable.level !== "ok");

  return { shipping, country, results, allBlocked, noneConfirmed };
}
