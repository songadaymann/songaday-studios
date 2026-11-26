// The pictures that show when a songaday.studio link is shared (og:image and twitter:image).
// `node share-images.mjs` draws one 1200x630 card per page with Google Chrome and saves it as
// assets/images/share/<name>.png; build.mjs points each page's tags at its card (SHARE_IMAGES).
// `node share-images.mjs store films` redraws just those. The words are big, one phrase is red,
// and nothing on a card goes out of date as the song count grows.
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The counts on the cards, from the files the pages are built from.
const json = (name) => JSON.parse(readFileSync(path.join(import.meta.dirname, name), "utf8"));
const albumsJson = json("store/albums.json");
const pressJson = json("press/press.json");
const ALBUMS = (albumsJson.albums || albumsJson).length;
const FIGURES = json("store/catalog.json").length;
const PRESS = (pressJson.items || pressJson).filter((item) => !item.wallet_only).length;

export const SHARE_SIZE = { width: 1200, height: 630 };
export const shareImageUrl = (name) => `https://songaday.studio/assets/images/share/${name}.png`;

// Each card: the headline, with *one phrase* in red, an optional line under it, and the words a
// screen reader gets (og:image:alt). `picture` puts one image on the right.
export const SHARE_CARDS = {
  home: {
    headline: "I’ve written a song *every day* since January 1, 2009.",
    alt: "I’ve written a song every day since January 1, 2009. Song A Day Studio.",
  },
  commission: {
    headline: "I’ll write a song *for you.*",
    line: "Birthdays, weddings, anniversaries or just because. Pay what you can when it’s done.",
    alt: "I’ll write a song for you. Song A Day Studio.",
  },
  business: {
    headline: "A song for *your business.*",
    line: "Companies, brands, events, podcasts and shows.",
    alt: "A song for your business. Song A Day Studio.",
  },
  "conference-troubadour": {
    headline: "I watch every talk at your conference, then end the day with *a song about it.*",
    alt: "The Conference Troubadour: I watch every talk at your conference, then end the day with a song about it.",
  },
  store: {
    headline: `*${ALBUMS}* albums, *${FIGURES}* posters, a hat and a shirt.`,
    line: "The Song A Day store.",
    alt: `The Song A Day store: ${ALBUMS} albums, ${FIGURES} posters, a hat and a shirt.`,
  },
  muscle: {
    headline: `All *${FIGURES}* MUSCLE figures, as posters.`,
    line: "Pick a figure, a size and a frame.",
    picture: "https://prints.songaday.studio/centered-v4-original-color/preview/015.jpg",
    alt: `A poster of MUSCLE figure #015 Sunshine, next to the words: all ${FIGURES} MUSCLE figures, as posters.`,
  },
  films: {
    headline: "Short films about making something *every day.*",
    alt: "Films: short films about making something every day.",
  },
  gallery: {
    headline: "Every song since 2009, on *one wall.*",
    line: "Zoom in to any day.",
    alt: "Every Song A Day song since 2009, on one wall.",
  },
  everything: {
    headline: "Every place Song A Day lives: songs, games, apps, *everything.*",
    alt: "Every place Song A Day lives: songs, games, apps, everything.",
  },
  press: {
    headline: `*${PRESS}* stories about Song A Day.`,
    line: "Press, podcasts, radio and TV.",
    alt: `${PRESS} stories about Song A Day: press, podcasts, radio and TV.`,
  },
  story: {
    headline: "Song A Day has never fit neatly into *any business model.*",
    alt: "Song A Day has never fit neatly into any business model.",
  },
  patrons: {
    headline: "The people who keep *Song A Day* going.",
    alt: "Patrons: the people who keep Song A Day going.",
  },
  now: {
    headline: "What I’m doing *now.*",
    alt: "What Jonathan Mann is doing now.",
  },
};
// The data lab's card is the one-word-per-year picture from the data share images
// (output/share-images, number 17), not a drawn card.
export const DATA_CARD = {
  source: "output/share-images/images/17-one-word-per-year.png",
  alt: "One word for each year of Song A Day, 2009 to 2026: Nerd, Animals, Animals, Breakup, Love, Internet, then Politics and Crypto.",
  width: 1200, height: 675,
};

// "Song A Day" stays on one line.
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("Song A Day", "Song&nbsp;A&nbsp;Day");
const red = (text) => escape(text).replaceAll(/\*([^*]+)\*/g, '<em>$1</em>');

function cardHtml(card, iconUrl) {
  const size = card.picture ? 72 : card.headline.replaceAll("*", "").length > 48 ? 76 : 96;
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${SHARE_SIZE.width}px;height:${SHARE_SIZE.height}px;overflow:hidden;background:#000;color:#fff;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.card{box-sizing:border-box;height:100%;display:grid;grid-template-columns:1fr${card.picture ? " auto" : ""};gap:64px;padding:72px 80px 0;border-bottom:12px solid #ff2445}
.words{display:grid;grid-template-rows:1fr auto;min-width:0}
.text{align-self:center}
h1{margin:0;font-size:${size}px;line-height:1.02;font-weight:700;letter-spacing:-.025em}
em{font-style:normal;color:#ff2445}
p{margin:28px 0 0;font-size:32px;line-height:1.25;color:#a3a3a3;max-width:900px}
.site{display:flex;align-items:center;gap:6px;margin:24px 0 44px;font-size:32px;font-weight:700;color:#fff}
.site img{width:120px;height:120px;margin:-40px -28px -40px -38px;transform:rotate(-5deg)}
.picture{align-self:center;margin-bottom:60px;height:440px;box-shadow:0 0 0 10px #fff}
</style>
<div class="card"><div class="words"><div class="text"><h1>${red(card.headline)}</h1>${card.line ? `<p>${escape(card.line)}</p>` : ""}</div>
<div class="site"><img src="${iconUrl}" alt="">songaday.studio</div></div>${card.picture ? `<img class="picture" src="${card.picture}" alt="">` : ""}</div>`;
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = import.meta.dirname;
  const outDir = path.join(root, "assets", "images", "share");
  if (!existsSync(path.join(root, "assets"))) throw new Error("No assets/ (ln -s private-assets/site assets), so there's nowhere to save the cards.");
  if (!existsSync(CHROME)) throw new Error(`Drawing the cards needs Google Chrome at ${CHROME}.`);
  await mkdir(outDir, { recursive: true });
  const wanted = process.argv.slice(2);
  const work = await mkdtemp(path.join(tmpdir(), "share-images-"));
  const icon = `file://${path.join(root, "assets", "icons", "tunes.png")}`;
  for (const [name, card] of Object.entries(SHARE_CARDS)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const page = path.join(work, `${name}.html`);
    await writeFile(page, cardHtml(card, icon));
    execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      `--window-size=${SHARE_SIZE.width},${SHARE_SIZE.height}`, "--virtual-time-budget=10000", "--allow-file-access-from-files",
      `--screenshot=${path.join(outDir, `${name}.png`)}`, `file://${page}`], { stdio: "ignore" });
    console.log(`assets/images/share/${name}.png`);
  }
  if (!wanted.length || wanted.includes("data")) {
    // Halve the 2400x1350 picture to 1200x675 with macOS's sips.
    const target = path.join(outDir, "data.png");
    await copyFile(path.join(root, DATA_CARD.source), target);
    execFileSync("sips", ["-z", String(DATA_CARD.height), String(DATA_CARD.width), target], { stdio: "ignore" });
    console.log("assets/images/share/data.png");
  }
  await rm(work, { recursive: true, force: true });
}
