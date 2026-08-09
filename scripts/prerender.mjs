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
import { buildPages } from "../src/lib/pages.mjs";

const SITE_URL = (process.env.VITE_SITE_URL ?? "https://japanproxy.kakuni-lab.com").replace(/\/$/, "");
const DIST = path.join(import.meta.dirname, "..", "dist");
const TEMPLATE_PATH = path.join(DIST, "index.html");

if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error("dist/index.html がありません。先に `npm run build` を実行してください。");
  process.exit(1);
}
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, "utf-8");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderPage({ title, description, canonicalPath, body, prefill }) {
  let html = TEMPLATE;

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
    <link rel="canonical" href="${SITE_URL}${canonicalPath}" />
    <script>window.__PAGE__=${JSON.stringify({ prefill: prefill ?? null }).replace(/</g, "\\u003c")};</script>
  </head>`;
  html = html.replace("</head>", head);

  // 本文と内部リンクを #root に入れる。title だけ直してもクローラはサイト構造を辿れない。
  // React は createRoot で #root の中身を捨てて描き直すので、内容が一致していなくても問題ない。
  html = html.replace('<div id="root"></div>', `<div id="root"><main class="prerender">${body}</main></div>`);
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

const pages = buildPages({ proxies, ems, importTax, restrictions });

// ---- トップページ: 全ページへの入口を持たせる ----
const grouped = {
  // 「そもそも送れるのか」を最上部に置く。金額より先に知る必要がある情報なので。
  "Can you even ship it?": pages.filter((p) => p.path.startsWith("/can-you-ship-") || p.path === "/what-you-cannot-ship-from-japan"),
  "Compare two services": pages.filter((p) => p.path.includes("-vs-")),
  "Cheapest proxy by marketplace": pages.filter((p) => p.path.startsWith("/cheapest-proxy-for-")),
  "Shipping cost by item": pages.filter((p) => p.path.startsWith("/ship-")),
  "Fees by service": pages.filter((p) => p.path.endsWith("-fees")),
  "Import tax by country": pages.filter((p) => p.path.startsWith("/import-tax-")),
};

const homeBody = `
  <h1>What does a Japan proxy service actually cost?</h1>
  <p>Buyee, ZenMarket, Neokyo and FROM JAPAN all charge differently — per item, per order, by weight, or as a
  percentage. The cheapest one changes depending on what you buy and where it goes. These pages work out the
  real landed total, including the import tax most comparisons leave out.</p>
  ${Object.entries(grouped).map(([heading, list]) => `
  <section>
    <h2>${esc(heading)}</h2>
    <ul>${list.map((p) => `<li><a href="${p.path}">${esc(p.title)}</a></li>`).join("")}</ul>
  </section>`).join("")}
  <p><small>Fee data checked ${esc(proxies._meta.updated)} against each provider's official pages.</small></p>`;

writePage("/", renderPage({
  title: "Japan Proxy Cost Calculator — compare Buyee, ZenMarket, Neokyo & FROM JAPAN",
  description: "Work out what a Japanese proxy service actually costs. Service fees, packing, deposit fees, EMS postage and import tax, compared side by side.",
  canonicalPath: "/",
  body: homeBody,
  prefill: null,
}));

for (const p of pages) {
  writePage(p.path, renderPage({ ...p, canonicalPath: p.path }));
}

// ---- 404ページ ----
// wrangler.toml で not_found_handling = "404-page" にしているため dist/404.html が必要。
// 無いと存在しないURLで本文ゼロバイトの真っ白なページが返る。
writePage("/404", renderPage({
  title: "Page not found — Japan Proxy Cost Calculator",
  description: "That page does not exist. Start from the calculator to compare Buyee, ZenMarket, Neokyo and FROM JAPAN.",
  canonicalPath: "/404",
  prefill: null,
  body: `
  <h1>That page doesn't exist</h1>
  <p>The link may be out of date. Start again from the calculator, or pick one of these:</p>
  <ul>
    <li><a href="/">Compare all four proxy services</a></li>
    ${Object.entries(grouped).map(([heading, list]) =>
      `<li><a href="${list[0].path}">${esc(heading)}</a></li>`).join("")}
  </ul>`,
}));

// ---- sitemap.xml / robots.txt ----
const urls = ["/", ...pages.map((p) => p.path)];
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
  `\n</urlset>\n`);

fs.writeFileSync(path.join(DIST, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

console.log(`✅ ${urls.length} ページ生成 (${SITE_URL})`);
Object.entries(grouped).forEach(([k, v]) => console.log(`   ${k}: ${v.length}`));
console.log(`   sitemap.xml / robots.txt`);
