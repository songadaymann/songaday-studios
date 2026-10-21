// The Song A Day universe bar: a 36px strip linking every Song A Day site to the others. Any
// site adds it with one tag (data-here is the verb of the site it's on, from projects.json):
//
//   <script type="module" src="https://songaday.studio/bar/v1/bar.js" data-here="listen" defer></script>
//
// It goes at the top of <body>, or into a <songaday-bar> element if the page has one (give that
// element `display: block; height: 36px` and the page doesn't move when the bar arrives). It
// draws in its own shadow DOM, so it can't restyle the page or be restyled by it. The links come
// from https://songaday.studio/projects.json; if that can't load, the built-in list below is
// used, so a studio outage leaves a slightly stale bar, never a broken page. It makes no other
// requests. "v1" is pinned: changes that could break a host page get a new version folder.

const STUDIO = 'https://songaday.studio';
const PROJECTS_URL = new URL('/projects.json', import.meta.url);

// The bar's projects as of the last bar release, for when projects.json can't load.
export const FALLBACK = [
  { verb: 'listen', label: 'Listen', href: 'https://songaday.studio/listen', crypto: false },
  { verb: 'see', label: 'See all', href: 'https://songaday.studio/all', crypto: false },
  { verb: 'play', label: 'Play', href: 'https://songaday.studio/games', crypto: false },
  { verb: 'get-a-song', label: 'Get a song', href: 'https://songaday.studio/commission', crypto: false },
  { verb: 'collect', label: 'Collect', href: 'https://songaday.world/', crypto: true }
];

// Same count as song-day.mjs: January 1, 2009 is Song A Day #1, by Jonathan's New York date.
export function songADayNumber(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  const currentDay = Date.UTC(value('year'), value('month') - 1, value('day'));
  return Math.floor((currentDay - Date.UTC(2009, 0, 1)) / 86400000) + 1;
}

const isHttps = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

// The bar's links from projects.json: live projects marked inBar, in the order of the verbs.
// Short addresses go through songaday.studio, like the studio's own links. Anything malformed is
// skipped; an empty result means "use the fallback".
export function barItems(data) {
  if (!data || !Array.isArray(data.verbs) || !Array.isArray(data.projects)) return [];
  const order = (verb) => data.verbs.indexOf(verb);
  return data.projects
    .filter((project) => project && project.inBar === true && typeof project.barLabel === 'string'
      && ['active', 'seasonal', 'lab'].includes(project.status) && order(project.verb) >= 0)
    .map((project) => ({
      verb: project.verb,
      label: project.barLabel.slice(0, 24),
      href: typeof project.path === 'string' && /^\/[a-z0-9/-]*$/.test(project.path) ? STUDIO + project.path : project.url,
      crypto: project.crypto === true
    }))
    .filter((item) => isHttps(item.href))
    .sort((a, b) => order(a.verb) - order(b.verb));
}

export const supportHref = (hostname) => `${STUDIO}/?from=${encodeURIComponent(hostname)}#donate`;

// WALLET DETECT START: wallet-detect.js from the crypto-wallet-gate skill (wallet/wallet-detect.js
// in this repo), unchanged; tests/bar.test.mjs keeps them in step.
let pending=null;
const none=Object.freeze({hasWallet:false,evm:false,solana:false,names:[]});

function detectWallet({timeout=600}={}){
  pending??=Promise.resolve(window.mannCool?.wallets?.detect?.()??listen(timeout)).catch(()=>none);
  return pending;
}

async function listen(timeout){
  const evm=new Map(),others=[];
  const announce=e=>{const info=e.detail?.info;if(info?.name)evm.set(String(info.rdns||info.name),String(info.name));};
  const register=(...wallets)=>{others.push(...wallets);return()=>{};};
  const registered=e=>{try{e.detail?.({register});}catch{}};
  window.addEventListener('eip6963:announceProvider',announce);window.addEventListener('wallet-standard:register-wallet',registered);
  try{window.dispatchEvent(new Event('eip6963:requestProvider'));window.dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:{register}}));}catch{}
  await new Promise(resolve=>setTimeout(resolve,timeout));
  window.removeEventListener('eip6963:announceProvider',announce);window.removeEventListener('wallet-standard:register-wallet',registered);
  try{if(!evm.size&&window.ethereum)evm.set('injected','Ethereum wallet');}catch{}
  let solana=others.some(w=>Array.isArray(w?.chains)&&w.chains.some(c=>String(c).startsWith('solana:')));
  try{solana||=Boolean(window.phantom?.solana||window.solflare||window.backpack||window.solana);}catch{}
  const names=[...new Set([...evm.values(),...others.map(w=>String(w?.name||'')).filter(Boolean)])].slice(0,8);
  return {hasWallet:evm.size>0||solana||names.length>0,evm:evm.size>0,solana,names};
}
// WALLET DETECT END

// ?crypto=1 / ?crypto=0 force the crypto parts on or off and ?crypto=auto goes back to
// detection, as in the skill's wallet-gate.js (same function and storage key).
const KEY='crypto-override';

function override(){
  try{
    const q=new URLSearchParams(location.search).get('crypto');
    if(q==='auto')localStorage.removeItem(KEY);
    else if(q==='1'||q==='0')localStorage.setItem(KEY,q);
    return localStorage.getItem(KEY);
  }catch{return null;}
}

// A page with its own wallet gate (<html data-wallet>) has already answered; otherwise the bar
// listens for wallets itself. It never asks to connect and never reads an address.
async function hasWallet() {
  const page = document.documentElement.dataset.wallet;
  if (page === 'yes' || page === 'no') return page === 'yes';
  const forced = override();
  if (forced) return forced === '1';
  return (await detectWallet()).hasWallet;
}

const STYLE = `
:host { all: initial; display: block; position: relative; height: 36px; background: #000; color: #fff;
  /* The studio header's side margins, so the two line up there. */
  --edge: max(clamp(16px, 4vw, 48px), calc((100% - 1200px) / 2));
  font: 13px/36px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.bar { display: flex; align-items: center; gap: 24px; height: 36px; padding: 0 var(--edge); white-space: nowrap; }
a { color: inherit; text-decoration: none; text-underline-offset: 4px; }
a:hover, li a[aria-current="page"] { text-decoration: underline 2px #ff2445; }
a:focus-visible, button:focus-visible { outline: 2px solid #ff2445; outline-offset: 2px; }
.home { display: flex; align-items: center; gap: 8px; font-weight: 700; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ff2445; }
.by { color: rgba(255, 255, 255, .7); font-weight: 400; }
ul { margin: 0; padding: 0; list-style: none; }
.links { display: flex; }
.links li + li::before { content: "·"; margin: 0 8px; color: rgba(255, 255, 255, .5); }
.support { margin-left: auto; padding: 0 12px; border-radius: 12px; background: #e6203f; color: #fff; font-weight: 700; line-height: 24px; }
.support:hover, .support:focus-visible { background: #fff; color: #000; text-decoration: none; }
.menu-toggle { display: none; width: 36px; height: 36px; margin: 0 -6px 0 auto; padding: 0; border: 0; background: none; color: #fff; font: inherit; font-size: 18px; line-height: 36px; cursor: pointer; }
.menu { position: absolute; top: 36px; right: var(--edge); z-index: 2147483000; min-width: 200px; padding: 6px 0; border: 1px solid rgba(255, 255, 255, .3); background: #000; }
.menu[hidden] { display: none; }
.menu a { display: block; padding: 0 16px; line-height: 40px; }
@media (min-width: 760px) { .menu { display: none; } }
@media (max-width: 899px) { .by { display: none; } }
@media (max-width: 759px) {
  .bar { gap: 12px; }
  .dot { display: none; }
  .name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .links { display: none; }
  .menu-toggle { display: block; }
  .support { margin-left: 0; }
}
`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function define() {
  class SongadayBar extends HTMLElement {
    #items = FALLBACK;
    #wallet = false;
    #here = '';
    #root;

    connectedCallback() {
      if (this.#root) return;
      this.#here = this.dataset.here || ownScript()?.dataset.here || '';
      this.#root = this.attachShadow({ mode: 'open' });
      if ('adoptedStyleSheets' in this.#root && 'replaceSync' in CSSStyleSheet.prototype) {
        // A constructed sheet still works on pages whose CSP blocks inline <style>.
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(STYLE);
        this.#root.adoptedStyleSheets = [sheet];
      } else {
        this.#root.append(element('style', '', STYLE));
      }

      const home = element('a', 'home');
      home.href = `${STUDIO}/`;
      const dot = element('span', 'dot');
      dot.setAttribute('aria-hidden', 'true');
      home.append(dot, element('span', 'name', 'Song A Day '), element('span', 'number'), element('span', 'by', ' · by Jonathan Mann'));
      const toggle = element('button', 'menu-toggle', '☰');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'More from Song A Day');
      toggle.setAttribute('aria-controls', 'menu');
      toggle.setAttribute('aria-expanded', 'false');
      const support = element('a', 'support', 'Support');
      support.href = supportHref(location.hostname);
      if (this.#here === 'support') support.setAttribute('aria-current', 'page');
      const menu = element('ul', 'menu');
      menu.id = 'menu';
      menu.hidden = true;
      const bar = element('nav', 'bar');
      bar.setAttribute('aria-label', 'Song A Day');
      bar.append(home, element('ul', 'links'), toggle, support, menu);
      this.#root.append(bar);
      this.#renderNumber();
      this.#renderLinks();

      toggle.addEventListener('click', () => this.#toggleMenu(menu.hidden));
      document.addEventListener('pointerdown', (event) => {
        if (!event.composedPath().includes(this)) this.#toggleMenu(false);
      });
      this.#root.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || menu.hidden) return;
        this.#toggleMenu(false);
        toggle.focus();
      });
      // The number changes at midnight in New York, so check every minute and on coming back.
      setInterval(() => this.#renderNumber(), 60000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.#renderNumber();
      });
      window.addEventListener('wallet-gate', (event) => this.#setWallet(Boolean(event.detail?.hasWallet)));
      this.#load();
    }

    async #load() {
      const [items, wallet] = await Promise.all([loadItems(), hasWallet().catch(() => false)]);
      if (items.length) this.#items = items;
      this.#wallet ||= wallet;
      this.#renderLinks();
    }

    #setWallet(wallet) {
      if (wallet === this.#wallet) return;
      this.#wallet = wallet;
      this.#renderLinks();
    }

    #toggleMenu(open) {
      this.#root.querySelector('.menu').hidden = !open;
      this.#root.querySelector('.menu-toggle').setAttribute('aria-expanded', String(open));
    }

    #renderNumber() {
      this.#root.querySelector('.number').textContent = `#${songADayNumber().toLocaleString('en-US')}`;
    }

    // The same links twice: in the strip on wide screens, in the menu on phones.
    #renderLinks() {
      const items = this.#items.filter((item) => !item.crypto || this.#wallet);
      for (const list of this.#root.querySelectorAll('.links, .menu')) {
        list.replaceChildren(...items.map((item) => {
          const link = element('a', '', item.label);
          link.href = item.href;
          if (item.verb === this.#here) link.setAttribute('aria-current', 'page');
          const li = element('li');
          li.append(link);
          return li;
        }));
      }
    }
  }
  customElements.define('songaday-bar', SongadayBar);
}

// The <script> tag that loaded this module (module scripts have no document.currentScript).
function ownScript() {
  return [...document.querySelectorAll('script[src]')].find((script) => script.src === import.meta.url);
}

async function loadItems() {
  try {
    const response = await fetch(PROJECTS_URL, { credentials: 'omit', signal: AbortSignal.timeout?.(5000) });
    if (!response.ok) return [];
    return barItems(await response.json());
  } catch {
    return [];
  }
}

if (typeof window !== 'undefined' && window.customElements && !customElements.get('songaday-bar')) {
  define();
  const place = () => {
    if (document.querySelector('songaday-bar')) return;
    const bar = document.createElement('songaday-bar');
    // After a skip link that comes first, so it still comes first.
    const first = document.body.firstElementChild;
    if (first?.matches('a[href^="#"]')) first.after(bar);
    else document.body.prepend(bar);
  };
  if (document.body) place();
  else document.addEventListener('DOMContentLoaded', place, { once: true });
}
