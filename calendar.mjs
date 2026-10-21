// The "This is all of it" calendar on the home page: one image per year of Song A Day, with a
// cell for each day's song still. Months are rows and days are columns, so every year is the
// same 31 × 12 grid and February 30 is a gap. build-calendar.mjs makes the images and
// calendar.json; build.mjs renders this markup from calendar.json.

// One cell at 1x. The 2x image (<year>-2x.webp) doubles all three.
export const CELL = { width: 16, height: 9, gap: 1 };
const SONG_ONE = Date.UTC(2009, 0, 1);
const DAY = 86400000;

export function yearImageSize(scale = 1) {
  return {
    width: (31 * CELL.width + 30 * CELL.gap) * scale,
    height: (12 * CELL.height + 11 * CELL.gap) * scale
  };
}

// Song A Day #1 is January 1, 2009. Returns 0 for dates that don't exist (February 30).
export function songNumberFor(year, monthIndex, day) {
  const time = Date.UTC(year, monthIndex, day);
  if (new Date(time).getUTCMonth() !== monthIndex) return 0;
  return Math.round((time - SONG_ONE) / DAY) + 1;
}

export function songDate(number) {
  return new Date(SONG_ONE + (number - 1) * DAY);
}

export function formatSongDate(number, month = 'short') {
  return songDate(number).toLocaleDateString('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function renderCalendar(calendar) {
  const one = yearImageSize(1);
  const two = yearImageSize(2);
  const version = `?v=${calendar.through}`;
  const lastYear = calendar.years.at(-1)?.year;
  const years = calendar.years.map(({ year, songs, home }) => {
    const src = `assets/calendar/${year}.webp${version}`;
    // "-2x", not "@2x": Cloudflare redirects "@" in asset paths to "%40", an extra round trip.
    const src2x = `assets/calendar/${year}-2x.webp${version}`;
    const count = year === lastYear && songs < 365 ? `${songs} so far` : `${songs} songs`;
    return `<li class="calendar-year" id="year-${year}">
  <img src="${src}" srcset="${src} ${one.width}w, ${src2x} ${two.width}w" sizes="(max-width: 520px) 46vw, (max-width: 960px) 30vw, 380px" width="${one.width}" height="${one.height}" alt="${songs} video stills from ${year}, one for each day's song" loading="lazy" decoding="async">
  <p class="calendar-year-label"><strong>${year}</strong> <span>${home} · ${count}</span></p>
</li>`;
  }).join('\n');
  return `<ol class="calendar-years">
${years}
</ol>
<p class="calendar-through">Through #${calendar.through.toLocaleString('en-US')}, ${formatSongDate(calendar.through, 'long')}.</p>`;
}
