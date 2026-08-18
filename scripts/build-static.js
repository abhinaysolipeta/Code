/* Bundles the report view into one self-contained HTML page.
 *
 * There is no build tooling in this project and adding a bundler for one
 * preview page would be a poor trade, so this walks the ES module graph itself
 * and emits a tiny registry. It handles exactly the syntax this codebase uses:
 * named imports, and `export` on function/const/let/class declarations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSeed } from '../server/seed.js';
import { dayInMonth } from '../shared/dates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'scripts', 'static-entry.js');
const OUT = process.argv[2] ?? path.join(ROOT, 'dist', 'preview.html');

const id = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/** Resolve a specifier the same way the dev server does: /shared/... is root-absolute. */
function resolve(specifier, fromFile) {
  if (specifier.startsWith('/')) return path.join(ROOT, specifier);
  return path.resolve(path.dirname(fromFile), specifier);
}

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

const modules = new Map();

function load(file) {
  const key = id(file);
  if (modules.has(key)) return key;
  modules.set(key, null); // reserve first, so a cycle cannot recurse forever

  let src = fs.readFileSync(file, 'utf8');

  const exported = [...src.matchAll(EXPORT_DECL_RE)].map((m) => m[1]);
  const deps = [];

  src = src.replace(IMPORT_RE, (_match, names, specifier) => {
    const depKey = load(resolve(specifier, file));
    deps.push(depKey);
    return `const {${names}} = __req(${JSON.stringify(depKey)});`;
  });
  src = src.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\s)/gm, '');

  modules.set(key, { key, src, exported, deps });
  return key;
}

const entryKey = load(ENTRY);

/* The dashboard talks to the server API only to tick payments off; in the
 * preview that is served by the entry module instead. */
const API_KEY = 'public/js/api.js';
modules.set(API_KEY, {
  key: API_KEY,
  exported: ['api'],
  deps: [entryKey],
  src: `const api = new Proxy({}, {
  get: (_t, prop) => (...args) => __req(${JSON.stringify(entryKey)}).previewApi[prop](...args),
});`,
});

/* ---- demo data ---------------------------------------------------- */

const seed = buildSeed();
const latestMonth = seed.snapshots.reduce((a, s) => (s.month > a ? s.month : a), '0000-01');
// A fixed "today" inside the newest month keeps due-date statuses meaningful
// however long after the build the page is opened.
const today = dayInMonth(latestMonth, 18);
seed.settings.household = 'The Sample Household';

/* ---- emit ---------------------------------------------------------- */

const order = [...modules.values()].filter(Boolean);
const registry = order.map((m) => {
  const assign = m.exported.length
    ? `\n__x.${m.exported[0]};Object.assign(__x, {${m.exported.join(', ')}});`
    : '';
  return `__mods[${JSON.stringify(m.key)}] = function (__x) {\n${m.src}${assign}\n};`;
}).join('\n\n');

const bundle = `
const __mods = {};
const __cache = {};
function __req(key) {
  if (__cache[key]) return __cache[key];
  const __x = {};
  __cache[key] = __x;
  __mods[key](__x);
  return __x;
}

${registry}

__req(${JSON.stringify(entryKey)});
`;

const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

const html = `<title>LedgerLight Monthly Report</title>
<meta name="color-scheme" content="light dark">
<style>
${css}
/* The preview has no sidebar, so the shell is a single column. */
.main { min-height: 100vh; }
.content { margin: 0 auto; }
.topbar { position: sticky; top: 0; z-index: 20; }
</style>

<div id="app"><div class="loading">Loading…</div></div>

<script type="module">
const __DEMO_DB = ${JSON.stringify(seed)};
const __DEMO_TODAY = ${JSON.stringify(today)};
${bundle.replace('/*__DEMO_DB__*/ null', '__DEMO_DB').replace('/*__DEMO_TODAY__*/ null', '__DEMO_TODAY')}
</script>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

console.log(`  Wrote ${OUT}`);
console.log(`  ${order.length} modules, ${(html.length / 1024).toFixed(0)} KB`);
console.log(`  Demo month: ${latestMonth} (today = ${today})`);
