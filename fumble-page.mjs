// The HTML for songaday.studio/fumble (see fumble.mjs). Its site header is a copy of the one in
// profile.html; tests/fumble.test.mjs checks their section links match.
import { STORY_MAX, STORY_MIN } from './fumble.mjs';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const paragraphs = (text) => text.split(/\n{2,}/)
  .map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`).join('\n      ');

const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric'
});

function excerpt(text, length = 160) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length <= length ? flat : flat.slice(0, length - 1).replace(/\s+\S*$/, '') + '…';
}

function exhibit(story, single) {
  const href = `/fumble/${story.number}`;
  const title = single ? `<h1>Fumble No. ${story.number}</h1>` : `<h2><a href="${href}">Fumble No. ${story.number}</a></h2>`;
  const painting = story.image_key
    ? `<a class="frame" href="${href}"><img src="/fumble/images/${escapeHtml(story.image_key)}" alt="${escapeHtml(story.image_alt)}" width="1024" height="1024"${single ? '' : ' loading="lazy"'}></a>`
    : '';
  return `<article class="exhibit${painting ? '' : ' unpainted'}" id="no-${story.number}">
    ${painting}
    <div class="label">
      ${title}
      <p class="meta">Anonymous${painting ? ' · Oil on regret' : ''} · <time datetime="${escapeHtml(story.published_at.slice(0, 10))}">${longDate(story.published_at)}</time></p>
      ${paragraphs(story.story)}
    </div>
  </article>`;
}

function tellForm({ siteKey, closed, sent, error, draft }) {
  if (sent) return `<p class="thanks" id="tell">${THANKS}</p>`;
  if (closed || !siteKey) return '<p class="thanks" id="tell">Posting is closed right now. Try again later.</p>';
  return `<form class="tell" id="tell" method="post" action="/fumble">
      <label class="hidden" for="fumble-story">Your fumble</label>
      <textarea id="fumble-story" name="story" rows="7" minlength="${STORY_MIN}" maxlength="${STORY_MAX}" required placeholder="I sold my Apple stock in 2003 to buy a used Civic…">${escapeHtml(draft)}</textarea>
      <input class="trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-action="fumble" data-theme="dark" data-appearance="interaction-only" data-callback="fumbleChecked" data-expired-callback="fumbleExpired"></div>
      <div class="send">
        <button type="submit">Post anonymously</button>
        <p class="fine">No names, links, or anything that could identify you. By posting, you’re OK with Song A Day sharing your story and writing songs about it.</p>
      </div>
      <p class="status" id="fumble-status" role="status">${escapeHtml(error)}</p>
    </form>`;
}

const THANKS = 'Got it. Your fumble goes up once Jonathan has read it.';

// Posts with fetch so a problem doesn't lose the story. Turnstile usually passes without
// showing anything; if someone clicks before it has, the post waits for it.
const SCRIPT = `(() => {
  const form = document.getElementById('tell');
  if (!form || form.tagName !== 'FORM') return;
  const status = document.getElementById('fumble-status');
  const button = form.querySelector('button');
  let waiting = false;
  const say = (text) => { status.textContent = text; };
  const token = () => form.querySelector('[name="cf-turnstile-response"]')?.value;
  async function send() {
    waiting = false;
    button.disabled = true;
    say('Posting…');
    try {
      const response = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (result.ok) {
        const done = document.createElement('p');
        done.className = 'thanks';
        done.id = 'tell';
        done.textContent = \`${THANKS}\`;
        window.turnstile?.remove();
        form.replaceWith(done);
        return;
      }
      say(result.error || 'That didn’t go through. Try again.');
    } catch {
      say('That didn’t go through. Try again.');
    }
    button.disabled = false;
    window.turnstile?.reset();
  }
  window.fumbleChecked = () => { if (waiting) send(); };
  window.fumbleExpired = () => window.turnstile?.reset();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (token()) return send();
    waiting = true;
    say('Checking you’re human…');
  });
})();`;

const STYLE = `
:root {
  --wall: #4a1519; --paper: #f3ead8; --dim: #d8c6a4; --ink: #1d1612;
  --gold: #c9a24a; --gold-light: #e6c97c; --gold-dark: #5c4318;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--wall); color: var(--paper); font: 400 18px/1.55 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif; }
a { color: inherit; text-underline-offset: .2em; }
a:focus-visible, button:focus-visible, textarea:focus-visible { outline: 3px solid var(--gold-light); outline-offset: 3px; }
.museum { max-width: 1080px; margin: 0 auto; padding: 64px 16px 96px; }
h1 { margin: 0 0 16px; font-size: 36px; font-weight: 400; line-height: 1.15; }
h1 a { text-decoration: none; }
h2 { margin: 0; font-size: 18px; }
h2 a { text-decoration: none; }
h2 a:hover { text-decoration: underline; }
.entrance > p { max-width: 34em; margin: 0 0 32px; }
.tell { max-width: 40em; }
textarea { display: block; width: 100%; padding: 14px 16px; border: 0; border-radius: 0; background: var(--paper); color: var(--ink); font: inherit; resize: vertical; }
textarea::placeholder { color: #7a6a58; }
.cf-turnstile { margin-top: 16px; }
.send { display: flex; gap: 20px; align-items: flex-start; margin-top: 16px; }
button { flex: none; padding: 15px 20px; border: 0; border-radius: 0; background: var(--gold); color: var(--ink); font: 700 13px/1 "Avenir Next", "Helvetica Neue", Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
button:hover { background: var(--gold-light); }
button:disabled { background: var(--dim); cursor: wait; }
.fine, .meta, .status { font-size: 13px; line-height: 1.5; }
.fine { margin: 0; color: var(--dim); }
.status { margin: 16px 0 0; }
.thanks { margin: 0; }
.status:empty { display: none; }
.hidden, .trap { position: absolute; font: inherit; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.collection { margin-top: 80px; padding-top: 80px; border-top: 1px solid var(--gold-dark); }
.collection > p { margin: 0; }
.exhibit { display: grid; grid-template-columns: minmax(0, 480px) minmax(0, 1fr); gap: 56px; align-items: center; margin-bottom: 112px; }
.exhibit.unpainted { grid-template-columns: minmax(0, 36em); }
.frame { display: block; border: 14px solid var(--gold); box-shadow: 0 0 0 3px var(--gold-dark), 0 0 0 5px var(--gold-light); margin: 5px; }
.frame img { display: block; width: 100%; height: auto; border: 3px solid var(--gold-dark); background: var(--ink); }
.label { max-width: 34em; }
.label p { margin: 0 0 1em; }
.label .meta { margin: 4px 0 20px; color: var(--dim); }
.single .exhibit { margin-bottom: 64px; }
.single .label h1 { margin-bottom: 0; }
.older { display: inline-block; margin-top: -48px; }
.back { margin: 0 0 80px; }

@media (max-width: 760px) {
  .museum { padding: 40px 16px 72px; }
  .send { flex-direction: column; }
  .collection { margin-top: 56px; padding-top: 56px; }
  .exhibit { grid-template-columns: minmax(0, 1fr); gap: 32px; margin-bottom: 80px; }
  .frame { border-width: 10px; }
}

/* The songaday.studio site header, kept in step with profile.html and profile.css. */
.site-header {
  --red: #ff2445;
  position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: clamp(1rem, 2.5vw, 2rem);
  min-height: 68px; padding: .5rem max(clamp(1rem, 4vw, 3rem), calc((100% - 1200px) / 2)); border-bottom: 4px solid var(--red); background: #000; color: #fff;
  font: 400 16px/1.5 "Aperçu", "Apercu", "Avenir Next", "Helvetica Neue", Arial, sans-serif;
}
.site-header a { color: inherit; text-underline-offset: .2em; }
.site-header a:focus-visible { outline: 4px solid var(--red); outline-offset: 4px; }
.site-header .brand { display: flex; flex: none; align-items: center; gap: .7rem; margin-right: auto; font-size: 16px; font-weight: 700; letter-spacing: .02em; text-decoration: none; white-space: nowrap; }
.site-header .brand-mark { width: 44px; height: 44px; object-fit: contain; transform: rotate(-5deg); }
.site-header .brand-dot { color: var(--red); }
.site-sections { display: flex; align-items: center; gap: clamp(1rem, 2.2vw, 1.75rem); }
.site-sections a { display: inline-flex; align-items: center; min-height: 44px; border-bottom: 2px solid transparent; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-decoration: none; text-transform: uppercase; white-space: nowrap; }
.site-sections a:hover { border-bottom-color: var(--red); }
.site-header .nav-out { margin-left: .25em; font-weight: 400; opacity: .6; }
.site-header .nav-donate { flex: none; padding: .8rem 1.15rem; background: #e6203f; color: #fff; font-size: 13px; font-weight: 700; letter-spacing: .06em; line-height: 1; text-decoration: none; text-transform: uppercase; }
.site-header .nav-donate:hover { background: #fff; color: #000; }
@media (max-width: 760px) {
  .site-header { top: -41px; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "sections sections" "brand donate"; gap: 0 .75rem; min-height: 0; padding: 0 16px .55rem; }
  .site-header:focus-within { top: 0; }
  .site-sections { grid-area: sections; gap: 1.1rem; height: 41px; margin: 0 -16px .55rem; padding: 0 16px; border-bottom: 1px solid #2a2a2a; overflow-x: auto; scrollbar-width: none; }
  .site-sections::-webkit-scrollbar { display: none; }
  .site-sections a { flex: none; min-height: 40px; font-size: 12px; letter-spacing: .05em; }
  .site-header .brand { grid-area: brand; min-width: 0; gap: .55rem; font-size: 14px; }
  .site-header .brand-mark { width: 34px; height: 34px; }
  .site-header .nav-donate { grid-area: donate; align-self: center; padding: .75rem .95rem; font-size: 12px; }
}
`;

const HEADER = `<header class="site-header">
  <a class="brand" href="/" aria-label="Song A Day Studio home">
    <img class="brand-mark" src="/assets/icons/tunes.png" alt="" width="50" height="50">
    <span class="brand-word">SONG A DAY<span class="brand-dot">.</span> STUDIO</span>
  </a>
  <nav class="site-sections" aria-label="Sections">
    <a href="/all">All songs<span class="nav-out" aria-hidden="true">↗</span></a>
    <a href="/listen">Listen<span class="nav-out" aria-hidden="true">↗</span></a>
    <a href="/games">Games<span class="nav-out" aria-hidden="true">↗</span></a>
    <a href="/films/">Films</a>
    <a href="/plugins/">Plugins</a>
    <a href="/commission">Get a song<span class="nav-out" aria-hidden="true">↗</span></a>
  </nav>
  <a class="nav-donate" href="/#donate">Donate</a>
</header>`;

const MUSEUM = 'The Museum of Fumbled Bags';
const INTRO = 'Sold too early, bought the top, tossed the shoebox of baseball cards? Tell it here, anonymously. Jonathan reads every story, and each one he hangs gets a painting.';

export function renderFumblePage({
  origin, siteKey, nonce, stories = [], single = false, olderThan = null,
  sent = false, closed = false, missing = false, error = '', draft = ''
}) {
  const story = single ? stories[0] : null;
  const title = story ? `Fumble No. ${story.number}` : MUSEUM;
  const description = story ? excerpt(story.story) : 'Anonymous stories of fumbled bags, each with its own painting. Tell yours.';
  const canonical = `${origin}/fumble${story ? '/' + story.number : ''}`;
  const image = (story ?? stories[0])?.image_key;
  const form = tellForm({ siteKey, closed, sent, error, draft });

  let main;
  if (missing) {
    main = `<section class="entrance">
    <h1><a href="/fumble">${MUSEUM}</a></h1>
    <p>That fumble isn’t on the walls. <a href="/fumble">See the whole collection.</a></p>
  </section>`;
  } else if (story) {
    main = `${exhibit(story, true)}
  <p class="back"><a href="/fumble">See the whole collection</a></p>
  <section class="entrance">
    <p>${INTRO}</p>
    ${form}
  </section>`;
  } else {
    const walls = stories.length
      ? stories.map((item) => exhibit(item, false)).join('\n  ')
      : '<p>Nothing on the walls yet.</p>';
    const older = olderThan ? `\n    <a class="older" href="/fumble?before=${olderThan}">Older fumbles</a>` : '';
    main = `<section class="entrance">
    <h1>${MUSEUM}</h1>
    <p>${INTRO}</p>
    ${form}
  </section>
  <section class="collection" aria-label="The collection">
  ${walls}${older}
  </section>`;
  }

  const turnstile = !missing && !sent && !closed && siteKey
    ? `\n<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Song A Day Studio</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">${image ? `
<meta property="og:image" content="${escapeHtml(`${origin}/fumble/images/${image}`)}">
<meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="/assets/icons/tunes.png">
<style>${STYLE}</style>
</head>
<body>
${HEADER}
<main class="museum${story ? ' single' : ''}">
  ${main}
</main>${turnstile}
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>
`;
}
