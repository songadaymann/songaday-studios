// Refreshes press/press.json, the press page's built-in snapshot, from the press sheet's Public
// tab. The live page doesn't need this (the Worker reads the sheet), but the snapshot is what
// shows when the sheet can't be read, and the live sheet must keep at least half its rows.
//
//   node update-press.mjs              # the published CSV at PRESS_CSV_URL (env, or wrangler.jsonc)
//   node update-press.mjs public.csv   # a CSV downloaded from the Public tab
//
// It lists each row it leaves out and why, and each project no group in press.mjs lists (those
// rows show under Other). Then node build-production.mjs and wrangler deploy.
// Because the snapshot is the safety net, it refuses to shrink it below half its rows (pass
// --allow-shrink when rows were removed on purpose), or to show everyone a row that was
// wallet-only (pass --allow-wallet-change when that's on purpose).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRESS_COLUMNS, PRESS_OTHER, pressFromCsv, pressMinimum, pressProjectGroup } from './press.mjs';

const root = import.meta.dirname;
const snapshotFile = path.join(root, 'press', 'press.json');
const args = process.argv.slice(2);
const [file] = args.filter((arg) => !arg.startsWith('--'));

async function csvText() {
  if (file) return readFile(path.resolve(file), 'utf8');
  const wrangler = await readFile(path.join(root, 'wrangler.jsonc'), 'utf8');
  const url = process.env.PRESS_CSV_URL || /"PRESS_CSV_URL"\s*:\s*"([^"]*)"/.exec(wrangler)?.[1];
  if (!url) throw new Error('PRESS_CSV_URL is empty: set it in wrangler.jsonc (README, "Press"), or pass a CSV file.');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`The sheet answered ${response.status}.`);
  return response.text();
}

function refuse(message) {
  console.error(`${message} press/press.json is unchanged.`);
  process.exit(1);
}

const { items, problems } = pressFromCsv(await csvText());
for (const problem of problems) console.warn(`Left out: ${problem}`);
const ungrouped = [...new Set(items.filter((item) => pressProjectGroup(item.project) === PRESS_OTHER).map((item) => item.project))];
if (ungrouped.length) {
  console.warn(`Under Other on the page until PRESS_PROJECTS in press.mjs lists ${ungrouped.length === 1 ? 'it' : 'them'}: ${ungrouped.map((project) => JSON.stringify(project)).join(', ')}.`);
}
if (!items.length) refuse('No rows to keep.');

const old = JSON.parse(await readFile(snapshotFile, 'utf8'));
if (items.length < pressMinimum(old.length) && !args.includes('--allow-shrink')) {
  refuse(`Only ${items.length} rows, down from ${old.length}. If rows were removed on purpose, run again with --allow-shrink.`);
}
const walletOnly = new Set(old.filter((entry) => entry.wallet_only).map((entry) => entry.id));
const unwalleted = items.filter((item) => walletOnly.has(item.id) && !item.wallet_only).map((item) => item.id);
if (unwalleted.length && !args.includes('--allow-wallet-change')) {
  refuse(`${unwalleted.join(', ')} ${unwalleted.length === 1 ? 'was' : 'were'} wallet-only and would now show to everyone. If that's on purpose, run again with --allow-wallet-change.`);
}

// One row per line, in the sheet's column order, so a change shows up as a one-line diff.
const lines = items.map((item) => '  ' + JSON.stringify(Object.fromEntries(PRESS_COLUMNS.map((column) => [column, item[column]]))));
await writeFile(snapshotFile, `[\n${lines.join(',\n')}\n]\n`);
const count = (test) => items.filter(test).length;
console.log(`press/press.json: ${items.length} rows, ${count((item) => item.featured)} featured, ${count((item) => item.wallet_only)} wallet-only.`);
