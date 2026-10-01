import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import proxies from "../data/proxies.json";
import ems from "../data/shipping-ems.json";
import importTax from "../data/import-tax.json";
import restrictions from "../data/restrictions.json";
import stores from "../data/stores.json";
import { calculateAll } from "./lib/calc.mjs";

const SOURCES = [
  { key: "yahoo_auction", label: "Yahoo! Auctions (JDirectItems)" },
  { key: "mercari", label: "Mercari Japan" },
  { key: "rakuma", label: "Rakuten Rakuma" },
  { key: "amazon_jp", label: "Amazon.co.jp" },
  { key: "rakuten", label: "Rakuten Ichiba" },
  { key: "recommended", label: "Recommended store (ZenMarket discount tier)" },
  { key: "other_shop", label: "Any other Japanese shop" },
];

// オタク系の実重量の目安。利用者は商品重量を知らないので選ばせる。
const WEIGHT_PRESETS = [
  { g: 60, label: "Trading cards / doujinshi (~60g)" },
  { g: 200, label: "Manga volume (~200g)" },
  { g: 400, label: "Prize figure (~400g)" },
  { g: 800, label: "Model kit (~800g)" },
  { g: 1000, label: "Scale figure, boxed (~1kg)" },
  { g: 2000, label: "Large boxed item (~2kg)" },
  { g: 3000, label: "Heavy / multiple items (~3kg)" },
];

// 内訳の色は「誰に払うお金か」で分ける（styles.css の .k-* と対応）
const LINE_LEGEND = {
  item: "Item",
  service: "Service fee",
  plan: "Protection plan",
  packing: "Packing",
  clearance: "Export clearance",
  payment: "Payment fee",
  domestic: "Postage in Japan",
  intl: "International postage",
  tax: "Import tax",
};
const legendKey = (k) => (k === "import_tax" ? "tax" : k);

const INCLUDE_LABELS = {
  storage60d: "60-day storage",
  consolidation: "consolidation",
  inspection: "item inspection",
  international_insurance: "shipping insurance",
  domestic_trade_guarantee: "domestic purchase guarantee",
};

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function Field({ label, hint, className = "", children }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

const LEVEL_TAG = {
  prohibited: { text: "Cannot ship this", cls: "tag-blocked" },
  unknown: { text: "No published rule for this item", cls: "tag-unknown" },
  conditional: { text: "Ships with extra conditions", cls: "tag-conditional" },
  carrier_limited: { text: "Ships with extra conditions", cls: "tag-conditional" },
};

/** 送れない理由を、公式原文つきで出す。「なぜ」が無いと利用者は判断できない。 */
function Blockers({ shippable }) {
  if (!shippable.blockers.length) return null;
  return (
    <div className="blockers">
      {shippable.blockers.map((b, i) => (
        <div key={i} className="blocker">
          <p>
            <strong>{b.attributeLabelEn}</strong>{" "}
            {b.axis === "destination" ? "is restricted by the destination country" : "is refused by this service"}
          </p>
          {b.reasonEn && <p>{b.reasonEn}</p>}
          {b.quoteEn && <p className="blocker-quote">“{b.quoteEn}”</p>}
          {b.sourceUrl && (
            <p className="blocker-src">
              <a href={b.sourceUrl} target="_blank" rel="noopener noreferrer">Official source</a>
              {b.verifiedAt ? `, checked ${b.verifiedAt}` : ""}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CostBar({ r, max }) {
  const lines = [...r.payNow.lines, ...r.payOnDelivery.lines].filter((l) => l.amount > 0);
  return (
    <div
      className="bar"
      role="img"
      aria-label={lines.map((l) => `${LINE_LEGEND[legendKey(l.key)] ?? l.labelEn} ${yen(l.amount)}`).join(", ")}
    >
      {lines.map((l) => (
        <span key={l.key} className={`k-${l.key}`} style={{ width: `${(l.amount / max) * 100}%` }} />
      ))}
    </div>
  );
}

function timingNote(r) {
  if (r.taxTiming === "prepaid") return "Collects your import tax at checkout, nothing due on arrival";
  if (r.payOnDelivery.lines.some((l) => l.key === "import_tax" && l.amount > 0)) return "Import tax paid to the courier on arrival";
  if (!r.payOnDelivery.quantified) return "Duty on arrival depends on the item, so it is not estimated";
  return "Nothing to pay on arrival";
}

function ResultRow({ r, isBest, best, max }) {
  const [open, setOpen] = useState(false);
  const blocked = r.shippable.level === "prohibited";
  const tag = LEVEL_TAG[r.shippable.level];
  const later = r.payOnDelivery.total;

  return (
    <article className={`row${isBest ? " row-best" : ""}${blocked ? " row-blocked" : ""}`}>
      <div className="row-main">
        <div className="row-name">
          <b>{r.name}</b>
          {isBest && <span className="tag">Cheapest that can ship this</span>}
          {tag && <span className={`tag ${tag.cls}`}>{tag.text}</span>}
          {!isBest && !tag && best && (
            <span className="row-meta">
              {r.grandTotal === best.grandTotal ? "Same total" : `${yen(r.grandTotal - best.grandTotal)} more`}
            </span>
          )}
        </div>
        <div className="row-bar">
          <CostBar r={r} max={max} />
          <span className="row-meta">{timingNote(r)}</span>
          <button className="row-toggle" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide the lines" : "Show every line"}
          </button>
        </div>
        <div className="row-total">
          <b>{yen(r.grandTotal)}</b>
          <small>
            {blocked
              ? "for reference only"
              : r.grandTotalIsMinimum
                ? "+ import duty, not estimated"
                : later > 0
                  ? `${yen(r.payNow.total)} now, ${yen(later)} on arrival`
                  : "all paid at checkout"}
          </small>
        </div>
        {/* 送れないと分かっている会社へ送客しない。落札されたら損をするのは利用者。 */}
        {!blocked ? (
          <a className="row-go" href={r.url} target="_blank" rel="noopener noreferrer sponsored">
            Go to {r.name}
          </a>
        ) : (
          <span />
        )}
      </div>

      <Blockers shippable={r.shippable} />

      {open && (
        <div className="breakdown">
          <div className="tier">
            <h4><span>{r.payNow.labelEn}</span><span>{yen(r.payNow.total)}</span></h4>
            <ul className="lines">
              {r.payNow.lines.map((l) => (
                <li key={l.key}>
                  <span><i className={`k-${l.key}`} />{l.labelEn}</span>
                  <span>{yen(l.amount)}</span>
                </li>
              ))}
            </ul>
            {r.includes.length > 0 && (
              <p className="note">Included: {r.includes.map((i) => INCLUDE_LABELS[i] ?? i).join(", ")}.</p>
            )}
          </div>
          <div className="tier">
            <h4>
              <span>{r.payOnDelivery.labelEn}</span>
              <span>
                {!r.payOnDelivery.quantified && r.payOnDelivery.lines.length === 0 ? "not estimated" : yen(r.payOnDelivery.total)}
              </span>
            </h4>
            <ul className="lines">
              {r.payOnDelivery.lines.map((l) => (
                <li key={l.key}>
                  <span><i className={`k-${l.key}`} />{l.labelEn}</span>
                  <span>{yen(l.amount)}</span>
                </li>
              ))}
              {r.taxTiming === "prepaid" && r.payOnDelivery.lines.length === 0 && (
                <li className="line-good"><span>Nothing: tax was already collected up front</span><span>{yen(0)}</span></li>
              )}
            </ul>
            {r.payOnDelivery.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
          </div>
          {r.warnings.length > 0 && (
            <div className="warnings">
              {r.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** 結果の上に置く1文の結論。「最安はどこで、2番手とはいくら・何の差か」を実数で言う。 */
function summarize(results, bestIndex) {
  if (bestIndex < 0) return null;
  const best = results[bestIndex];
  const okOnes = results.filter((r) => r.shippable.level === "ok");
  const ties = okOnes.filter((r) => r.grandTotal === best.grandTotal);
  const dearest = okOnes[okOnes.length - 1];
  const head = ties.length > 1
    ? `${ties.map((r) => r.name).join(" and ")} tie at ${yen(best.grandTotal)}.`
    : `${best.name} is cheapest at ${yen(best.grandTotal)}.`;
  if (!dearest || dearest.grandTotal === best.grandTotal) return { head, tail: "" };

  // 最安と最高値の差がどの費目から出ているか
  const amountOf = (r, k) => [...r.payNow.lines, ...r.payOnDelivery.lines].filter((l) => legendKey(l.key) === k).reduce((s, l) => s + l.amount, 0);
  const diffs = Object.keys(LINE_LEGEND)
    .map((k) => ({ k, d: amountOf(dearest, k) - amountOf(best, k) }))
    .filter((x) => x.d > 0)
    .sort((a, b) => b.d - a.d);
  const why = diffs[0] ? `, mostly its ${lcFirst(LINE_LEGEND[diffs[0].k])}` : "";
  return { head, tail: ` ${dearest.name} costs ${yen(dearest.grandTotal - best.grandTotal)} more${why}.` };
}

const DEFAULT_FORM = {
  source: "mercari",
  itemPriceJpy: 8000,
  itemCount: 1,
  sameShop: false,
  weightG: 1000,
  destination: "US",
  domesticShippingJpy: 700,
  buyeePlan: "light",
  category: "scale_figure",
  attributes: [],
};

export default function App() {
  // プリレンダしたページには window.__PAGE__.prefill が埋まっている。
  // そのページが説明している条件のまま計算機が開くようにする
  // （開いた瞬間に別条件へ戻ると、ページの本文と数字が食い違って読者が混乱する）。
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    ...(typeof window !== "undefined" ? window.__PAGE__?.prefill ?? {} : {}),
  }));

  // トップページでは、結果を写真の見出し帯の下（#calc-results）に出す。
  // 本文は #root の外にあり React は触らないので、ポータルで別の場所へ描く。
  const portalTarget = typeof document !== "undefined" ? document.getElementById("calc-results") : null;

  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: ["itemPriceJpy", "itemCount", "weightG", "domesticShippingJpy"].includes(k) ? Number(v) : v }));
  };

  // カテゴリを選ぶと属性が入れ替わる。プリセットで拾えないケースは
  // 下のチェックボックスで足せるようにしてあるので、上書きではなく置き換えにする。
  const setCategory = (e) => {
    const id = e.target.value;
    const preset = restrictions.categoryPresets.find((c) => c.id === id);
    setForm((f) => ({ ...f, category: id, attributes: [...(preset?.attributes ?? [])] }));
  };

  const toggleAttribute = (id) => (e) => {
    const on = e.target.checked;
    setForm((f) => ({
      ...f,
      attributes: on ? [...new Set([...f.attributes, id])] : f.attributes.filter((a) => a !== id),
    }));
  };

  const { results, country, shipping, allBlocked, noneConfirmed, storeSuggestion } = useMemo(
    () => calculateAll(form, { proxies, ems, importTax, restrictions, stores }),
    [form]
  );

  const isShopping = !["yahoo_auction", "mercari", "rakuma"].includes(form.source);

  // 「送れると公式に確認できている中で最安」だけをおすすめとして立てる。
  const bestIndex = results.findIndex((r) => r.shippable.level === "ok");
  const best = bestIndex >= 0 ? results[bestIndex] : null;
  const max = Math.max(...results.map((r) => r.grandTotal), 1);
  const summary = summarize(results, bestIndex);

  // 何らかの引っかかりがある属性。全社不可のときと「誰も明言していないだけ」のときでは
  // 書くべきことが違うので、文言を出し分ける（同じ文を使い回すと表と矛盾する）。
  const flaggedAttributes = restrictions.attributes.filter((a) =>
    form.attributes.includes(a.id) &&
    results.some((r) => r.shippable.blockers.some((b) => b.attribute === a.id))
  );
  const adviceFor = (a) => (allBlocked ? a.whenBlockedEn : a.whenUnconfirmedEn ?? a.whenBlockedEn);

  // 国際送料が引けないときは総額が「送料抜き」になってしまう。
  // 未確認を黙って0円扱いにしないという原則どおり、価格表そのものを出さない。
  const cannotPrice = Boolean(shipping.error);

  const usedKeys = [...new Set(results.flatMap((r) => [...r.payNow.lines, ...r.payOnDelivery.lines].filter((l) => l.amount > 0).map((l) => legendKey(l.key))))];

  const form_ = (
    <form className="calc" aria-label="Your order" onSubmit={(e) => e.preventDefault()}>
      <h2 className="calc-title">Your order</h2>
      <div className="form-grid">
        <Field label="Buying from">
          <select value={form.source} onChange={set("source")}>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>

        <Field label="Ship to">
          <select value={form.destination} onChange={set("destination")}>
            {ems.targetCountries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>

        <Field label="Item price (¥)" hint="Total on the listing, tax included">
          <input type="number" inputMode="numeric" min="0" step="100" value={form.itemPriceJpy} onChange={set("itemPriceJpy")} />
        </Field>

        <Field label="Weight once packed">
          <select value={form.weightG} onChange={set("weightG")}>
            {WEIGHT_PRESETS.map((w) => <option key={w.g} value={w.g}>{w.label}</option>)}
          </select>
        </Field>

        <Field label="Separate items" hint="Three of the same listing counts as one">
          <input type="number" inputMode="numeric" min="1" step="1" value={form.itemCount} onChange={set("itemCount")} />
        </Field>

        <Field label="Postage inside Japan (¥)" hint="Seller to the warehouse. Usually ¥150–1,500">
          <input type="number" inputMode="numeric" min="0" step="50" value={form.domesticShippingJpy} onChange={set("domesticShippingJpy")} />
        </Field>

        {isShopping && form.itemCount > 1 && (
          <label className="checkbox span-2">
            <input type="checkbox" checked={form.sameShop} onChange={set("sameShop")} />
            <span>All from the same shop <em>(Buyee charges per order, not per item)</em></span>
          </label>
        )}

        <Field label="What are you buying?" className="span-2" hint="Some things cannot leave Japan by post. This is checked before any price is shown.">
          <select value={form.category} onChange={setCategory}>
            {restrictions.categoryPresets.map((c) => <option key={c.id} value={c.id}>{c.labelEn}</option>)}
          </select>
        </Field>

        {/* プリセットは目安でしかない。同じ「フィギュア」でもLED入りなら電池扱いになるので、
            利用者が自分で足せる逃げ道を必ず用意する。 */}
        <details className="attr-details">
          <summary>Batteries, paint, blades or food inside? Tick what applies</summary>
          <div className="attr-grid">
            {restrictions.attributes.map((a) => (
              <label key={a.id} className="checkbox">
                <input type="checkbox" checked={form.attributes.includes(a.id)} onChange={toggleAttribute(a.id)} />
                <span>{a.labelEn} <em>({a.helpEn})</em></span>
              </label>
            ))}
          </div>
        </details>

        <Field label="Buyee protection plan" className="span-2" hint="Only affects Buyee. Light is free but has no cover.">
          <select value={form.buyeePlan} onChange={set("buyeePlan")}>
            {proxies.proxies.find((p) => p.id === "buyee").plans.map((p) => (
              <option key={p.id} value={p.id}>{p.nameEn ?? p.name}: {yen(p.fee)}</option>
            ))}
          </select>
        </Field>
      </div>
    </form>
  );

  const resultsBlock = (
    <section className="results-wrap" aria-live="polite">
      <div className="results-head">
        <h2>Your order, four ways</h2>
        {!cannotPrice && summary && (
          <p className="results-sum"><strong>{summary.head}</strong>{summary.tail}</p>
        )}
      </div>

      {country?.displayEn && (
        <aside className={`notice${country.displayEn.severity === "high" ? " notice-high" : ""}`}>
          <strong>{country.displayEn.headline}</strong>
          <p>{country.displayEn.body}</p>
        </aside>
      )}

      {shipping.error && <aside className="notice notice-high"><p>{shipping.error}</p></aside>}

      {/* 買えないと分かった瞬間が、利用者が代替を最も探している場面。
          ここで黙って価格表だけ出すのは不親切なので、理由と次の一手を先に出す。 */}
      {!cannotPrice && (allBlocked || noneConfirmed) && (
        <aside className="notice notice-high">
          <strong>
            {allBlocked ? "None of these services can ship this item" : "No service confirms in writing that it can ship this"}
          </strong>
          <p>
            {allBlocked
              ? "Every provider below refuses it. The prices are shown only so you can see what it would have cost. Do not buy expecting it to arrive."
              : "At least one provider has no published rule for this, so it may be accepted at checkout and then refused at the warehouse. You would still be charged for the item and the domestic shipping."}
          </p>
          {flaggedAttributes.map((a) => (
            <p key={a.id}><strong>{a.labelEn}:</strong> {adviceFor(a)}</p>
          ))}
        </aside>
      )}

      {!cannotPrice && (
        <>
          <div className="rows">
            {results.map((r, i) => (
              <ResultRow key={r.proxyId} r={r} isBest={i === bestIndex} best={best} max={max} />
            ))}
          </div>
          <div className="rows-foot">
            <ul className="legend">
              {usedKeys.map((k) => <li key={k}><i className={`k-${k}`} />{LINE_LEGEND[k] ?? k}</li>)}
            </ul>
          </div>
        </>
      )}

      {/* 代行の比較結果の“後”に置く。比較の順位には一切混ぜず、
          「そもそも代行を使わない道」を別枠で示す。
          直販側の商品価格も送料もこちらは持っていないので「直販が安い」とは言わない。
          言えるのは自分で計算した「代行なら最低いくら手数料がかかるか」だけ。 */}
      {!cannotPrice && storeSuggestion?.applicable && (
        <aside className="stores">
          <h2>{storeSuggestion.headingEn}</h2>
          {storeSuggestion.proxyFeesMin != null && (
            <p>
              Using a proxy adds at least <strong>{yen(storeSuggestion.proxyFeesMin)}</strong> on top of the item price.
              If what you want is new and in stock, the shops below sell direct from Japan and ship overseas themselves,
              so those fees disappear entirely.
            </p>
          )}
          {storeSuggestion.stores.map((s) => (
            <a key={s.id} className="store-link" href={s.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored">
              {s.name}: {s.sellsEn}
            </a>
          ))}
          <p className="note">{storeSuggestion.caveatEn}</p>
        </aside>
      )}

      <div className="calc-foot">
        {!cannotPrice && (
          <p>
            Shipping shown is Japan Post EMS to zone {shipping.zone}, billed at the {shipping.appliedWeightG}g band.
            Fee data checked {proxies._meta.updated} against each provider's official pages.
          </p>
        )}
        <p>
          Estimates only. Providers change their pricing, and customs authorities have the final say on duty and tax.
          Always confirm on the provider's own site before you buy.
        </p>
      </div>
    </section>
  );

  return (
    <>
      {form_}
      {portalTarget ? createPortal(resultsBlock, portalTarget) : resultsBlock}
    </>
  );
}
