// Today's song at the top of the home page: the newest "Title | Song A Day #N" upload on
// Jonathan's YouTube channel. build.mjs bakes in a snapshot, and the Worker re-reads the feed
// (cached for ten minutes), so the card changes soon after the day's song goes up.
import { escapeHtml, parseFeed } from './films.mjs';
import { formatSongDate } from './calendar.mjs';

export const SONGS_CHANNEL_URL = 'https://www.youtube.com/channel/UCvj5S3f10rO6CoibatfRGzg';
export const SONGS_FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCvj5S3f10rO6CoibatfRGzg';

const SONG_TITLE = /^(.*?)\s*\|\s*Song A Day #(\d+)\s*$/i;

// The feed is newest first and also has other videos (mini-docs, plugin demos), so take the
// first one titled like a song.
export function latestSong(xml) {
  for (const video of parseFeed(xml)) {
    const match = SONG_TITLE.exec(video.title);
    if (match) return { id: video.id, title: match[1], number: Number(match[2]) };
  }
  return null;
}

// `today` is today's song number. Without it (the build's snapshot) the card says "Latest song",
// since the snapshot can be days old by the time anyone sees it.
export function renderTodaySong(song, today) {
  const title = escapeHtml(song.title);
  const id = escapeHtml(song.id);
  return `<button class="today-song-play" type="button" data-video-id="${id}" data-video-title="Song A Day #${song.number}: ${title}">
  <span class="today-song-thumb"><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" width="320" height="180" decoding="async"><span class="today-song-icon" aria-hidden="true"></span></span>
  <span class="today-song-copy">
    <span class="today-song-label">${songLabel(song, today)}</span>
    <span class="today-song-title">${title}</span>
    <span class="today-song-meta">${songMeta(song)}</span>
  </span>
</button>`;
}

// The same song for links/index.html, the bio link page. It has no video modal, so the card is
// a plain link that opens YouTube (or its app).
export function renderTodaySongLink(song, today) {
  const title = escapeHtml(song.title);
  const id = escapeHtml(song.id);
  return `<a class="song" href="https://www.youtube.com/watch?v=${id}">
  <span class="song-thumb"><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" width="320" height="180"><span class="song-play" aria-hidden="true"></span></span>
  <span class="song-copy">
    <span class="song-label">${songLabel(song, today)}</span>
    <span class="song-title">${title}</span>
    <span class="song-meta">${songMeta(song)}</span>
  </span>
</a>`;
}

function songLabel(song, today) {
  return song.number === today ? 'Today’s song' : 'Latest song';
}

function songMeta(song) {
  return `#${song.number.toLocaleString('en-US')} · ${formatSongDate(song.number)}`;
}

export const TODAY_SONG_FALLBACK = `<a class="today-song-fallback" href="${SONGS_CHANNEL_URL}">Watch today’s song on YouTube<span class="nav-out" aria-hidden="true">↗</span></a>`;
