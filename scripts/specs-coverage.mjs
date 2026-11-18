#!/usr/bin/env node
// Cobertura de critérios de aceite (SDD): cruza os ACs declarados nas specs com os
// testes que citam o ID entre colchetes, por nível de teste.
//
//   pnpm specs:coverage                      relatório (não falha por AC sem teste)
//   pnpm specs:coverage --require=ACC,TRF    falha se algum AC desses prefixos não tiver
//                                            todos os níveis esperados
//
// Sempre falha se um teste citar um ID que não existe em nenhuma spec (erro de digitação).
//
// Convenções lidas:
//   spec:  "### TRF-AC-06: título"  seguido de uma linha "- Nível: integração + e2e"
//   teste: it('[TRF-AC-06] ...')     nível pelo caminho do arquivo:
//          /test/e2e/ → e2e | /test/integration/ ou *.int.spec.ts → integração | resto → unitário
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SPECS_DIR = join(ROOT, 'specs');
const TEST_ROOTS = ['apps', 'packages'].map((d) => join(ROOT, d));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);
const LEVELS = ['unitário', 'integração', 'e2e'];
const AC_HEADING = /^###\s+((?:[A-Z]{3})-AC-\d{2})\b/;
const AC_REF = /\[([A-Z]{3}-AC-\d{2})\]/g;

const args = process.argv.slice(2);
const requireArg = args.find((a) => a.startsWith('--require='));
const required = new Set(
  requireArg ? requireArg.slice('--require='.length).split(',').filter(Boolean) : [],
);

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function expectedLevels(line) {
  const text = line.toLowerCase();
  return LEVELS.filter((level) => text.includes(level === 'unitário' ? 'unit' : level));
}

// 1. ACs declarados nas specs.
const acs = new Map(); // id -> { spec, expected: string[] }
for (const file of walk(SPECS_DIR, (f) => f.endsWith('spec.md'))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const match = AC_HEADING.exec(line);
    if (!match) return;
    const id = match[1];
    if (acs.has(id)) throw new Error(`AC duplicado: ${id} em ${relative(ROOT, file)}`);
    let expected = [];
    for (let j = i + 1; j < lines.length && !lines[j].startsWith('#'); j++) {
      if (/^-\s*Nível:/i.test(lines[j])) {
        expected = expectedLevels(lines[j]);
        break;
      }
    }
    if (expected.length === 0) {
      throw new Error(`${id} sem linha "- Nível:" em ${relative(ROOT, file)}`);
    }
    acs.set(id, { spec: relative(ROOT, file), expected });
  });
}

// 2. Referências nos testes.
function levelOf(file) {
  if (file.includes('/test/e2e/')) return 'e2e';
  if (file.includes('/test/integration/') || file.endsWith('.int.spec.ts')) return 'integração';
  return 'unitário';
}

const found = new Map(); // id -> Set(levels)
const unknown = [];
const testFiles = TEST_ROOTS.flatMap((root) => walk(root, (f) => /\.(spec|test)\.tsx?$/.test(f)));
for (const file of testFiles) {
  const level = levelOf(file);
  for (const [, id] of readFileSync(file, 'utf8').matchAll(AC_REF)) {
    if (!acs.has(id)) {
      unknown.push(`${id} em ${relative(ROOT, file)}`);
      continue;
    }
    if (!found.has(id)) found.set(id, new Set());
    found.get(id).add(level);
  }
}

// 3. Relatório.
let missingRequired = 0;
let complete = 0;
let partial = 0;
let none = 0;
let currentSpec = '';
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

for (const [id, { spec, expected }] of [...acs].sort(([a], [b]) => a.localeCompare(b))) {
  if (spec !== currentSpec) {
    currentSpec = spec;
    console.log(`\n${spec}`);
  }
  const have = found.get(id) ?? new Set();
  const missing = expected.filter((l) => !have.has(l));
  let status;
  if (missing.length === 0) {
    status = '✅ completo';
    complete++;
  } else if (have.size > 0) {
    status = `🟡 falta ${missing.join(', ')}`;
    partial++;
  } else {
    status = '⬜ sem teste';
    none++;
  }
  const prefix = id.slice(0, 3);
  const isRequired = required.has(prefix) && missing.length > 0;
  if (isRequired) missingRequired++;
  console.log(
    `  ${pad(id, 11)} esperado: ${pad(expected.join(' + '), 28)} ${status}${isRequired ? '  ← obrigatório' : ''}`,
  );
}

console.log(
  `\n${acs.size} critérios: ${complete} completos, ${partial} parciais, ${none} sem teste.`,
);

if (unknown.length > 0) {
  console.error(`\n❌ Testes citam IDs que não existem nas specs:\n  ${unknown.join('\n  ')}`);
}
if (missingRequired > 0) {
  console.error(
    `\n❌ ${missingRequired} critério(s) obrigatório(s) (${[...required].join(', ')}) sem todos os níveis de teste.`,
  );
}
process.exit(unknown.length > 0 || missingRequired > 0 ? 1 : 0);
