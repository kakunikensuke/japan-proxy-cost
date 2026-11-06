// フォルダ内の全HTMLについて、数字を伏せた8文字の重なりを総当たりで測り、似ている組の上位を出す
import fs from "node:fs"; import path from "node:path";
const dir = process.argv[2], top = Number(process.argv[3] || 15), filter = process.argv[4] ? new RegExp(process.argv[4]) : null;
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith(".html") && f !== "404.html") files.push(p); } })(dir);
const text = (h) => { const m = h.match(/<main[\s\S]*<\/main>/i) || h.match(/<body[\s\S]*<\/body>/i) || [h]; return m[0].replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " "); };
const sh = (t) => { const w = t.replace(/[0-9０-９.,¥$€£%]+/g, "#"); const s = new Set(); for (let i = 0; i + 8 <= w.length; i += 2) s.add(w.slice(i, i + 8)); return s; };
let docs = files.map((f) => ({ f: path.relative(dir, f), s: sh(text(fs.readFileSync(f, "utf8"))) })).filter((d) => d.s.size > 50);
if (filter) docs = docs.filter((d) => filter.test(d.f));
const pairs = [];
for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) {
  const A = docs[i].s, B = docs[j].s; let n = 0; for (const x of A) if (B.has(x)) n++;
  pairs.push([n / (A.size + B.size - n), docs[i].f, docs[j].f]);
}
pairs.sort((a, b) => b[0] - a[0]);
console.log("pages", docs.length, "pairs", pairs.length, ">=70%:", pairs.filter((p) => p[0] >= 0.7).length, ">=50%:", pairs.filter((p) => p[0] >= 0.5).length);
for (const [v, a, b] of pairs.slice(0, top)) console.log((v * 100).toFixed(0) + "%", a, "|", b);
