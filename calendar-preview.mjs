import { CELL, calendarSongAtPoint, formatSongDate, songDate, songNumberFor, yearImageSize } from './calendar.mjs';

// One lightweight preview for the entire archive. The year mosaic provides an instant
// image while the full still loads; YouTube loads only after the pointer rests on a song.
export function initCalendarPreview(onPlay) {
  const maps = [...document.querySelectorAll('.calendar-map')];
  if (!maps.length) return;
  const media = 'https://tiles.songaday.world';
  const songs = new Map();
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let manifest, catalogPromise, active = null, timer, frame = null, clickVersion = 0;

  const preview = document.createElement('div');
  preview.className = 'calendar-preview';
  preview.hidden = true;
  preview.setAttribute('aria-hidden', 'true');
  preview.innerHTML = '<div class="calendar-preview-media"><img alt="" hidden></div><p class="calendar-preview-title"></p><p class="calendar-preview-date"></p>';
  document.body.append(preview);
  const picture = preview.querySelector('.calendar-preview-media');
  const still = picture.querySelector('img');
  const title = preview.querySelector('.calendar-preview-title');
  const date = preview.querySelector('.calendar-preview-date');

  async function json(path) {
    const response = await fetch(`${media}/${path}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Calendar catalog: ${response.status}`);
    return response.json();
  }

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = (async () => {
        manifest = await json('wall/current.json');
        await Promise.allSettled((manifest.catalog?.index || []).map(async (path) => {
          if (!/^meta\/index-[\w-]+\.json$/.test(path)) return;
          const chunk = await json(path);
          for (const song of chunk.songs || []) {
            if (Number.isInteger(song.n) && /^[\w-]{11}$/.test(song.yt)) songs.set(song.n, song);
          }
        }));
      })().catch(() => {
        // Stills and the gallery link still work during a catalog outage.
      });
    }
    return catalogPromise;
  }

  function stopVideo() {
    clearTimeout(timer);
    frame?.remove();
    frame = null;
  }

  function hide() {
    stopVideo();
    active?.map.querySelector('.calendar-cursor')?.setAttribute('hidden', '');
    preview.hidden = true;
    active = null;
  }

  function position(x, y) {
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
    const below = y + 20;
    const top = below + height < window.innerHeight - 12 ? below : y - height - 20;
    preview.style.left = `${Math.max(12, Math.min(x - width / 2, window.innerWidth - width - 12))}px`;
    preview.style.top = `${Math.max(header + 12, Math.min(top, window.innerHeight - height - 12))}px`;
  }

  function show(map, number, x, y, keyboard = false) {
    if (!number) { hide(); return; }
    if (active?.map === map && active.number === number) { position(x, y); return; }
    hide();
    const selection = active = { map, number, keyboard };
    const day = songDate(number);
    const col = day.getUTCDate() - 1;
    const row = day.getUTCMonth();
    const size = yearImageSize();
    const cursor = map.querySelector('.calendar-cursor');
    cursor.hidden = false;
    cursor.style.left = `${col * (CELL.width + CELL.gap) / size.width * 100}%`;
    cursor.style.top = `${row * (CELL.height + CELL.gap) / size.height * 100}%`;
    cursor.style.width = `${CELL.width / size.width * 100}%`;
    cursor.style.height = `${CELL.height / size.height * 100}%`;
    const image = map.querySelector('img');
    picture.style.backgroundImage = `url("${image.currentSrc || image.src}")`;
    picture.style.backgroundSize = `${size.width / CELL.width * 100}% ${size.height / CELL.height * 100}%`;
    picture.style.backgroundPosition = `${col * (CELL.width + CELL.gap) / (size.width - CELL.width) * 100}% ${row * (CELL.height + CELL.gap) / (size.height - CELL.height) * 100}%`;
    still.hidden = true;
    still.onload = () => { if (active === selection) still.hidden = false; };
    const rev = manifest?.stillRev?.[number];
    still.src = `${media}/stills/${number}${rev ? `-r${rev}` : ''}.webp`;
    const updateTitle = () => {
      const song = songs.get(number);
      title.textContent = `#${number.toLocaleString('en-US')}${song ? ` · ${song.t}` : ''}`;
      date.textContent = formatSongDate(number);
      map.setAttribute('aria-label', `${title.textContent}, ${date.textContent}. Press Enter to watch.`);
      position(x, y);
    };
    preview.hidden = false;
    updateTitle();
    void loadCatalog().then(() => { if (active === selection) updateTitle(); });
    // Rapid sweeps never queue players for songs the pointer has already left.
    if (!reducedMotion.matches) timer = setTimeout(async () => {
      await loadCatalog();
      const song = songs.get(number);
      if (active !== selection || !song) return;
      frame = document.createElement('iframe');
      frame.title = `Muted preview: ${song.t}`;
      frame.allow = 'autoplay; encrypted-media';
      frame.tabIndex = -1;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = `https://www.youtube-nocookie.com/embed/${song.yt}?autoplay=1&mute=1&playsinline=1&controls=0&rel=0`;
      picture.append(frame);
    }, 250);
  }

  function numberAt(map, event) {
    const bounds = map.getBoundingClientRect();
    return calendarSongAtPoint(Number(map.dataset.year), event.clientX - bounds.left,
      event.clientY - bounds.top, bounds.width, bounds.height, Number(map.dataset.through));
  }

  for (const map of maps) {
    map.addEventListener('pointermove', (event) => {
      if (finePointer.matches && event.pointerType !== 'touch') show(map, numberAt(map, event), event.clientX, event.clientY);
    });
    map.addEventListener('pointerleave', hide);
    map.addEventListener('blur', hide);
    map.addEventListener('focus', () => { void loadCatalog(); });
    map.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const year = Number(map.dataset.year);
      const first = songNumberFor(year, 0, 1);
      const last = Math.min(Number(map.dataset.through), songNumberFor(year, 11, 31));
      let number = active?.map === map ? active.number : first;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -31, ArrowDown: 31 }[event.key] || 0;
      number = event.key === 'Home' ? first : event.key === 'End' ? last : Math.max(first, Math.min(last, number + step));
      const bounds = map.getBoundingClientRect();
      show(map, number, bounds.left + bounds.width / 2, bounds.bottom, true);
    });
    map.addEventListener('click', async (event) => {
      const number = event.detail ? numberAt(map, event) : active?.map === map ? active.number : songNumberFor(Number(map.dataset.year), 0, 1);
      if (!number) return;
      const version = ++clickVersion;
      hide();
      await loadCatalog();
      if (version !== clickVersion) return;
      const song = songs.get(number);
      if (song) {
        map.dataset.videoId = song.yt;
        map.dataset.videoTitle = `Song A Day #${number}: ${song.t}`;
        onPlay(map);
      } else {
        window.location.assign(`https://gallery.songaday.world/?song=${number}`);
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { clickVersion++; hide(); }
  });
  window.addEventListener('scroll', () => {
    if (!active?.keyboard) { hide(); return; }
    // Focusing a year can scroll it into view. Keep keyboard selection intact.
    const bounds = active.map.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > window.innerHeight) { hide(); return; }
    position(bounds.left + bounds.width / 2, bounds.bottom);
  }, { passive: true });
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { void loadCatalog(); observer.disconnect(); }
    }, { rootMargin: '600px' });
    observer.observe(document.querySelector('.calendar-years'));
  }
}
