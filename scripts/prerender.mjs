/**
 * ビルド後に静的HTMLを生成する（postbuild で自動実行）。
 *
 * ■ なぜ必要か
 * CSR の SPA はどのURLでも同じHTMLを返すため、生成したページが検索エンジンから
 * 「存在しない」のと同じになる。JSを実行しないクローラは内部リンクも辿れない。
 *
 * ■ Cloudflare Workers の罠（ロッカーアプリで踏んだもの）
 * `dist/foo/index.html` に置くと /foo が /foo/ へ307リダイレクトされ、canonical と食い違う。
 * **必ず `dist/foo.html` に置く。** そうすればリダイレクトなしで200が返る。
 * 検証は `vite preview` ではなく `wrangler dev` で行うこと（前者はSPAフォールバックが優先される）。
 */
import fs from "node:fs";
import path from "node:path";
import proxies from "../data/proxies.json" with { type: "json" };
import ems from "../data/shipping-ems.json" with { type: "json" };
import importTax from "../data/import-tax.json" with { type: "json" };
import restrictions from "../data/restrictions.json" with { type: "json" };
import stores from "../data/stores.json" with { type: "json" };
import post from "../data/shipping-post.json" with { type: "json" };
import fx from "../data/fx.json" with { type: "json" };
import { buildPages, CONTACT_FORM_ENDPOINT } from "../src/lib/pages.mjs";
import { calculateAll } from "../src/lib/calc.mjs";
import { sectionOf, siteHeader, siteFooter, photoImg, photoCredit, photoPreload, splitArticle, breadcrumbs, breadcrumbJsonLd } from "../src/lib/layout.mjs";
import { NW, NWC, NW_OTHERS, N_PROXIES, PROXY_TITLE_LIST, PROXY_TITLE_AMP, numberWord, feeText, feeBounds } from "../src/lib/words.mjs";

const SITE_URL = (process.env.VITE_SITE_URL ?? "https://japanproxy.kakuni-lab.com").replace(/\/$/, "");
const DIST = path.join(import.meta.dirname, "..", "dist");
const TEMPLATE_PATH = path.join(DIST, "index.html");

if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error("dist/index.html がありません。先に `npm run build` を実行してください。");
  process.exit(1);
}
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, "utf-8");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * layout の意味:
 *   tool-first    … 写真の見出し帯の中に計算機（トップページ）
 *   content-first … 本文が先、計算機が後（比較・重量・輸入税などの解説ページ）
 *   content-only  … 計算機を出さない（運営者情報・プライバシー・問い合わせ・ガイド等）
 *
 * ★本文は #root の外に置き、React に触らせないこと。以前は本文を #root の中に入れていたため、
 *   React が createRoot で #root を描き直した瞬間に本文が消え、**どのURLを開いても計算機しか
 *   出ない**状態だった。クローラには本文が見え、人間には見えないという最悪の形で、
 *   AdSense に「有用性の低いコンテンツ」と判定された直接の原因である。
 *   外枠（ヘッダー・パンくず・目次・フッター）も同じ理由で静的HTMLに置く（src/lib/layout.mjs）。
 */
function renderPage({ title, description, canonicalPath, body, prefill, layout = "content-first", noindex = false, jsonLd = null }) {
  let html = TEMPLATE;
  const section = sectionOf(canonicalPath);
  const parts = splitArticle(body);

  // テンプレート既定の title / description を消してページ固有のものに差し替える
  html = html.replace(/\s*<title>[\s\S]*?<\/title>/, "");
  html = html.replace(/\s*<meta\s+name="description"[\s\S]*?\/?>/, "");

  const head = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${SITE_URL}${canonicalPath}" />
    <meta property="og:image" content="${SITE_URL}/img/${section.photo}-1600.webp" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="${SITE_URL}${canonicalPath}" />
    ${noindex ? '<meta name="robots" content="noindex,follow" />' : ""}
    ${photoPreload(section.photo)}
    ${canonicalPath !== "/" ? `<script type="application/ld+json">${breadcrumbJsonLd(SITE_URL, section, parts.h1, canonicalPath)}</script>` : ""}
    ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ""}
    <script>window.__PAGE__=${JSON.stringify({ prefill: prefill ?? null, layout }).replace(/</g, "\\u003c")};</script>
  </head>`;
  html = html.replace("</head>", head);

  let main;
  if (layout === "tool-first") {
    // トップ: 写真の見出し帯の左に見出し、右に計算機。結果は帯の下へ React のポータルで出す。
    main = `
  <section class="band band-home">
    ${photoImg(section.photo, { eager: true })}<div class="band-shade"></div>
    <div class="wrap home-grid">
      <div class="home-intro">
        <h1>${parts.h1}</h1>
        ${parts.dek ? `<p class="lede">${parts.dek}</p>` : ""}
        ${HOME_FACTS}
      </div>
      <div class="home-calc" id="calculator"><div id="root"></div></div>
    </div>
    ${photoCredit(section.photo)}
  </section>
  <div class="wrap"><div id="calc-results"></div></div>
  <div class="wrap article-layout no-toc"><article class="page-content prose">${parts.body}</article></div>`;
  } else {
    const showToc = parts.toc.length >= 3;
    const toc = showToc ? `<aside class="toc"><nav aria-label="On this page"><p>On this page</p><ol>${
      parts.toc.map((t) => `<li><a href="#${t.id}">${esc(t.label)}</a></li>`).join("")}</ol></nav></aside>` : "";
    const calc = layout === "content-only" ? "" : `
  <section class="calc-section" id="calculator"><div class="wrap">
    <h2>Work out your own order</h2>
    <p>The figures above are for one example order. Change anything here and every total recalculates.</p>
    <div id="root"></div>
  </div></section>`;
    main = `
  <section class="band">
    ${photoImg(section.photo, { eager: true })}<div class="band-shade"></div>
    <div class="wrap band-inner">
      ${breadcrumbs(section, parts.h1)}
      <h1>${parts.h1}</h1>
      ${parts.dek ? `<p class="dek">${parts.dek}</p>` : ""}
    </div>
    ${photoCredit(section.photo)}
  </section>
  <div class="wrap article-layout${showToc ? "" : " no-toc"}">${toc}<article class="page-content prose">${parts.body}</article></div>${calc}`;
  }

  html = html.replace('<div id="root"></div>', `${siteHeader(section.key)}<main id="main">${main}</main>${siteFooter()}`);
  return html;
}

function writePage(routePath, html) {
  // ★ foo/index.html ではなく foo.html に置く（307リダイレクト回避）
  const outPath = routePath === "/"
    ? path.join(DIST, "index.html")
    : path.join(DIST, `${routePath.replace(/^\//, "")}.html`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
}

const pages = buildPages({ proxies, ems, importTax, restrictions, stores, post, fx });

// ---- トップページ: 全ページへの入口を持たせる ----
const grouped = {
  // 「そもそも送れるのか」を最上部に置く。金額より先に知る必要がある情報なので。
  "Guides and overviews": pages.filter((p) => p.path.startsWith("/guides") || ["/compare", "/import-tax"].includes(p.path)),
  "Can you even ship it?": pages.filter((p) => p.path.startsWith("/can-you-ship-") || p.path === "/what-you-cannot-ship-from-japan"),
  "Compare two services": pages.filter((p) => p.path.includes("-vs-")),
  "Cheapest proxy by marketplace": pages.filter((p) => p.path.startsWith("/cheapest-proxy-")),
  "Shipping cost by item": pages.filter((p) => p.path.startsWith("/ship-")),
  "Fees by service": pages.filter((p) => p.path.endsWith("-fees")),
  "Import tax by country": pages.filter((p) => p.path.startsWith("/import-tax-")),
  "About this site": pages.filter((p) => ["/about", "/how-we-calculate", "/privacy-policy", "/contact", "/contact-received"].includes(p.path)),
};

// トップページは以前、248本のリンクを並べただけのリンク集だった。
// 審査で最初に見られるページがそれでは「有用性の低いコンテンツ」と判定される（実際に落ちた）。
// 全ページへの一覧は /all-pages に移し、トップは実データで説明する読み物にする。
const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
const sample = { source: "mercari", itemPriceJpy: 10000, itemCount: 1, weightG: 1000, destination: "US", domesticShippingJpy: 700, buyeePlan: "light" };
const sampleRun = calculateAll(sample, { proxies, ems, importTax, restrictions, stores, post });
const heavyRun = calculateAll({ ...sample, weightG: 3000 }, { proxies, ems, importTax, restrictions, stores, post });

const unitOf = (p) => {
  if (p.packingFee?.type === "weight") return "per item, plus packing charged by weight";
  if (p.paymentFee?.type === "rate") return `per item, plus ${(p.paymentFee.rate * 100).toFixed(1)}% of the whole transaction`;
  if (p.serviceFee.unit === "order") return "per order (several items from one shop cost the same as one)";
  return "per item";
};

const feeStructureRows = proxies.proxies.map((p) => {
  // 料率型（Doorzo）は「3% (¥200–¥300)」と書く。固定額を前提に読むと ¥NaN になる
  const rateFee = Object.values(p.serviceFee.bySource).find((v) => typeof v === "object" && v.type === "rate");
  const amounts = [...new Set(Object.values(p.serviceFee.bySource).flatMap(feeBounds))].sort((a, b) => a - b);
  const range = rateFee ? feeText(rateFee) : amounts.length > 1 ? `${yen(amounts[0])}–${yen(amounts[amounts.length - 1])}` : yen(amounts[0]);
  return `<tr><td>${esc(p.shortName ?? p.name)}</td><td>${range}</td><td>${esc(unitOf(p))}</td></tr>`;
}).join("");

const sampleRows = sampleRun.results.map((r, i) => `
      <tr${i === 0 ? ' class="best"' : ""}>
        <td>${i + 1}</td><td>${esc(r.name)}</td>
        <td>${yen(r.payNow.total)}</td>
        <td>${r.payOnDelivery.quantified ? yen(r.payOnDelivery.total) : "not estimated"}</td>
        <td><strong>${yen(r.grandTotal)}</strong>${r.grandTotalIsMinimum ? " +duty" : ""}</td>
      </tr>`).join("");

const light = sampleRun.results[0];
const heavy = heavyRun.results[0];
const flips = light.proxyId !== heavy.proxyId;

// 見出し帯に並べる3つの数字。どれもデータから数える（手で書くと更新が漏れる）。
const HOME_FACTS = `<ul class="facts">
  <li><b>${proxies.proxies.length}</b> proxy services</li>
  <li><b>${Object.keys(importTax.countries).length}</b> destination countries</li>
  <li><b>${esc(new Date(proxies._meta.updated + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }))}</b> fees last checked</li>
</ul>`;

const homeBody = `
  <h1>See what buying from Japan really costs</h1>
  <p>${NWC} proxy services priced to the yen: service fees, packing, postage inside Japan, EMS, and the import tax
  your country adds when the parcel lands.</p>
  <h2>What a proxy actually charges you for</h2>
  <p>A proxy service buys something in Japan on your behalf and forwards it to you. Every one of them
  advertises a service fee of a few hundred yen, and every one of them ends up charging you several times
  that. The fee is not where the money goes.</p>
  <p>This site runs the whole calculation — the item, the service fee, packing, domestic postage inside Japan,
  international postage by weight band, deposit and payment fees, and the import tax your own country charges
  when the parcel lands — for ${esc(proxies.proxies.map((p) => p.shortName ?? p.name).join(", "))}, across
  ${Object.keys(importTax.countries).length} destination countries.</p>

  <h2>Why no single service is &ldquo;the cheapest&rdquo;</h2>
  <p>They do not charge on the same unit, so the ranking is not a fixed list — it is a function of your order.</p>
  <table>
    <thead><tr><th>Service</th><th>Service fee</th><th>Charged</th></tr></thead>
    <tbody>${feeStructureRows}</tbody>
  </table>
  <p>Buying three different items from one shop costs one fee at a service that charges per order and three at
  a service that charges per item. A percentage-based deposit fee is invisible on a ¥3,000 order and the largest
  single line on a ¥100,000 one. Packing charged by weight does not matter for a paperback and matters a great
  deal for a boxed figure.</p>

  <h2>A worked example</h2>
  <p>A ¥10,000 item from Mercari Japan, about 1&nbsp;kg once packed, sent to the United States by EMS, with
  ¥700 of domestic postage inside Japan:</p>
  <table>
    <thead><tr><th>#</th><th>Service</th><th>Pay the proxy</th><th>Pay on delivery</th><th>Total</th></tr></thead>
    <tbody>${sampleRows}</tbody>
  </table>
  <p>${esc(light.name)} wins that order at ${yen(light.grandTotal)}. Take the identical order and make the
  parcel 3&nbsp;kg instead of 1&nbsp;kg and ${flips
    ? `the answer changes: ${esc(heavy.name)} becomes cheapest at ${yen(heavy.grandTotal)}`
    : `${esc(heavy.name)} still wins, at ${yen(heavy.grandTotal)} — but the gap to the others has moved`}.
  That is the whole reason this site exists: the answer depends on the order, so it has to be calculated rather
  than looked up.</p>

  <h2>Before price: can it even leave Japan?</h2>
  <p>Model paint, spray cans, lighters, airsoft, blades and anything with a loose lithium battery are refused
  by some or all of these companies, and some are refused by Japan Post regardless of which company you use.
  The refusal happens at the warehouse, <em>after</em> you have paid for the item and its domestic postage —
  none of which comes back. So shippability is checked before a price is shown, and a service that will not
  export your item is never presented as the cheapest option.
  See <a href="/what-you-cannot-ship-from-japan">what you cannot ship out of Japan</a>.</p>

  <h2>Import tax is your country's rule, not the proxy's</h2>
  <p>All a proxy decides is whether it collects the tax at checkout or leaves you to pay the courier at the
  door. Fold that into a single number and the companies that collect honestly up front look expensive, so
  every total here is split into what you pay now and what you pay on arrival.
  ${importTax.countries.US ? "The United States suspended its $800 duty-free threshold in 2025 and the EU abolished its €150 threshold in July 2026, so low-value parcels that used to arrive untaxed no longer do." : ""}</p>

  <h2>Start here</h2>
  <ul>
    <li><a href="/what-you-cannot-ship-from-japan">What you cannot ship out of Japan</a> — read before you bid</li>
    <li><a href="/cheapest-proxy-from-japan-to-united-states">Cheapest proxy to the United States, by marketplace</a></li>
    <li><a href="/what-you-cannot-ship-from-japan">What you cannot ship out of Japan</a></li>
    ${proxies.proxies.map((p) => `<li><a href="/${p.id}-fees">${esc(p.shortName ?? p.name)} fees explained</a></li>`).join("")}
    <li><a href="/how-we-calculate">How these numbers are worked out</a> — sources, method, and what is deliberately left out</li>
    <li><a href="/all-pages">Every page on this site</a></li>
  </ul>
  <p><small>Fee data checked ${esc(proxies._meta.updated)} against each provider's official pages.
  Estimates only — see <a href="/how-we-calculate">how we calculate</a>.</small></p>`;

writePage("/", renderPage({
  title: `Japan Proxy Cost Calculator — compare ${PROXY_TITLE_AMP}`,
  description: "Work out what a Japanese proxy service actually costs. Service fees, packing, deposit fees, EMS postage and import tax, compared side by side.",
  canonicalPath: "/",
  body: homeBody,
  prefill: sample,
  layout: "tool-first",
}));

// ---- 全ページ一覧（HTMLサイトマップ） ----
// トップから追い出したリンク集の行き先。クロール経路は維持しつつ、
// トップページ自体は読み物として成立させる。
const allPagesBody = `
  <h1>Every page on this site</h1>
  <p>Each page below carries its own calculation — the figures on it are worked out for that specific
  marketplace, weight, destination or item category, not copied between pages. If you would rather put in your
  own numbers, the calculator is on <a href="/">the front page</a>.</p>
  ${Object.entries(grouped).map(([heading, list]) => `
  <section>
    <h2>${esc(heading)} <small>(${list.length})</small></h2>
    <ul>${list.map((p) => `<li><a href="${p.path}">${esc(p.title)}</a></li>`).join("")}</ul>
  </section>`).join("")}`;

writePage("/all-pages", renderPage({
  title: "Every page on Japan Proxy Cost",
  description: "A full index of the comparisons, marketplace guides, weight-by-weight shipping costs, fee explainers, import tax guides and export-restriction checks on this site.",
  canonicalPath: "/all-pages",
  body: allPagesBody,
  prefill: null,
  layout: "content-only",
}));

for (const p of pages) {
  writePage(p.path, renderPage({ ...p, canonicalPath: p.path }));
}

// ---- 404ページ ----
// wrangler.toml で not_found_handling = "404-page" にしているため dist/404.html が必要。
// 無いと存在しないURLで本文ゼロバイトの真っ白なページが返る。
writePage("/404", renderPage({
  title: "Page not found — Japan Proxy Cost Calculator",
  description: `That page does not exist. Start from the calculator to compare ${PROXY_TITLE_LIST}.`,
  canonicalPath: "/404",
  prefill: null,
  noindex: true,
  layout: "content-only",
  body: `
  <h1>That page doesn't exist</h1>
  <p>The link may be out of date. Start again from the calculator, or pick one of these:</p>
  <ul>
    <li><a href="/">Compare all ${NW} proxy services</a></li>
    ${Object.entries(grouped).map(([heading, list]) =>
      `<li><a href="${list[0].path}">${esc(heading)}</a></li>`).join("")}
  </ul>`,
}));

// ---- sitemap.xml / robots.txt ----
// noindex のページ（送信完了ページなど）は sitemap に載せない。載せておいて検索避けするのは矛盾する
const urls = ["/", "/all-pages", ...pages.filter((p) => !p.noindex).map((p) => p.path)];
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
  `\n</urlset>\n`);

fs.writeFileSync(path.join(DIST, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

// ---- 生成物の自己点検 ----
// 検索流入が生命線なので、リンク切れと日本語混入はビルドを落として止める。
// どちらも実際に本番へ出してしまったことがある（比較ページへのリンクをアルファベット順で
// 組み立てて404を2本、輸入税ページに社内メモの日本語をそのまま出力）。
{
  const known = new Set(["/", "/404", "/all-pages", ...pages.map((p) => p.path)]);
  const problems = [];
  const jp = /[぀-ヿ㐀-鿿]/;

  // 連絡手段の無いサイトはAdSenseの審査で落ちる。未設定のまま本番へ出さない。
  if (!CONTACT_FORM_ENDPOINT) {
    problems.push("お問い合わせフォームの送信先が未設定（src/lib/pages.mjs の CONTACT_FORM_ENDPOINT）");
  }
  // 本文が薄いページは「有用性の低いコンテンツ」と判定される。表を除いた語数で見る。
  const wordsOf = (body) => body
    .replace(/<table[\s\S]*?<\/table>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ").trim().split(/\s+/).filter(Boolean).length;

  for (const p of [{ path: "/", body: homeBody, title: "", description: "" },
                   { path: "/all-pages", body: allPagesBody, title: "", description: "" },
                   ...pages]) {
    if (p.path !== "/all-pages" && wordsOf(p.body) < 250) {
      problems.push(`本文が薄い ${p.path}（表を除いて${wordsOf(p.body)}語）`);
    }
    // 2026-10-01 に本文を厚くした（中央値367語→870語前後）。その水準を割るページを出さない。
    // 表も含めた語数で500語。問い合わせ・プライバシー・送信完了・一覧は性質上短いので対象外。
    const SHORT_OK = ["/all-pages", "/contact", "/contact-received", "/privacy-policy"];
    const allWords = p.body.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").trim().split(/\s+/).filter(Boolean).length;
    if (!SHORT_OK.includes(p.path) && !p.noindex && allWords < 500) {
      problems.push(`本文が薄い ${p.path}（表を含めて${allWords}語。500語以上にすること）`);
    }
    // 計算や表示の取り違えで NaN / undefined が本文に出たら止める（2026-10-05、料率型の手数料で ¥NaN を出した）
    const plain = p.body.replace(/<[^>]+>/g, " ");
    if (/\bNaN\b|\bundefined\b/.test(plain)) problems.push(`本文に NaN / undefined ${p.path}: ${(plain.match(/.{0,30}\b(NaN|undefined)\b.{0,20}/) || [""])[0].trim()}`);
    for (const m of p.body.matchAll(/href="(\/[^"#?]*)"/g)) {
      if (!known.has(m[1])) problems.push(`リンク切れ ${p.path} → ${m[1]}`);
    }
    // 日本語を意図して見せる箇所（商品ページの読み方ガイド）は <span lang="ja"> に入れる。その中だけ検査から外す
    for (const [field, text] of [["title", p.title], ["description", p.description], ["body", p.body.replace(/<span lang="ja">[^<]*<\/span>/g, "")]]) {
      if (jp.test(text)) {
        const hit = text.split(/\s+/).find((w) => jp.test(w));
        problems.push(`日本語混入 ${p.path} の ${field}: ${hit}`);
      }
    }
  }

  // ヘッダーとフッター（全ページ共通）のリンクも、存在するページを指しているか確かめる
  for (const m of (siteHeader("") + siteFooter()).matchAll(/href="(\/[^"#?]*)"/g)) {
    if (!known.has(m[1])) problems.push(`リンク切れ ヘッダー/フッター → ${m[1]}`);
  }

  if (problems.length) {
    console.error(`❌ 生成物に${problems.length}件の問題があります:`);
    [...new Set(problems)].slice(0, 20).forEach((x) => console.error("   " + x));
    process.exit(1);
  }
}

console.log(`✅ ${urls.length} ページ生成 (${SITE_URL})`);
Object.entries(grouped).forEach(([k, v]) => console.log(`   ${k}: ${v.length}`));
console.log(`   sitemap.xml / robots.txt`);
