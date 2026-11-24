// The Donate button wording test (started 2026-11-24). Every Donate button on songaday.studio,
// in the universe bar (bar.js) and in the studio header on other sites (header.js) shows one of
// WORDS. A visitor keeps the same wording on every page: on songaday.studio the Worker picks it
// and keeps it in a cookie (donate-test.mjs); on other sites the bar or header keeps it in that
// site's localStorage.
//
// What gets counted, and nothing else: one "view" per page load and one "click" per press of a
// Donate button, each with its wording, which button and which site. No cookie or id goes with
// it, and the Worker adds each to a daily total (donate_counts) without keeping the request.
// The totals are at songaday.studio/commission/admin/donate-test.
//
// To end the test, set RUNNING to false: every button says "Donate" again and nothing is sent.
// To keep a winner, make it the only entry of WORDS under key "a".

export const RUNNING = true;

export const WORDS = {
  a: 'Donate',
  b: 'Be my best friend',
  c: 'Blood sacrifice',
  d: 'Get a tax break'
};

// Which button: the studio header, the black band on the home and story pages, the footer link,
// the universe bar, and the studio header on another site.
export const PLACES = ['header', 'band', 'footer', 'bar', 'studio-header'];

export const HIT_URL = 'https://songaday.studio/donate-test/hit';
const KEY = 'songaday-donate-words';

export const isWords = (value) => typeof value === 'string' && Object.hasOwn(WORDS, value);

// A wording for a new visitor, every one equally likely.
export function pickWords(random = Math.random) {
  const keys = Object.keys(WORDS);
  return keys[Math.min(keys.length - 1, Math.floor(random() * keys.length))];
}

// The wording in this browser on another site: ?donate_words=c to look at one, then what this
// site's storage remembers, then a new pick. Without storage it picks once per page load.
export function browserWords() {
  if (!RUNNING) return 'a';
  let words = null;
  try {
    const asked = new URLSearchParams(location.search).get('donate_words');
    words = isWords(asked) ? asked : localStorage.getItem(KEY);
    if (!isWords(words)) words = pickWords();
    localStorage.setItem(KEY, words);
  } catch {
    words = isWords(words) ? words : pickWords();
  }
  return words;
}

// One count. sendBeacon goes out even as the page is leaving, and a plain-text body needs no
// CORS check from another site. The answer is never read. A songaday.studio page counts on its
// own address, so a local copy of the site counts locally.
export function count(event, words, place = '', url = HIT_URL) {
  if (!RUNNING) return;
  const body = JSON.stringify({ event, words, place, site: location.hostname.replace(/^www\./, '') });
  try {
    if (navigator.sendBeacon?.(url, body)) return;
  } catch {}
  try {
    fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors', credentials: 'omit' }).catch(() => {});
  } catch {}
}

// For bar.js and header.js: the wording their Donate button shows, counted as a view and its
// presses as clicks. On a songaday.studio page the Worker has already chosen (data-donate-words)
// and donate-page.js counts the view, so the button only adds its clicks.
export function wireButton(button, place) {
  const chosen = document.querySelector('[data-donate-words]')?.getAttribute('data-donate-words');
  const words = isWords(chosen) ? chosen : browserWords();
  button.textContent = WORDS[words];
  if (!RUNNING) return;
  const url = isWords(chosen) ? '/donate-test/hit' : HIT_URL;
  if (!isWords(chosen)) count('view', words);
  button.addEventListener('click', () => count('click', words, place, url));
}

// For songaday.studio's own pages (donate-page.js): count the view and every Donate press.
export function watchPage() {
  const buttons = [...document.querySelectorAll('[data-donate][data-donate-words]')];
  if (!RUNNING || !buttons.length) return;
  const words = buttons[0].getAttribute('data-donate-words');
  if (!isWords(words)) return;
  const url = '/donate-test/hit';
  count('view', words, '', url);
  for (const button of buttons) {
    const place = button.getAttribute('data-donate');
    button.addEventListener('click', () => count('click', words, PLACES.includes(place) ? place : '', url));
  }
}
