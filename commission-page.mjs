// The HTML the Worker puts into songaday.studio/commission's built pages (build.mjs writes
// commission/index.html and commission/song.html; see commission.mjs). The buyer's private page
// is renderSongPage inside the song.html shell. Everything a buyer or Jonathan typed is escaped.
import { escapeHtml } from './fumble-page.mjs';
import { PLAN_MONTHS, PRICES } from './commission-config.mjs';
import { dollars, pagePath } from './commission-core.mjs';

const paragraphs = (text) => String(text ?? '').split(/\n{2,}/).filter(Boolean)
  .map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`).join('\n');

const longDate = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
  timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// The buyer's own answers, so they can check what they told me.
function answers(request) {
  const rows = [
    ['It’s for', request.kind === 'business' ? 'A company, brand, event or organization' : 'A person'],
    ['Who it’s for', request.recipient],
    ['What they are to you', request.relationship],
    ['The occasion', request.occasion],
    ['Names, and how to say them', request.names + (request.memo_key ? `${request.names ? '\n' : ''}(You sent a voice memo.)` : '')],
    ['Everything you told me', request.story],
    ['Leave out', request.leave_out],
    ['Deadline', request.deadline ? longDate(request.deadline) : ''],
    ['Song A Day', request.may_publish ? 'Yes, it can be public' : 'No, keep it private'],
    ['Music video', request.wants_video ? 'Yes, I’d like one' : ''],
    ['Your name', request.buyer_name],
    ['Your email', request.buyer_email]
  ].filter(([, value]) => value);
  return `<section class="commission-answers" aria-labelledby="answers-title">
  <h2 id="answers-title">What you told me</h2>
  <dl>
${rows.map(([label, value]) => `    <dt>${label}</dt>\n    <dd>${paragraphs(value)}</dd>`).join('\n')}
  </dl>
  <p class="commission-fine">Something to add or change? Reply to any of my emails.</p>
</section>`;
}

const action = (request, name, value, label, extra = '') => `<form method="post" action="${pagePath(request)}"${extra}>
      <input type="hidden" name="action" value="${name}">${value === null ? '' : `\n      <input type="hidden" name="value" value="${value}">`}
      <button type="submit">${label}</button>
    </form>`;

function updates(request) {
  return `<section class="commission-box" id="updates" aria-labelledby="updates-title">
  <h2 id="updates-title">Place-in-line emails</h2>
  ${request.quiet
    ? `<p>They’re off. I’ll still email you when your song is done.</p>\n    ${action(request, 'updates', 'on', 'Turn them back on')}`
    : `<p>I email you when you move up the line, once a day at most.</p>\n    ${action(request, 'updates', 'off', 'Turn them off')}`}
</section>`;
}

function cancel(request) {
  return `<details class="commission-cancel">
  <summary>Cancel my request</summary>
  <p>You can cancel until I start writing. You haven’t paid anything, so there’s nothing to refund.</p>
  ${action(request, 'cancel', null, 'Yes, cancel it')}
</details>`;
}

function inLine(request, { position, isNew }) {
  const writing = request.status === 'writing';
  const note = isNew ? `<p class="commission-note" role="status">Got it. I’ve emailed you a link to this page. Keep it to yourself: anyone who has it can see your page.</p>\n` : '';
  const heading = writing
    ? `<h1>I’m writing your song now.</h1>
<p class="commission-lead">It’s your turn. I’ll email you as soon as it’s done, and it’ll be right here.</p>`
    : `<h1>You’re #${position} in line.</h1>
<p class="commission-lead">I write songs in the order they come in. I’ll email you when you move up, once a day at most. When your song is done, it’ll be right here, and you’ll pay what you want, from ${dollars(request.floor_cents)}.</p>`;
  return `${note}<p class="commission-eyebrow">Your song${request.recipient ? ` for ${escapeHtml(request.recipient)}` : ''}</p>
${heading}
${writing ? '' : updates(request)}
${answers(request)}
${request.status === 'requested' ? cancel(request) : ''}`;
}

function amountChoices(request) {
  const prices = PRICES[request.kind] ?? PRICES.personal;
  const suggested = prices.suggested.filter((cents) => cents >= request.floor_cents);
  const choices = suggested.length ? suggested : [request.floor_cents];
  return choices.map((cents, index) => `<label class="commission-choice"><input type="radio" name="amount" value="${cents / 100}"${index === 0 ? ' checked' : ''}> ${dollars(cents)}</label>`).join('\n        ')
    + `\n        <label class="commission-choice commission-other"><input type="radio" name="amount" value="other"> Other: <span class="commission-dollar">$<input type="text" name="other" inputmode="numeric" autocomplete="off" aria-label="Other amount in dollars" data-floor="${request.floor_cents}"></span></label>`;
}

function payForm(request, { stripeReady, error, pending }) {
  const heading = '<h2 id="pay-title">Pay for your song</h2>';
  if (pending) {
    return `<section class="commission-box" id="pay" aria-labelledby="pay-title">
  ${heading}
  <p class="commission-note" role="status">Your payment is on its way. The download unlocks as soon as it clears.</p>
</section>`;
  }
  if (!stripeReady) {
    return `<section class="commission-box" id="pay" aria-labelledby="pay-title">
  ${heading}
  <p>Payments aren’t set up yet. I’ll email you when they are.</p>
</section>`;
  }
  const plans = PLAN_MONTHS.map((months) => `<label class="commission-choice"><input type="radio" name="plan" value="${months}"> Over ${months} months</label>`).join('\n        ');
  return `<section class="commission-box" id="pay" aria-labelledby="pay-title">
  ${heading}
  <p>Pay what you want, from ${dollars(request.floor_cents)}. Then you can download it.</p>
  ${error ? `<p class="commission-error" role="alert">${escapeHtml(error)}</p>` : ''}
  <form class="commission-pay" method="post" action="${pagePath(request)}/pay" data-pay>
    <fieldset>
      <legend>How much?</legend>
      <div class="commission-choices">
        ${amountChoices(request)}
      </div>
    </fieldset>
    <fieldset>
      <legend>How do you want to pay?</legend>
      <div class="commission-choices">
        <label class="commission-choice"><input type="radio" name="plan" value="once" checked> All at once</label>
        ${plans}
      </div>
      <p class="commission-plan-note" data-plan-note aria-live="polite"></p>
    </fieldset>
    <button type="submit">Continue to payment</button>
    <p class="commission-fine">Spread out, the download unlocks after the first payment, and the payments stop by themselves after the last one. It’s on the honor system.</p>
  </form>
</section>`;
}

function planLine(plan, paidCount) {
  const monthly = plan.monthly_cents;
  if (plan.status === 'finished') return `<p>All ${plan.months} monthly payments are done. Thank you.</p>`;
  if (plan.status === 'stopped') return '<p>Your monthly payments are stopped. The song is still yours.</p>';
  return `<p>${paidCount} of ${plan.months} monthly payments of ${dollars(monthly)} made. The rest come out once a month and stop by themselves after the last one.</p>`;
}

function paidSection(request, { payments, plans, stripeReady, error }) {
  const total = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  const active = plans.find((plan) => plan.status === 'active');
  const planLines = plans.map((plan) => planLine(plan, payments.filter((payment) => payment.subscription_id === plan.subscription_id).length)).join('\n  ');
  const stop = active ? `<details class="commission-cancel">
    <summary>Stop the rest of my payments?</summary>
    <p>The song stays yours, and the download stays unlocked.</p>
    ${action(request, 'stop-plan', null, 'Stop them')}
  </details>` : '';
  const extra = stripeReady ? `<section class="commission-box" id="extra" aria-labelledby="extra-title">
  <h2 id="extra-title">Pay what it was worth</h2>
  <p>Did the song mean more than you paid? You can add any amount.</p>
  ${error ? `<p class="commission-error" role="alert">${escapeHtml(error)}</p>` : ''}
  <form class="commission-extra" method="post" action="${pagePath(request)}/pay">
    <input type="hidden" name="plan" value="extra">
    <label class="commission-dollar">$<input type="text" name="amount" inputmode="numeric" autocomplete="off" aria-label="Amount in dollars" required></label>
    <button type="submit">Add it</button>
  </form>
</section>` : '';
  return `<section class="commission-box" id="paid" aria-labelledby="paid-title">
  <h2 id="paid-title">Thank you. The song is yours.</h2>
  <p><a class="commission-button" href="${pagePath(request)}/download">Download the song</a></p>
  ${total ? `<p>You’ve paid ${dollars(total)}.</p>` : ''}
  ${planLines}
  ${stop}
</section>
${extra}`;
}

function delivered(request, options) {
  const video = request.video_url ? `<p><a class="commission-video" href="${escapeHtml(request.video_url)}" rel="noreferrer">Watch the video</a></p>` : '';
  const lyrics = request.lyrics ? `<section class="commission-lyrics" aria-labelledby="lyrics-title">
  <h2 id="lyrics-title">Lyrics</h2>
  ${paragraphs(request.lyrics)}
</section>` : '';
  return `<p class="commission-eyebrow">Your song${request.recipient ? ` for ${escapeHtml(request.recipient)}` : ''}</p>
<h1>“${escapeHtml(request.title)}”</h1>
<p class="commission-lead">By Jonathan Mann.</p>
<audio class="commission-player" controls preload="metadata" src="${pagePath(request)}/listen"></audio>
${video}
${request.paid_at ? paidSection(request, options) : payForm(request, options)}
${lyrics}`;
}

// { title, main } for the buyer's page in its current state (design section 6's table).
export function renderSongPage(request, { payments = [], plans = [], position = null, isNew = false,
  pending = false, error = '', stripeReady = false } = {}) {
  if (request.status === 'cancelled') {
    return {
      title: 'Cancelled · Song A Day Studio',
      main: `<p class="commission-eyebrow">Your song request</p>
<h1>This request was cancelled.</h1>
<p class="commission-lead">${request.delivered_at ? 'Questions? Reply to any of my emails.' : 'If that was a mistake, reply to any of my emails and I’ll put it back, in the same place in line.'}</p>`
    };
  }
  if (request.status === 'delivered') {
    return { title: `${request.title} · Song A Day Studio`, main: delivered(request, { payments, plans, stripeReady, error, pending }) };
  }
  return { title: 'Your song · Song A Day Studio', main: inLine(request, { position, isNew }) };
}

// A short page in the same shell: not found, a problem with no JavaScript, and the like.
export function messagePage(heading, text, more = '') {
  return { title: `${heading} · Song A Day Studio`, main: `<h1>${escapeHtml(heading)}</h1>\n<p class="commission-lead">${escapeHtml(text)}</p>${more}` };
}

// Without a build (wrangler dev before node build-production.mjs, or tests with a fake ASSETS),
// the pages fall back to bare documents with the same slots, so the flow still works.
export const BARE_SONG_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Song A Day Studio</title>
</head>
<body>
<main id="main"><!--commission:song--></main>
</body>
</html>
`;

export const BARE_PUBLIC_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Get a song · Song A Day Studio</title>
</head>
<body>
<main id="main">
<h1>Get a song written for you</h1>
<p><!--commission:line--></p>
<!--commission:form--><p>The request form is in the built page: run node build-production.mjs.</p><!--/commission:form-->
</main>
</body>
</html>
`;

// The song shell with its title and main filled in. Function replacements, so a "$" in a title
// isn't read as a replacement pattern.
export function fillShell(shell, { title, main }) {
  return shell.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    .replace('<!--commission:song-->', () => main);
}

export function lineText(total) {
  if (total === null || total === undefined) return '';
  if (total === 0) return 'Nobody’s in line right now.';
  return `${total.toLocaleString('en-US')} ${total === 1 ? 'song' : 'songs'} in line right now.`;
}

// The public page's two runtime slots: the line, and the form or a closed notice.
export function fillPublicPage(html, { line, closed, siteKey }) {
  let page = html.replace('<!--commission:line-->', () => escapeHtml(lineText(line)));
  if (closed) {
    page = page.replace(/<!--commission:form-->[\s\S]*?<!--\/commission:form-->/,
      () => `<p class="commission-closed" id="request">${escapeHtml(closed)}</p>`);
  }
  return page.replaceAll('data-sitekey="commission-site-key"', () => `data-sitekey="${escapeHtml(siteKey ?? '')}"`);
}
