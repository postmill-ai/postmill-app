import * as fs from 'fs';
import * as path from 'path';

/**
 * Normalize the full-surface audit outputs (crawl / exercise / a11y, per persona) into ONE
 * deduped, severity-ranked findings set keyed by (area, route, type). Personas that hit the
 * same issue are merged into a `personas` list. Feeds dev/UI_UX_AUDIT.md (Phase 3).
 *
 * Run: npx tsx aggregate-audit.ts   (or: node --loader ts-node/esm)
 * Output: results-audit-normalized.json + a console summary grouped by area/severity.
 */
type Sev = 'P0' | 'P1' | 'P2' | 'P3';
interface Finding {
  key: string; area: string; route: string; type: string;
  severity: Sev; layer: 'crawl' | 'exercise' | 'a11y';
  personas: string[]; detail: string;
}

const PERSONAS = ['admin', 'member', 'free'];
const findings = new Map<string, Finding>();

function add(area: string, route: string, type: string, severity: Sev, layer: Finding['layer'], persona: string, detail: string) {
  const key = `${layer}|${route}|${type}`;
  const cur = findings.get(key);
  if (cur) {
    if (!cur.personas.includes(persona)) cur.personas.push(persona);
    return;
  }
  findings.set(key, { key, area, route, type, severity, layer, personas: [persona], detail });
}

function read(file: string): any | null {
  const p = path.join(__dirname, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}

// Severity for a crawl/exercise flag string.
function sevOf(flag: string): Sev {
  if (/PAGE_ERROR|PAGEERROR|API_5XX|_5XX|HTTP_5\d\d|NAV_ERROR/.test(flag)) return 'P0';
  if (/HTTP_4\d\d|API_4XX|INVALID_SUBMIT_NO_VALIDATION|REDIRECTED_TO_AUTH/.test(flag)) return 'P1';
  if (/NEAR_EMPTY|TOO_FEW_ACTIONABLES|BROKEN_IMAGES|TAB_ERROR|OPEN_/.test(flag)) return 'P2';
  return 'P3';
}
const typeOf = (flag: string) => flag.split(/[:[(]/)[0].trim();

for (const persona of PERSONAS) {
  // Crawl
  const crawl = read(`results-crawl-${persona}.json`);
  if (crawl?.findings) for (const f of crawl.findings) {
    for (const flag of f.flags || []) add(f.area || 'misc', f.path, typeOf(flag), sevOf(flag), 'crawl', persona, flag);
  }
  // Exercise
  const ex = read(`results-exercise-${persona}.json`);
  if (ex?.findings) for (const f of ex.findings) {
    for (const flag of f.flags || []) add(f.area || 'misc', f.path, typeOf(flag), sevOf(flag), 'exercise', persona, flag);
  }
  // A11y — per theme (dark/light) plus the legacy untagged file.
  for (const theme of ['dark', 'light', '']) {
    const a11y = read(theme ? `results-a11y-${persona}-${theme}.json` : `results-a11y-${persona}.json`);
    if (a11y?.findings) for (const f of a11y.findings) {
      for (const v of f.violations || []) {
        const sev: Sev = v.impact === 'critical' || v.impact === 'serious' ? 'P2' : 'P3';
        const tag = theme ? `a11y:${v.id}@${theme}` : `a11y:${v.id}`;
        add(f.area || 'misc', f.path, tag, sev, 'a11y', persona, `${v.impact} ${v.help} ×${v.nodes}`);
      }
    }
  }
}

const all = [...findings.values()];
const order: Sev[] = ['P0', 'P1', 'P2', 'P3'];
all.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.area.localeCompare(b.area) || a.route.localeCompare(b.route));

fs.writeFileSync(path.join(__dirname, 'results-audit-normalized.json'),
  JSON.stringify({ generatedFrom: PERSONAS, total: all.length, findings: all }, null, 2));

const bySev = (s: Sev) => all.filter((f) => f.severity === s);
console.log('\n================ NORMALIZED AUDIT FINDINGS ================');
for (const s of order) {
  const list = bySev(s);
  console.log(`\n${s} — ${list.length}`);
  for (const f of list.slice(0, 40)) {
    console.log(`  [${f.area}] ${f.route}  ${f.type}  {${f.personas.join(',')}}  ${f.layer}`);
  }
  if (list.length > 40) console.log(`  … +${list.length - 40} more`);
}
console.log(`\nTotal ${all.length} findings across ${new Set(all.map((f) => f.route)).size} routes. → results-audit-normalized.json`);
