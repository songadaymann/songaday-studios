// The Song A Day Studio header for the other Song A Day sites: the same menu songaday.studio's
// own pages have, so moving from the studio to a site that is one of its sections (the games on
// mann.cool) doesn't look like leaving. A site adds it with one tag; data-here is its section:
//
//   <script type="module" src="https://songaday.studio/bar/v1/header.js" data-here="games" defer></script>
//
// It goes at the top of <body>, or into a <songaday-header> element if the page has one. To keep
// the page still while it loads, give that element the header's height in the page's own CSS:
//
//   songaday-header { display: block; min-height: 68px; background: #000; }
//   @media (max-width: 1100px) { songaday-header { min-height: 101px; } }
//
// It takes the place of the universe bar (bar.js) on that site; a page shows one or the other.
// It draws in its own shadow DOM, so it can't restyle the page or be restyled by it, and it
// makes no requests: the sections below are the studio's own menu (tests/header.test.mjs keeps
// them in step with it). Like the studio's header it stays at the top while the page scrolls;
// a page that would rather it scrolled away sets `songaday-header { position: static; }`.
// "v1" is pinned: changes that could break a host page get a new version folder.

const STUDIO = 'https://songaday.studio';

// The studio's menu. `leaves` marks a section that opens a site without this header, which the
// studio's own menu shows with an arrow.
export const SECTIONS = [
  { id: 'songs', label: 'All songs', path: '/gallery/' },
  { id: 'listen', label: 'Listen', path: '/listen', leaves: true },
  { id: 'games', label: 'Games', path: '/games' },
  { id: 'films', label: 'Films', path: '/films/' },
  { id: 'plugins', label: 'Plugins', path: '/plugins/' },
  { id: 'get-a-song', label: 'Get a song', path: '/commission' },
  { id: 'store', label: 'Store', path: '/store/' }
];

export const donateHref = (hostname) => `${STUDIO}/?from=${encodeURIComponent(hostname)}#donate`;

// The studio header's styles (studio-chrome.css) in pixels, since a host page may size its rem
// differently. tests/header.test.mjs checks the two heights the comment above promises.
const STYLE = `
:host { all: initial; display: block; position: sticky; top: 0; z-index: 20; background: #000; color: #fff;
  --gutter: clamp(16px, 4vw, 48px); --edge: max(var(--gutter), calc((100% - 1200px) / 2));
  font: 400 16px/1.5 "Aperçu", "Apercu", "Avenir Next", "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
header { display: flex; align-items: center; gap: clamp(16px, 2.5vw, 32px); min-height: 68px; padding: 8px var(--edge); border-bottom: 4px solid #ff2445; }
a { color: inherit; text-decoration: none; }
a:focus-visible { outline: 4px solid #ff2445; outline-offset: 4px; }
.brand { display: flex; flex: none; align-items: center; gap: 11px; margin-right: auto; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
.brand img { width: 44px; height: 44px; object-fit: contain; transform: rotate(-5deg); }
.dot { color: #ff2445; }
nav { display: flex; align-items: center; gap: clamp(16px, 2.2vw, 28px); }
nav a { display: inline-flex; align-items: center; min-height: 44px; border-bottom: 2px solid transparent; font-size: 14px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
nav a:hover, nav a[aria-current="page"] { border-bottom-color: #ff2445; }
.out { margin-left: .25em; color: #999; font-weight: 400; }
.donate { flex: none; padding: 13px 18px; background: #e6203f; font-size: 14px; font-weight: 700; letter-spacing: .06em; line-height: 1; text-transform: uppercase; }
.donate:hover { background: #fff; color: #000; }
/* Compact, as on the studio: the sections scroll sideways above the name, and scroll away. */
@media (max-width: 1100px) {
  :host { top: -41px; }
  :host(:focus-within) { top: 0; }
  header { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "sections sections" "brand donate"; gap: 0 12px; min-height: 101px; padding: 0 var(--gutter) 9px; }
  nav { grid-area: sections; gap: 18px; height: 41px; margin: 0 calc(-1 * var(--gutter)) 9px; padding: 0 var(--gutter); border-bottom: 1px solid #2a2a2a; overflow-x: auto; scrollbar-width: none; }
  nav::-webkit-scrollbar { display: none; }
  nav a { flex: none; min-height: 40px; letter-spacing: .05em; }
  .brand { grid-area: brand; min-width: 0; gap: 9px; font-size: 14px; }
  .brand img { width: 34px; height: 34px; }
  .donate { grid-area: donate; align-self: center; padding: 12px 15px; }
}
`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function define() {
  class SongadayHeader extends HTMLElement {
    #root;

    connectedCallback() {
      if (this.#root) return;
      const here = this.dataset.here || ownScript()?.dataset.here || '';
      this.#root = this.attachShadow({ mode: 'open' });
      if ('adoptedStyleSheets' in this.#root && 'replaceSync' in CSSStyleSheet.prototype) {
        // A constructed sheet still works on pages whose CSP blocks inline <style>.
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(STYLE);
        this.#root.adoptedStyleSheets = [sheet];
      } else {
        this.#root.append(element('style', '', STYLE));
      }

      const brand = element('a', 'brand');
      brand.href = `${STUDIO}/`;
      brand.setAttribute('aria-label', 'Song A Day Studio home');
      const mark = element('img');
      mark.src = `${STUDIO}/assets/icons/tunes.png`;
      mark.alt = '';
      mark.width = 50;
      mark.height = 50;
      const word = element('span', '', 'SONG A DAY');
      word.append(element('span', 'dot', '.'), ' STUDIO');
      brand.append(mark, word);

      const nav = element('nav');
      nav.setAttribute('aria-label', 'Song A Day Studio sections');
      nav.append(...SECTIONS.map((section) => {
        const link = element('a', '', section.label);
        link.href = STUDIO + section.path;
        if (section.id === here) link.setAttribute('aria-current', 'page');
        if (section.leaves && section.id !== here) {
          const arrow = element('span', 'out', '↗');
          arrow.setAttribute('aria-hidden', 'true');
          link.append(arrow);
        }
        return link;
      }));

      const donate = element('a', 'donate', 'Donate');
      donate.href = donateHref(location.hostname);

      const header = element('header');
      header.append(brand, nav, donate);
      this.#root.append(header);
    }
  }
  customElements.define('songaday-header', SongadayHeader);
}

// The <script> tag that loaded this module (module scripts have no document.currentScript).
function ownScript() {
  return [...document.querySelectorAll('script[src]')].find((script) => script.src === import.meta.url);
}

if (typeof window !== 'undefined' && window.customElements && !customElements.get('songaday-header')) {
  define();
  const place = () => {
    if (document.querySelector('songaday-header')) return;
    const header = document.createElement('songaday-header');
    // After a skip link that comes first, so it still comes first.
    const first = document.body.firstElementChild;
    if (first?.matches('a[href^="#"]')) first.after(header);
    else document.body.prepend(header);
  };
  if (document.body) place();
  else document.addEventListener('DOMContentLoaded', place, { once: true });
}
