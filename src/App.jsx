import { useMemo, useState } from "react";
import proxies from "../data/proxies.json";
import ems from "../data/shipping-ems.json";
import importTax from "../data/import-tax.json";
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

function ResultCard({ r, rank }) {
  const [open, setOpen] = useState(rank === 0);

  return (
    <article className={`card${rank === 0 ? " card-best" : ""}`}>
      <header className="card-head">
        <div>
          {rank === 0 && <span className="badge">Cheapest overall</span>}
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
          <span className="card-total-label">Final total</span>
          <strong>{yen(r.grandTotal)}</strong>
          {r.grandTotalIsMinimum && <span className="card-total-note">+ import duty</span>}
        </div>
      </header>

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

      <a className="cta" href={r.url} target="_blank" rel="noopener noreferrer sponsored">
        Go to {r.name} →
      </a>
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
};

export default function App() {
  // プリレンダしたページには window.__PAGE__.prefill が埋まっている。
  // そのページが説明している条件のまま計算機が開くようにする
  // （開いた瞬間に別条件へ戻ると、ページの本文と数字が食い違って読者が混乱する）。
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    ...(typeof window !== "undefined" ? window.__PAGE__?.prefill ?? {} : {}),
  }));

  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: ["itemPriceJpy", "itemCount", "weightG", "domesticShippingJpy"].includes(k) ? Number(v) : v }));
  };

  const { results, country, shipping } = useMemo(
    () => calculateAll(form, { proxies, ems, importTax }),
    [form]
  );

  const isShopping = !["yahoo_auction", "mercari", "rakuma"].includes(form.source);

  return (
    <div className="page">
      <header className="hero">
        <h1>What does a Japan proxy service actually cost?</h1>
        <p>
          Buyee, ZenMarket, Neokyo and FROM JAPAN all charge differently — per item, per order, by weight,
          or as a percentage. The cheapest one changes depending on what you buy. This works out the real
          landed total, including the import tax most comparisons leave out.
        </p>
      </header>

      <section className="form">
        <Field label="Where are you buying from?">
          <select value={form.source} onChange={set("source")}>
            {SOURCES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </Field>

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

      <section className="results">
        {results.map((r, i) => (
          <ResultCard key={r.proxyId} r={r} rank={i} />
        ))}
      </section>

      <footer className="foot">
        <p>
          Shipping shown is Japan Post EMS to zone {shipping.zone}, billed at the {shipping.appliedWeightG}g band.
          Fee data checked {proxies._meta.updated} against each provider's official pages.
        </p>
        <p className="disclaimer">
          Estimates only. Providers change their pricing, and customs authorities have the final say on
          duty and tax. Always confirm on the provider's own site before you buy.
        </p>
      </footer>
    </div>
  );
}
