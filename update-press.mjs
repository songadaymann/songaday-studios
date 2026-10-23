// Refreshes press/press.json, the press page's built-in snapshot, from the press sheet's Public
// tab. The live page doesn't need this (the Worker reads the sheet), but the snapshot is what
// shows when the sheet can't be read, and the live sheet must keep at least half its rows.
//
//   node update-press.mjs              # the published CSV at PRESS_CSV_URL (env, or wrangler.jsonc)
//   node update-press.mjs public.csv   # a CSV downloaded from the Public tab
//
// It lists each row it leaves out and why. Then node build-production.mjs and wrangler deploy.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRESS_COLUMNS, pressFromCsv } from './press.mjs';

const root = import.meta.dirname;

async function csvText(file) {
  if (file) return readFile(path.resolve(file), 'utf8');
  const wrangler = await readFile(path.join(root, 'wrangler.jsonc'), 'utf8');
  const url = process.env.PRESS_CSV_URL || /"PRESS_CSV_URL"\s*:\s*"([^"]*)"/.exec(wrangler)?.[1];
  if (!url) throw new Error('PRESS_CSV_URL is empty: set it in wrangler.jsonc (README, "Press"), or pass a CSV file.');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`The sheet answered ${response.status}.`);
  return response.text();
}

const { items, problems } = pressFromCsv(await csvText(process.argv[2]));
for (const problem of problems) console.warn(`Left out: ${problem}`);
if (!items.length) {
  console.error('No rows to keep, so press/press.json is unchanged.');
  process.exit(1);
}
// One row per line, in the sheet's column order, so a change shows up as a one-line diff.
const lines = items.map((item) => '  ' + JSON.stringify(Object.fromEntries(PRESS_COLUMNS.map((column) => [column, item[column]]))));
await writeFile(path.join(root, 'press', 'press.json'), `[\n${lines.join(',\n')}\n]\n`);
const count = (test) => items.filter(test).length;
console.log(`press/press.json: ${items.length} rows, ${count((item) => item.featured)} featured, ${count((item) => item.wallet_only)} wallet-only.`);
