#!/usr/bin/env node
/**
 * schema-destructive-guard.mjs
 *
 * Reads forward-migration SQL (the output of `prisma migrate diff --script`) and
 * flags destructive / unsafe statements that `prisma db push --accept-data-loss`
 * would otherwise apply silently:
 *
 *   - DROP TABLE
 *   - DROP COLUMN
 *   - DROP CONSTRAINT
 *   - ADD COLUMN ... NOT NULL  without a DEFAULT (breaks on existing rows)
 *
 * Usage:
 *   node scripts/schema-destructive-guard.mjs --file path/to/pending.sql
 *   cat pending.sql | node scripts/schema-destructive-guard.mjs
 *
 * Exit codes:
 *   1  destructive/unsafe statement(s) found and ALLOW_DESTRUCTIVE_SCHEMA !== 'true'
 *   0  clean, or override set via ALLOW_DESTRUCTIVE_SCHEMA=true
 *
 * No external dependencies (Node built-ins only).
 */

import { readFileSync } from 'node:fs';

function readInput() {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf('--file');
  if (fileFlag !== -1) {
    const filePath = args[fileFlag + 1];
    if (!filePath) {
      console.error('schema-destructive-guard: --file requires a path argument');
      process.exit(2);
    }
    return readFileSync(filePath, 'utf8');
  }
  // Fall back to stdin.
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function findDestructive(sql) {
  const findings = [];
  const lines = sql.split(/\r?\n/);

  // ADD COLUMN ... NOT NULL without DEFAULT may span lines; normalise statements
  // by splitting on ';' for the ADD COLUMN check while keeping per-line detection
  // for the DROP checks (which are line-scoped in Prisma's generated SQL).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    if (/\bDROP\s+TABLE\b/.test(upper)) {
      findings.push({ line: i + 1, kind: 'DROP TABLE', text: line.trim() });
    }
    if (/\bDROP\s+COLUMN\b/.test(upper)) {
      findings.push({ line: i + 1, kind: 'DROP COLUMN', text: line.trim() });
    }
    if (/\bDROP\s+CONSTRAINT\b/.test(upper)) {
      findings.push({ line: i + 1, kind: 'DROP CONSTRAINT', text: line.trim() });
    }
  }

  // ADD COLUMN ... NOT NULL without DEFAULT — evaluate per statement so a DEFAULT
  // on a following clause of the same statement is honoured.
  const statements = sql.split(';');
  for (const stmt of statements) {
    const upper = stmt.toUpperCase();
    if (/\bADD\s+COLUMN\b/.test(upper) && /\bNOT\s+NULL\b/.test(upper) && !/\bDEFAULT\b/.test(upper)) {
      findings.push({
        line: null,
        kind: 'ADD COLUMN NOT NULL (no DEFAULT)',
        text: stmt.trim().replace(/\s+/g, ' '),
      });
    }
  }

  return findings;
}

const sql = readInput();

if (!sql || sql.trim().length === 0) {
  console.error('schema-destructive-guard: empty input — upstream migration diff likely failed.');
  process.exit(2);
}

const findings = findDestructive(sql);

if (findings.length === 0) {
  console.log('schema-destructive-guard: no destructive statements found.');
  process.exit(0);
}

console.error('schema-destructive-guard: destructive / unsafe schema statements detected:');
for (const f of findings) {
  const where = f.line ? `line ${f.line}` : 'statement';
  console.error(`  [${f.kind}] (${where}): ${f.text}`);
}

if (process.env.ALLOW_DESTRUCTIVE_SCHEMA === 'true') {
  console.error('\nALLOW_DESTRUCTIVE_SCHEMA=true — overriding (review the expand/contract plan).');
  process.exit(0);
}

console.error(
  '\nBlocked. These changes are destructive under `prisma db push --accept-data-loss`.\n' +
    'Provide an expand/contract plan and re-run with ALLOW_DESTRUCTIVE_SCHEMA=true to override.'
);
process.exit(1);
