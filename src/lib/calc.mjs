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
 * EMS 以外の日本郵便（小形包装物の航空便・国際小包の航空便/船便）の料金。2026-10-02 追加。
 * 料金表は data/shipping-post.json。地帯は EMS と同じなので shipping-ems.json の targetCountries を使う。
 * SAL便は日本郵便が引受を全面停止しているので収録していない（料金表にだけ残っている）。
 */
export const CARRIER_LABELS = {
  ems: "EMS",
  small_packet_air: "Airmail small packet",
  intl_parcel_air: "Airmail parcel",
  intl_parcel_sea: "Surface (sea) parcel",
};

export function lookupShippingRate({ ems, post }, carrier, countryCode, weightG) {
  if (!carrier || carrier === "ems") return { ...lookupEmsRate(ems, countryCode, weightG), carrier: "ems" };
  const method = post?.methods?.[carrier];
  if (!method?.rates) return { amount: null, error: `No rate data for ${CARRIER_LABELS[carrier] ?? carrier}`, carrier };
  const country = ems.targetCountries.find((c) => c.code === countryCode);
  if (!country) return { amount: null, error: `No rate data for ${countryCode}`, carrier };
  if (weightG > method.maxG) {
    return { amount: null, error: `${method.labelEn} takes parcels up to ${method.maxG / 1000}kg; this one is ${weightG}g`, carrier };
  }
  const zone = String(country.zone);
  const step = method.rates.find((r) => weightG <= r.weightG && r[zone] != null);
  if (!step) return { amount: null, error: `${method.labelEn} rates for zone ${zone} are not in our data`, carrier };
  return { amount: step[zone], appliedWeightG: step.weightG, zone: country.zone, carrier };
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

function calcServiceFee(proxy, { source, itemCount, sameShop, itemPriceJpy }) {
  const raw = proxy.serviceFee.bySource[source];
  if (raw == null) {
    return { amount: 0, warning: `${proxy.shortName ?? proxy.name} does not publish a fee for ${source}` };
  }
  // 料率で決まる手数料。商品価格は複数点の合計で入ってくるので、1点あたりに割って料率を当て、下限・上限で挟む
  if (typeof raw === "object" && raw.type === "rate") {
    const perItem = itemPriceJpy / Math.max(1, itemCount);
    const each = Math.min(raw.max ?? Infinity, Math.max(raw.min ?? 0, Math.round(perItem * raw.rate)));
    return { amount: each * itemCount, unit: "item" };
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

function calcExportClearance(proxy, { itemTotal, carrier, itemCount }) {
  const ec = proxy.exportClearanceFee;
  if (!ec) {
    return {
      amount: 0,
      warning: itemTotal > 200000
        ? `${proxy.shortName ?? proxy.name} does not publish whether an export clearance fee applies above ¥200,000`
        : null,
    };
  }
  const covered = ec.carriers.some((c) => c === carrier || String(carrier).startsWith(c + "_"));
  if (itemTotal > ec.thresholdJpy && covered) return { amount: ec.amount + (ec.perItemAmount ?? 0) * Math.max(1, itemCount ?? 1) };
  return { amount: 0 };
}

/**
 * その代行会社が、この配送先の税を事前徴収するか。
 *
 * 事前徴収には現地通貨建てのしきい値がある（例: FROM JAPAN と Neokyo は豪州 AUD1,000 以下だけ）。
 * これを無視すると高額品で「事前徴収済み・到着時0円」と表示してしまうが、実際には
 * 国境で消費税と関税を請求される。0円と言い切って請求が来るのは、金額を外すより悪い。
 * 円換算はあくまで概算なので、レートの日付を添えて warnings に出す。
 */
function findPrepayRule(proxy, destination, carrier, { itemPriceJpy, itemCount = 1, fx }) {
  const rule = (proxy.taxPrepay ?? []).find((t) => t.country === destination);
  if (!rule) return null;
  if (rule.onlyCarriers && !rule.onlyCarriers.includes(carrier)) return null;
  if (rule.exceptCarriers?.includes(carrier)) return null;
  if (rule.unverifiedRate || rule.rate == null) return { ...rule, unusable: true };

  const jpyPer = fx?.jpyPer?.[rule.thresholdCurrency];
  if (rule.thresholdValue == null || !jpyPer) return rule;

  const thresholdJpy = Math.round(rule.thresholdValue * jpyPer);
  // 上限が1品ごとの会社（ZenMarket のシンガポール）は、1品あたりの価格で判定する
  const basis = rule.thresholdPer === "item" ? itemPriceJpy / Math.max(1, itemCount) : itemPriceJpy;
  const within = rule.thresholdRule === "atOrUnder"
    ? basis <= thresholdJpy
    : basis < thresholdJpy;
  return { ...rule, thresholdJpy, overThreshold: !within };
}

/** 「AUD 1,000」のように読める形にする。"AUD1000" は英語圏の表記として不自然。 */
function thresholdLabel(rule) {
  return `${rule.thresholdCurrency} ${rule.thresholdValue.toLocaleString("en-US")}`;
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
      if (cell.excludedCarriers?.includes(carrier)) {
        cellLevel = "prohibited";
      }
      // 「原則OKだが、この国宛だけ不可」を表現する。
      // 代行会社が国名を名指しで挙げているケース（例: Neokyo は成人向けを香港宛に禁止）は、
      // 配送先を1か国足しただけで判定がひっくり返るので、国リストとして持つ必要がある。
      if (cell.prohibitedDestinations?.includes(destination)) {
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

export function calculateAll(input, { proxies, ems, importTax, restrictions, stores, post }) {
  const {
    source, itemPriceJpy, itemCount, weightG, destination,
    domesticShippingJpy, carrier = "ems", sameShop = false,
    buyeePlan = "light", attributes = [],
  } = input;

  const shipping = lookupShippingRate({ ems, post }, carrier, destination, weightG);
  const country = importTax.countries[destination];

  const results = proxies.proxies.map((proxy) => {
    const warnings = [];
    const push = (w) => { if (w) warnings.push(w); };

    // EMS以外は、その会社が公式ページでこの配送方法を挙げているかを見る。
    // 挙げていない会社を黙って同じ料金で並べると、使えない配送方法の総額で最安に見えてしまう。
    const offer = carrier === "ems" ? { status: "listed" } : post?.offeredBy?.[proxy.id]?.[carrier];
    const methodListed = offer?.status === "listed";
    if (!methodListed) {
      push(offer?.warningEn ?? `${proxy.shortName ?? proxy.name} does not list ${(CARRIER_LABELS[carrier] ?? carrier).toLowerCase()} among its shipping methods, so this total may not be available`);
    }

    const service = calcServiceFee(proxy, { source, itemCount, sameShop, itemPriceJpy });
    push(service.warning);
    const plan = calcPlanFee(proxy, proxy.id === "buyee" ? buyeePlan : undefined);
    const packing = calcPackingFee(proxy, weightG);
    push(packing.warning);

    const intl = shipping.amount ?? 0;
    if (shipping.error) push(shipping.error);

    const clearance = calcExportClearance(proxy, { itemTotal: itemPriceJpy, carrier, itemCount });
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
    const prepay = findPrepayRule(proxy, destination, carrier, { itemPriceJpy, itemCount, fx: importTax.fx });

    let taxTiming = "none";
    const payOnDeliveryLines = [];
    const deliveryNotes = [];
    let deliveryQuantified = true;

    // しきい値付近では為替が動くだけで事前徴収の有無が入れ替わる
    if (prepay?.thresholdJpy && Math.abs(itemPriceJpy - prepay.thresholdJpy) <= prepay.thresholdJpy * 0.15) {
      push(
        `This order sits close to the ${thresholdLabel(prepay)} limit below which ` +
        `${proxy.shortName ?? proxy.name} collects ${prepay.tax} up front ` +
        `(about ¥${prepay.thresholdJpy.toLocaleString("en-US")} at ${importTax.fx?.asOf ?? "recent"} rates). ` +
        `Which side of the line you land on decides whether you pay now or at the border.`
      );
    }

    if (prepay && !prepay.unusable && !prepay.overThreshold) {
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
      if (prepay?.overThreshold) {
        deliveryQuantified = false;
        push(
          `${proxy.shortName ?? proxy.name} only collects ${prepay.tax} up front on orders under ` +
          `${thresholdLabel(prepay)} (about ¥${prepay.thresholdJpy.toLocaleString("en-US")}). ` +
          `This order is above that, so it clears customs as a formal import: you pay ${prepay.tax} at the ` +
          `border and customs duty may apply on top, which we cannot estimate without the item's HS code.`
        );
      }
      taxTiming = "on-delivery";

      if (country?.vatRate != null) {
        // 免税枠がまだ生きている国（台湾など）は、しきい値以下なら税がかからない。
        // これを無視すると、免税枠のある国を不当に高く見せてしまう。
        // 円換算はあくまで概算なので、しきい値付近では為替で結果が変わる旨を警告する。
        const dm = country.deMinimis;
        const dmActive = dm?.status === "active" && dm.approxJpy != null;
        const dmLabel = dm ? (dm.thresholdLabelEn ?? `${dm.currency} ${dm.dutyThreshold}`) : null;
        const taxableBase = itemPriceJpy + intl;
        const underThreshold = dmActive && taxableBase <= dm.approxJpy;
        const taxFree = country.vatRate === 0;

        const amount = underThreshold ? 0 : Math.round(taxableBase * country.vatRate);
        payOnDeliveryLines.push({
          key: "import_tax",
          labelEn: taxFree
            ? `${country.vatLabel ?? "Import VAT"} — none at this destination`
            : underThreshold
              ? `${country.vatLabel ?? "Import VAT"} — under the ${dmLabel} duty-free limit`
              : `${country.vatLabel ?? "Import VAT"} (${(country.vatRate * 100).toFixed(country.vatRate * 100 % 1 ? 1 : 0)}%)`,
          amount,
          // 税がゼロの国に「到着時に税関から請求されます」と書くと、0円の行と矛盾する
          note: taxFree
            ? "There is no import tax on general goods at this destination."
            : underThreshold
              ? `Parcels valued at or below ${dmLabel} arrive tax free.`
              : "Charged by your customs authority when the parcel arrives.",
        });

        // しきい値の±15%以内なら、為替が動くだけで課税・非課税が入れ替わる
        if (dmActive && Math.abs(taxableBase - dm.approxJpy) <= dm.approxJpy * 0.15) {
          push(
            `This order is close to ${country.name}'s ${dmLabel} duty-free limit ` +
            `(about ¥${dm.approxJpy.toLocaleString("en-US")} at ${dm.fx?.asOf ?? "recent"} rates). ` +
            `A move in the exchange rate can push it either side of the line.`
          );
        }
      } else if (country) {
        deliveryQuantified = false;
        deliveryNotes.push(country.displayEn?.body ?? "Import charges apply but cannot be estimated.");
      }
      // 税がゼロの国（香港など）に「通関手数料が上乗せされる」と出すと嘘になる
      if (country?.vatRate === 0) {
        deliveryNotes.push("Nothing to pay on arrival — this destination charges no import tax on general goods.");
      } else {
        deliveryNotes.push("Couriers usually add their own customs handling fee on top. Paying tax up front often avoids it.");
      }
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
      methodListed,
      proxyFeesOnly: payNowTotal - itemPriceJpy,  // 商品代を除いた代行コスト（内部比較用）
      warnings,
      affiliate: proxy.affiliate,
    };
  });

  // 配送可否を第1キーにする。
  // 金額だけで並べると「送れないが安い会社」が1位＝おすすめとして出てしまい、
  // 元のバグ（送れない商品に見積もりを出す）より悪い結果になる。
  // 第1キー: 配送可否 / 第2キー: その配送方法を扱っているか / 第3キー: 総額
  results.sort((a, b) =>
    LEVEL_RANK[a.shippable.level] - LEVEL_RANK[b.shippable.level]
      || (a.methodListed ? 0 : 1) - (b.methodListed ? 0 : 1)
      || a.grandTotal - b.grandTotal
  );

  const allBlocked = results.length > 0 && results.every((r) => r.shippable.level === "prohibited");
  const noneConfirmed = results.length > 0 && results.every((r) => r.shippable.level !== "ok");

  const storeSuggestion = suggestStores(input, results, stores);
  const dutyEstimate = estimateDuty(country, input.itemPriceJpy, input.category);

  return { shipping, country, results, allBlocked, noneConfirmed, storeSuggestion, dutyEstimate };
}

/**
 * 関税の目安（いまは米国だけ）。品目の種類（計算機のカテゴリ）ごとの料率 × 商品代。
 *
 * ■ 総額には足さない
 * 正確な料率は品目のHSコードで決まり、郵便物の関税を誰がいつ徴収するか（代行の前払い・
 * 日本郵便側・受取時）と手数料も確認できていない。総額に入れると「到着時に¥Nを払う」と
 * 断言することになるので、別枠の目安として返し、表示側で必ず「総額に含まない」と書く。
 * kind: exact = 通常の関税がゼロの品目（合計がちょうど12.5%）/ floor = 品目が分からない（12.5%以上）/ exempt = 情報資料
 */
export function estimateDuty(country, itemPriceJpy, category) {
  const d = country?.dutyEstimate;
  if (!d || !Number.isFinite(itemPriceJpy)) return null;
  const cls = d.byPreset?.[category] ?? "unknown";
  const c = d.classes[cls];
  if (!c) return null;
  return { cls, rate: c.rate, kind: c.kind, labelEn: c.labelEn, amount: Math.round(itemPriceJpy * c.rate), effectiveFrom: d.effectiveFrom, verifiedAt: d.verifiedAt };
}

/**
 * 「そもそも代行が要らない」場合に、日本から直接海外発送する店を提案する。
 *
 * ■ 代行4社の順位には一切影響させない
 * 報酬の大小で表示順を歪めないという鉄則の適用。直販を代行と同じ土俵で競わせず、
 * 「代行手数料そのものが不要になりうる別の道」として横に置く。
 *
 * ■ 出さない条件を明示的に持つ
 *   ① 中古・絶版が中心の仕入れ元（ヤフオク/メルカリ/ラクマ）… 直販に同じ物が無い
 *   ② どの代行も送れない商品 … 直販でも送れない公算が高く、無責任な送客になる
 *   ③ 未承認のプログラム（affiliateUrl が null）… 規約違反を避ける
 *
 * ■ 金額を断言しない
 * 直販側の商品価格も送料も我々は持っていない。したがって「直販が安い」とは言わない。
 * 言えるのは「代行を通すと最低 ¥N の手数料がかかる」という自分の計算結果だけ。
 */
export function suggestStores(input, results, stores) {
  if (!stores || !Array.isArray(stores.stores) || stores.stores.length === 0) return null;

  const source = input?.source;
  const rule = stores.sourceRule ?? {};

  if ((rule.doNotSuggestFor ?? []).includes(source)) {
    return { applicable: false, reason: "secondhand-source" };
  }
  if (Array.isArray(rule.suggestFor) && !rule.suggestFor.includes(source)) {
    return { applicable: false, reason: "source-not-listed" };
  }

  // 全社が送れない商品なら、直販でも送れない公算が高い。送れない先へ送客しない。
  const sendable = results.filter((r) => r.shippable?.level !== "prohibited");
  if (sendable.length === 0) return { applicable: false, reason: "all-blocked" };

  // 未承認プログラムのリンクは出さない。品目が分かるときは、その品目を扱う店だけ（data/stores.json の presetCategories）
  const wanted = stores.presetCategories?.[input?.category];
  const available = stores.stores.filter((s) => s.affiliateUrl && (!Array.isArray(wanted) || (s.categories ?? []).some((x) => wanted.includes(x))));
  if (available.length === 0) return { applicable: false, reason: "no-approved-store" };

  // 商品代を除いた代行コストの最小値 ＝ 直販なら丸ごと不要になりうる額
  const feesOnly = sendable.map((r) => r.proxyFeesOnly).filter((n) => Number.isFinite(n));
  const proxyFeesMin = feesOnly.length ? Math.min(...feesOnly) : null;

  return {
    applicable: true,
    proxyFeesMin,
    stores: available,
    headingEn: "You may not need a proxy at all",
    caveatEn:
      "Shipping availability and postage differ by store and by country. Check on the store's own site before ordering.",
  };
}
