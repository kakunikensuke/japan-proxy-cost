/**
 * 全ページ共通の外枠（ヘッダー・写真入りの見出し帯・目次・フッター）。
 *
 * ■ なぜプリレンダ側で組むのか
 * 本文は #root の外に置き、React に触らせない（触らせると本文が消える。AdSense に
 * 「有用性の低いコンテンツ」と判定された直接の原因）。外枠も同じく静的HTMLに置くので、
 * JSを実行しないクローラにもナビゲーションと運営者情報への導線が見える。
 *
 * ■ 写真
 * Wikimedia Commons の、商用利用できるライセンス（CC0 / CC BY / CC BY-SA）のものだけを使う。
 * CC BY 系は作者名とライセンスの表示が条件なので、見出し帯の右下に必ずクレジットを出し、
 * /about の Photo credits にも一覧を載せる。**ライセンス表記を消さないこと。**
 * 写真は暗い紺を重ねて文字を読ませる前提で強めに圧縮してある（1600w / 800w の WebP）。
 */

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const PHOTOS = {
  home: {
    what: "Akihabara's main street at night, with a train crossing the bridge",
    author: "yagi-s", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:Akihabara_Main_Street_north_side_at_night_(2017-03-12_20.48.21_by_yagi-s).jpg",
    position: "50% 55%",
  },
  compare: {
    what: "Shelves of second-hand collectibles at Mandarake, Nakano Broadway",
    author: "Asanagi", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    source: "https://commons.wikimedia.org/wiki/File:Mandarake_Nakano_main_store_2024-04-11.jpg",
    position: "50% 45%",
  },
  marketplace: {
    what: "Shoppers in the Nakano Broadway arcade, Tokyo",
    author: "Dick Thomas Johnson", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:Nakano_Broadway_(53146685677).jpg",
    position: "50% 50%",
  },
  shipping: {
    what: "A Nippon Cargo Airlines 747 freighter at Narita Airport",
    author: "Masahiro TAKAGI", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:Nippon_Cargo_Airlines_Boeing_747-8KZF_(JA18KZ)_-_Tokyo_Narita_Airport.jpg",
    position: "50% 62%",
  },
  tax: {
    what: "A Nippon Cargo Airlines 747 freighter landing at Narita Airport",
    author: "Masahiro TAKAGI", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:Nippon_Cargo_Airlines_Boeing_747-8F_(JA11KZ)_-_Tokyo_Narita_Airport.jpg",
    position: "50% 55%",
  },
  guides: {
    what: "A side street in Ueno, Tokyo, at night",
    author: "Levi Clancy", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    source: "https://commons.wikimedia.org/wiki/File:Views_at_night_in_April_of_2019_around_the_Ueno_neighborhood_in_Tokyo_13.jpg",
    position: "50% 40%",
  },
  site: {
    what: "The Fujiya building in Ginza at blue hour",
    author: "Basile Morin", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Illuminated_street_corner_at_blue_hour_-_facade_of_the_building_Fujiya_in_Ginza_Chuo-ku_Tokyo_Japan.jpg",
    position: "50% 50%",
  },
};

/** どのページがどのセクション（＝見出し帯の写真・パンくずの親・ナビの現在地）に属するか */
export function sectionOf(path) {
  if (path === "/") return { key: "home", photo: "home" };
  if (path === "/compare") return { key: "compare", photo: "compare" };
  if (path.includes("-vs-")) return { key: "compare", photo: "compare", parent: { href: "/compare", text: "Compare services" } };
  if (path.startsWith("/cheapest-proxy-")) return { key: "compare", photo: "marketplace", parent: { href: "/compare", text: "Compare services" } };
  if (path.endsWith("-fees")) return { key: "compare", photo: "marketplace", parent: { href: "/compare", text: "Compare services" } };
  if (path === "/import-tax" || path.startsWith("/import-tax-")) return { key: "tax", photo: "tax", parent: path === "/import-tax" ? null : { href: "/import-tax", text: "Import tax" } };
  if (path.startsWith("/ship-")) return { key: "ship", photo: "shipping", parent: { href: "/guides/ems-weight-bands", text: "Shipping costs" } };
  if (path.startsWith("/can-you-ship-")) return { key: "ship", photo: "shipping", parent: { href: "/what-you-cannot-ship-from-japan", text: "What can’t ship" } };
  if (path === "/what-you-cannot-ship-from-japan") return { key: "ship", photo: "shipping" };
  if (path === "/guides" || path.startsWith("/guides/")) return { key: "guides", photo: "guides", parent: path === "/guides" ? null : { href: "/guides", text: "Guides" } };
  return { key: "site", photo: "site" };
}

const NAV = [
  { key: "compare", href: "/compare", text: "Compare services" },
  { key: "tax", href: "/import-tax", text: "Import tax" },
  { key: "ship", href: "/what-you-cannot-ship-from-japan", text: "What can’t ship" },
  { key: "guides", href: "/guides", text: "Guides" },
];

const LOGO = (dark) => `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><rect x="2" y="7" width="24" height="18" rx="4" fill="${dark ? "#FFFFFF" : "#13233A"}"/><path d="M2 12h24" stroke="${dark ? "#13233A" : "#FFFFFF"}" stroke-width="1.5"/><rect x="10" y="3" width="8" height="9" rx="2" fill="#2453FF"/><circle cx="21" cy="19" r="2.4" fill="#F2A93B"/></svg>`;

export function siteHeader(sectionKey) {
  return `<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
  <a class="brand" href="/">${LOGO(false)}<span>Japan Proxy Cost</span></a>
  <nav class="top-nav" aria-label="Main">${NAV.map((n) =>
    `<a href="${n.href}"${n.key === sectionKey ? ' aria-current="page"' : ""}>${n.text}</a>`).join("")}</nav>
  <a class="top-cta" href="/#calculator">Price my order</a>
</div></header>`;
}

export function siteFooter() {
  return `<footer class="foot"><div class="wrap">
  <div class="foot-cols">
    <div class="foot-about">
      <a class="brand" href="/">${LOGO(true)}<span>Japan Proxy Cost</span></a>
      <p>An independent calculator for buying from Japan through a proxy service. Not affiliated with any of the services it compares.</p>
    </div>
    <nav aria-label="Compare"><h2>Compare</h2><ul>
      <li><a href="/compare">All service comparisons</a></li>
      <li><a href="/buyee-vs-zenmarket-to-united-states">Buyee vs ZenMarket</a></li>
      <li><a href="/fromjapan-vs-buyee-to-united-states">FROM JAPAN vs Buyee</a></li>
      <li><a href="/all-pages">Every page on this site</a></li>
    </ul></nav>
    <nav aria-label="Before you buy"><h2>Before you buy</h2><ul>
      <li><a href="/what-you-cannot-ship-from-japan">What can’t ship from Japan</a></li>
      <li><a href="/import-tax">Import tax by country</a></li>
      <li><a href="/guides">Guides</a></li>
      <li><a href="/how-we-calculate">How we calculate</a></li>
    </ul></nav>
    <nav aria-label="This site"><h2>This site</h2><ul>
      <li><a href="/about">About</a></li>
      <li><a href="/privacy-policy">Privacy &amp; cookies</a></li>
      <li><a href="/contact">Contact</a></li>
      <li><a href="/about#photo-credits">Photo credits</a></li>
    </ul></nav>
  </div>
  <p class="foot-fine">Estimates only. Providers change their pricing, and customs authorities have the final say on duty and tax. Always confirm on the provider’s own site before you buy.</p>
</div></footer>`;
}

/** 写真クレジット。CC BY 系はこれが利用条件。 */
export function photoCredit(key) {
  const p = PHOTOS[key];
  return `<p class="credit">Photo: <a href="${p.source}" rel="noopener" target="_blank">${esc(p.what)}</a>, ${esc(p.author)}, <a href="${p.licenseUrl}" rel="license noopener" target="_blank">${p.license}</a></p>`;
}

/** 写真を背景に敷く <img>。装飾なので alt は空（内容はクレジットに書く）。 */
export function photoImg(key, { eager = false } = {}) {
  const p = PHOTOS[key];
  return `<img class="band-photo" src="/img/${key}-1600.webp" srcset="/img/${key}-800.webp 800w, /img/${key}-1600.webp 1600w" sizes="100vw" alt="" ${eager ? 'fetchpriority="high"' : 'loading="eager" decoding="async"'} style="object-position:${p.position}" />`;
}

export function photoPreload(key) {
  return `<link rel="preload" as="image" href="/img/${key}-1600.webp" imagesrcset="/img/${key}-800.webp 800w, /img/${key}-1600.webp 1600w" imagesizes="100vw" />`;
}

/** 見出しから id を作る（目次のアンカー用）。同じ見出しが2回出ても重複しないようにする。 */
function slugify(text, used) {
  let base = text.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

/**
 * 本文の先頭の <h1> と最初の段落を見出し帯へ移し、残りの <h2> に id を振って目次を作る。
 * 本文中の文言そのものは一切変えない（数字は pages.mjs が計算したものをそのまま出す）。
 */
export function splitArticle(body) {
  const h1m = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  let rest = h1m ? body.replace(h1m[0], "") : body;
  let dek = "";
  const pm = rest.match(/^\s*<p(?![^>]*class=)[^>]*>([\s\S]*?)<\/p>/);
  if (pm) { dek = pm[1]; rest = rest.replace(pm[0], ""); }

  const used = new Set();
  const toc = [];
  rest = rest.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (m, attrs, inner) => {
    if (/\bid=/.test(attrs)) return m;
    const id = slugify(inner, used);
    const label = inner.replace(/<small[\s\S]*?<\/small>/g, "").replace(/<[^>]+>/g, "").trim();
    if (label !== "Related") toc.push({ id, label });
    return `<h2 id="${id}"${attrs}>${inner}</h2>`;
  });
  rest = rest.replace(/<table([\s\S]*?)<\/table>/g, '<div class="tscroll"><table$1</table></div>');
  return { h1: h1m ? h1m[1] : "", dek, body: rest, toc };
}

export function breadcrumbs(section, h1) {
  const items = [{ href: "/", text: "Home" }];
  if (section.parent) items.push(section.parent);
  const plain = h1.replace(/<[^>]+>/g, "");
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map((i) => `<li><a href="${i.href}">${esc(i.text)}</a></li>`).join("")}<li aria-current="page">${plain}</li></ol></nav>`;
}

export function breadcrumbJsonLd(siteUrl, section, h1, canonicalPath) {
  const items = [{ name: "Home", item: `${siteUrl}/` }];
  if (section.parent) items.push({ name: section.parent.text, item: `${siteUrl}${section.parent.href}` });
  items.push({ name: h1.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, ""), item: `${siteUrl}${canonicalPath}` });
  return JSON.stringify({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: x.item })),
  }).replace(/</g, "\\u003c");
}
