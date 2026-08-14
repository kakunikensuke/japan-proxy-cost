import { useMemo, useState } from "react";
import proxies from "../data/proxies.json";
import ems from "../data/shipping-ems.json";
import importTax from "../data/import-tax.json";
import restrictions from "../data/restrictions.json";
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

const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Tier({ num, title, amount, unquantified, children }) {
  return (
    <div className="tier">
      <div className="tier-head">
        <span className="tier-num">{num}</span>
        <span className="tier-title">{title}</span>
        <span className="tier-amount">{unquantified ? "not estimated" : yen(amount)}</span>
      </div>
      {children}
    </div>
  );
}

const LEVEL_BADGE = {
  prohibited:      { text: "Cannot ship",        cls: "badge-blocked" },
  unknown:         { text: "No published rule",  cls: "badge-unknown" },
  conditional:     { text: "Extra conditions",   cls: "badge-conditional" },
  carrier_limited: { text: "Extra conditions",   cls: "badge-conditional" },
};

/** 送れない理由を、公式原文つきで出す。「なぜ」が無いと利用者は判断できない。 */
function Blockers({ shippable }) {
  if (!shippable.blockers.length) return null;
  return (
    <div className="blockers">
      {shippable.blockers.map((b, i) => (
        <div key={i} className="blocker">
          <p className="blocker-head">
            <strong>{b.attributeLabelEn}</strong>{" "}
            {b.axis === "destination" ? "— restricted by the destination country" : "— refused by this proxy"}
          </p>
          {b.reasonEn && <p className="blocker-reason">{b.reasonEn}</p>}
          {b.quoteEn && <blockquote className="blocker-quote">“{b.quoteEn}”</blockquote>}
          {b.sourceUrl && (
            <p className="blocker-src">
              <a href={b.sourceUrl} target="_blank" rel="noopener noreferrer">
                Official source
              </a>
              {b.verifiedAt ? ` · checked ${b.verifiedAt}` : ""}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ResultCard({ r, rank, isBest }) {
  const [open, setOpen] = useState(rank === 0);
  const blocked = r.shippable.level === "prohibited";
  const badge = LEVEL_BADGE[r.shippable.level];

  return (
    <article className={`card${isBest ? " card-best" : ""}${blocked ? " card-blocked" : ""}`}>
      <header className="card-head">
        <div>
          {isBest && <span className="badge">Cheapest that can actually ship</span>}
          {badge && <span className={`badge ${badge.cls}`}>{badge.text}</span>}
          <h3>{r.name}</h3>
          {r.includes.length > 0 && (
            <p className="includes">
              Includes:{" "}
              {r.includes
                .map((i) =>
                  ({
                    storage60d: "60-day storage",
                    consolidation: "consolidation",
                    inspection: "item inspection",
                    international_insurance: "shipping insurance",
                    domestic_trade_guarantee: "domestic purchase guarantee",
                  }[i] ?? i)
                )
                .join(" · ")}
            </p>
          )}
        </div>
        <div className="card-total">
          <span className="card-total-label">{blocked ? "Would have cost" : "Final total"}</span>
          <strong>{yen(r.grandTotal)}</strong>
          {blocked
            ? <span className="card-total-note">for reference only</span>
            : r.grandTotalIsMinimum && <span className="card-total-note">+ import duty</span>}
        </div>
      </header>

      <Blockers shippable={r.shippable} />

      <button className="toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide the breakdown" : "Show me where this money goes"}
      </button>

      {open && (
        <div className="breakdown">
          <Tier num="1" title={r.payNow.labelEn} amount={r.payNow.total}>
            <ul className="lines">
              {r.payNow.lines.map((l) => (
                <li key={l.key}>
                  <span>{l.labelEn}</span>
                  <span>{yen(l.amount)}</span>
                </li>
              ))}
            </ul>
          </Tier>

          <Tier
            num="2"
            title={r.payOnDelivery.labelEn}
            amount={r.payOnDelivery.total}
            unquantified={!r.payOnDelivery.quantified && r.payOnDelivery.lines.length === 0}
          >
            <ul className="lines">
              {r.payOnDelivery.lines.map((l) => (
                <li key={l.key}>
                  <span>{l.labelEn}</span>
                  <span>{yen(l.amount)}</span>
                </li>
              ))}
              {r.taxTiming === "prepaid" && r.payOnDelivery.lines.length === 0 && (
                <li className="line-good">
                  <span>Nothing — tax was already collected up front</span>
                  <span>{yen(0)}</span>
                </li>
              )}
            </ul>
            {r.payOnDelivery.notes.map((n, i) => (
              <p key={i} className="note">{n}</p>
            ))}
          </Tier>

          <Tier num="3" title="Final total" amount={r.grandTotal} />

          {r.warnings.length > 0 && (
            <div className="warnings">
              {r.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 送れないと分かっている会社へ送客しない。落札されたら損をするのは利用者。 */}
      {!blocked && (
        <a className="cta" href={r.url} target="_blank" rel="noopener noreferrer sponsored">
          Go to {r.name} →
        </a>
      )}
    </article>
  );
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

  // トップページ以外は、計算機の上にそのページの解説本文がある（#root の外）。
  const toolFirst = typeof window === "undefined" || (window.__PAGE__?.layout ?? "tool-first") === "tool-first";

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

  const { results, country, shipping, allBlocked, noneConfirmed } = useMemo(
    () => calculateAll(form, { proxies, ems, importTax, restrictions }),
    [form]
  );

  const isShopping = !["yahoo_auction", "mercari", "rakuma"].includes(form.source);

  // 「送れると公式に確認できている中で最安」だけをおすすめとして立てる。
  const bestIndex = results.findIndex((r) => r.shippable.level === "ok");

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

  return (
    <div className="page">
      {/* 解説ページでは本文が上にあり、そちらに固有の h1 がある。
          ここで毎回同じ h1 を出すと h1 が2つになり、どのページも同じ書き出しに見える。 */}
      {toolFirst ? (
        <header className="hero">
          <h1>What does a Japan proxy service actually cost?</h1>
          <p>
            Buyee, ZenMarket, Neokyo and FROM JAPAN all charge differently — per item, per order, by weight,
            or as a percentage. The cheapest one changes depending on what you buy. This works out the real
            landed total, including the import tax most comparisons leave out.
          </p>
        </header>
      ) : (
        <header className="hero hero-compact">
          <h2>Work out your own order</h2>
          <p>The figures above are for one example order. Change anything here and everything recalculates.</p>
        </header>
      )}

      <section className="form">
        <Field label="Where are you buying from?">
          <select value={form.source} onChange={set("source")}>
            {SOURCES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </Field>

        <Field
          label="What are you buying?"
          hint="Some things simply cannot leave Japan by post. We check this before showing you a price."
        >
          <select value={form.category} onChange={setCategory}>
            {restrictions.categoryPresets.map((c) => (
              <option key={c.id} value={c.id}>{c.labelEn}</option>
            ))}
          </select>
        </Field>

        {/* プリセットは目安でしかない。同じ「フィギュア」でもLED入りなら電池扱いになるので、
            利用者が自分で足せる逃げ道を必ず用意する。 */}
        <details className="attr-details">
          <summary>Does any of this apply? Tick anything that does</summary>
          <div className="attr-grid">
            {restrictions.attributes.map((a) => (
              <label key={a.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={form.attributes.includes(a.id)}
                  onChange={toggleAttribute(a.id)}
                />
                <span>
                  {a.labelEn}
                  <em> — {a.helpEn}</em>
                </span>
              </label>
            ))}
          </div>
        </details>

        <Field label="Item price (¥, total, tax included)">
          <input type="number" min="0" step="100" value={form.itemPriceJpy} onChange={set("itemPriceJpy")} />
        </Field>

        <Field label="How many separate items?" hint="Buying 3 of the identical item counts as 1.">
          <input type="number" min="1" step="1" value={form.itemCount} onChange={set("itemCount")} />
        </Field>

        {isShopping && form.itemCount > 1 && (
          <label className="checkbox">
            <input type="checkbox" checked={form.sameShop} onChange={set("sameShop")} />
            <span>All from the same shop <em>— this matters: Buyee charges per order, not per item</em></span>
          </label>
        )}

        <Field label="Weight once packed">
          <select value={form.weightG} onChange={set("weightG")}>
            {WEIGHT_PRESETS.map((w) => (
              <option key={w.g} value={w.g}>{w.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Ship to">
          <select value={form.destination} onChange={set("destination")}>
            {ems.targetCountries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field
          label="Domestic shipping inside Japan (¥)"
          hint="Seller to the proxy's warehouse. Usually ¥150–1,500 per order. Even “free shipping” items often incur this."
        >
          <input type="number" min="0" step="50" value={form.domesticShippingJpy} onChange={set("domesticShippingJpy")} />
        </Field>

        <Field label="Buyee protection plan" hint="Only affects Buyee. Light is free but has no cover.">
          <select value={form.buyeePlan} onChange={set("buyeePlan")}>
            {proxies.proxies.find((p) => p.id === "buyee").plans.map((p) => (
              <option key={p.id} value={p.id}>{p.nameEn ?? p.name} — {yen(p.fee)}</option>
            ))}
          </select>
        </Field>
      </section>

      {country?.displayEn && (
        <aside className={`notice notice-${country.displayEn.severity}`}>
          <strong>{country.displayEn.headline}</strong>
          <p>{country.displayEn.body}</p>
        </aside>
      )}

      {shipping.error && <aside className="notice notice-high"><p>{shipping.error}</p></aside>}

      {/* 買えないと分かった瞬間が、利用者が代替を最も探している場面。
          ここで黙って価格表だけ出すのは不親切なので、理由と次の一手を先に出す。 */}
      {!cannotPrice && (allBlocked || noneConfirmed) && (
        <aside className="notice notice-high blocked-banner">
          <strong>
            {allBlocked
              ? "None of these services can ship this item"
              : "No service confirms in writing that it can ship this"}
          </strong>
          <p>
            {allBlocked
              ? "Every provider below refuses it. The prices are shown only so you can see what it would have cost — do not buy expecting it to arrive."
              : "At least one provider has no published rule for this, so it may be accepted at checkout and then refused at the warehouse. You would still be charged for the item and the domestic shipping."}
          </p>
          {flaggedAttributes.map((a) => (
            <p key={a.id} className="blocked-alt">
              <strong>{a.labelEn}:</strong> {adviceFor(a)}
            </p>
          ))}
        </aside>
      )}

      {!cannotPrice && (
        <section className="results">
          {results.map((r, i) => (
            <ResultCard key={r.proxyId} r={r} rank={i} isBest={i === bestIndex} />
          ))}
        </section>
      )}

      <footer className="foot">
        {!cannotPrice && (
          <p>
            Shipping shown is Japan Post EMS to zone {shipping.zone}, billed at the {shipping.appliedWeightG}g band.
            Fee data checked {proxies._meta.updated} against each provider's official pages.
          </p>
        )}
        <p className="disclaimer">
          Estimates only. Providers change their pricing, and customs authorities have the final say on
          duty and tax. Always confirm on the provider's own site before you buy.
        </p>
        {/* 運営者・算出方法・プライバシー・連絡先への導線は、プリレンダ側の
            共通フッター（#root の外）が全ページに出す。ここでは重複させない。 */}
      </footer>
    </div>
  );
}
