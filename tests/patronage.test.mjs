import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MONTHLY_GOALS, dollars } from '../patronage.mjs';

const root = new URL('../', import.meta.url);

test('the donation ask names the first goal beside the form, and the goals come from one place', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'songaday-studio-goal-'));
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('build.mjs', root)), '--out', out], {
      env: { ...process.env, SONGADAY_OFFLINE: '1' }
    });
    const home = await readFile(path.join(out, 'index.html'), 'utf8');
    const first = dollars(MONTHLY_GOALS.first);
    const dream = dollars(MONTHLY_GOALS.dream);
    assert.equal(first, '$3,000');
    assert.equal(dream, '$20,000');
    assert.ok(MONTHLY_GOALS.first < MONTHLY_GOALS.dream);

    // Beside the form: the ask, then the goal with the tax line, then the form itself.
    const donate = home.match(/<section class="hero-donate" id="donate"[\s\S]*?<\/section>/)[0];
    assert.match(donate, /<h2 id="donate-title">Become a monthly supporter, or donate\.<\/h2>\s*<p>First goal: \$3,000 a month\. It’s all tax deductible\.<\/p>/);
    assert.ok(donate.indexOf('First goal:') < donate.indexOf('data-zeffy-embed'), 'the goal comes before the form');

    // The Patronage section's ladder shows the same two figures.
    const ladder = home.match(/<dl class="patronage-match" id="goal"[\s\S]*?<\/dl>/)[0];
    assert.deepEqual([...ladder.matchAll(/<dd>(\$[\d,]+)<span class="patronage-match-unit">\/month<\/span><\/dd>/g)].map((match) => match[1]), [first, dream]);
    assert.doesNotMatch(home, /\{\{GOAL_/);

    // The bio link page is a static file, so its copy is checked against the same figure.
    const links = await readFile(new URL('links/index.html', root), 'utf8');
    assert.ok(links.includes(`Become a monthly supporter. First goal: ${first} a month.`));

    // Goals only: no running total and no progress bar anywhere on the home page.
    const visible = home.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(visible, /<progress|role="progressbar"|raised so far|a month so far|\bof \$3,000\b/i);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
