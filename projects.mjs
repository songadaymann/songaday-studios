// projects.json is the list of places Song A Day lives: one row per site or section, not per
// song or game (songs are in the song catalog, games in mann.cool's games.json). It's served at
// https://songaday.studio/projects.json for the universe bar (bar/v1/bar.js) and other sites, and
// build.mjs renders the home page's "Where to go next" and /everything from it.
import { escapeHtml } from './films.mjs';

export const STATUSES = ['active', 'soon', 'seasonal', 'lab', 'archived'];
export const TAGLINE_MAX = 80;
export const BAR_LABEL_MAX = 16;

export const VERB_LABELS = {
  listen: 'Listen', see: 'See', play: 'Play', build: 'Build', make: 'Make', 'get-a-song': 'Get a song',
  join: 'Join', watch: 'Watch', support: 'Support', collect: 'Collect', other: 'Other'
};

const STATUS_LABELS = { active: 'Active', soon: 'Soon', seasonal: 'Seasonal', lab: 'Lab', archived: 'Archived' };
const FIELDS = new Set(['id', 'title', 'verb', 'path', 'url', 'tagline', 'status', 'since', 'sourceUrl', 'crypto', 'inBar', 'barLabel', 'season']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STUDIO = 'https://songaday.studio';

const isText = (value, max) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max;

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// Every problem with the file, as plain sentences; an empty list means it's fine.
export function validateProjects(data, { now = new Date() } = {}) {
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['The file must be a JSON object.'];
  if (data.version !== 1) problems.push('version must be 1.');
  const verbs = Array.isArray(data.verbs) ? data.verbs : [];
  if (!verbs.length) problems.push('verbs must be a list.');
  for (const verb of verbs) {
    if (!/^[a-z]+(-[a-z]+)*$/.test(verb)) problems.push(`Verb "${verb}" must be lowercase words joined by hyphens.`);
  }
  if (new Set(verbs).size !== verbs.length) problems.push('verbs has a duplicate.');
  if (!Array.isArray(data.projects) || !data.projects.length) return [...problems, 'projects must be a list.'];
  if (/patreon/i.test(JSON.stringify(data))) problems.push('Nothing links to or mentions Patreon.');

  const ids = new Set();
  const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  data.projects.forEach((project, index) => {
    const name = typeof project?.id === 'string' ? project.id : `projects[${index}]`;
    const problem = (text) => problems.push(`${name}: ${text}`);
    if (!project || typeof project !== 'object') return problem('must be an object.');
    for (const key of Object.keys(project)) if (!FIELDS.has(key)) problem(`unknown field "${key}".`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(project.id ?? '')) problem('id must be lowercase letters, numbers and hyphens.');
    if (ids.has(project.id)) problem('id is used twice.');
    ids.add(project.id);
    if (!isText(project.title, 60)) problem('title must be 1 to 60 characters.');
    if (!verbs.includes(project.verb)) problem(`verb must be one of: ${verbs.join(', ')}.`);
    if (project.path !== null && !/^\/[a-z0-9-]+(\/[a-z0-9-]+)*\/?$/.test(project.path ?? '')) {
      problem('path must be null or a lowercase songaday.studio address like "/listen".');
    }
    if (!isHttps(project.url)) problem('url must be an https address.');
    if (!isText(project.tagline, TAGLINE_MAX)) problem(`tagline must be 1 to ${TAGLINE_MAX} characters.`);
    if (/[<>—–]/.test(project.tagline ?? '')) problem('tagline must be plain words (no HTML or dashes).');
    if (!STATUSES.includes(project.status)) problem(`status must be one of: ${STATUSES.join(', ')}.`);
    const since = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/.exec(project.since ?? '');
    if (!since) problem('since must be YYYY or YYYY-MM.');
    else if (Number(since[1]) * 12 + (since[2] ? Number(since[2]) - 1 : 0) > thisMonth) problem('since is in the future.');
    if (project.sourceUrl !== null && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(project.sourceUrl ?? '')) {
      problem('sourceUrl must be null or a public GitHub repository address.');
    }
    if (typeof project.crypto !== 'boolean') problem('crypto must be true or false.');
    if (typeof project.inBar !== 'boolean') problem('inBar must be true or false.');
    if (project.inBar) {
      if (!isText(project.barLabel, BAR_LABEL_MAX)) problem(`barLabel must be 1 to ${BAR_LABEL_MAX} characters when inBar is true.`);
      if (!['active', 'seasonal', 'lab'].includes(project.status)) problem('only live places can be in the bar.');
    } else if ('barLabel' in project) {
      problem('barLabel is only for projects in the bar.');
    }
    if (project.status === 'seasonal' && !('season' in project)) problem('seasonal projects need a season.');
    if ('season' in project) {
      const month = `(?:${MONTHS.join('|')})`;
      if (!new RegExp(`^${month}(?:-${month})?$`).test(project.season)) problem('season must be a month or a range like "Dec-Jan".');
    }
  });
  return problems;
}

// Links go through the short address when there is one, like the site header's do.
export const projectHref = (project) => project.path ?? project.url;

// What a reader sees as the address: the short address, or the site's own name.
export function projectAddress(project) {
  if (project.path) return `songaday.studio${project.path.replace(/\/$/, '')}`;
  const url = new URL(project.url);
  return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');
}

const leavesStudio = (project) => new URL(project.url).origin !== STUDIO;
const OUT = '<span class="nav-out" aria-hidden="true">↗</span>';
const cryptoAttribute = (project) => project.crypto ? ' data-crypto' : '';

function formatSince(since) {
  const [year, month] = since.split('-');
  return month ? `${MONTHS[Number(month) - 1]} ${year}` : year;
}

function byVerb(data, projects) {
  return data.verbs.map((verb) => ({ verb, projects: projects.filter((project) => project.verb === verb) }))
    .filter((group) => group.projects.length);
}

// A group whose every row is crypto is itself hidden without a wallet, so no empty heading shows.
const groupCrypto = (projects) => projects.every((project) => project.crypto) ? ' data-crypto' : '';

// The home page's "Where to go next": live places, grouped by what you'd do there. Donating is
// the rest of the page and "other" is the person, so neither is listed.
const DIRECTORY_VERBS = ['listen', 'see', 'play', 'build', 'make', 'get-a-song', 'join', 'watch', 'collect'];

export function renderDirectory(data) {
  const live = data.projects.filter((project) => ['active', 'seasonal', 'lab'].includes(project.status)
    && DIRECTORY_VERBS.includes(project.verb));
  return byVerb(data, live).map(({ verb, projects }) => `<section class="directory-group"${groupCrypto(projects)} aria-labelledby="directory-${verb}">
  <h3 id="directory-${verb}">${VERB_LABELS[verb] ?? escapeHtml(verb)}</h3>
  <ul>
${projects.map((project) => `    <li${cryptoAttribute(project)}><a href="${escapeHtml(projectHref(project))}">${escapeHtml(project.title)}${leavesStudio(project) ? OUT : ''}</a> <span>${escapeHtml(project.tagline)}</span></li>`).join('\n')}
  </ul>
</section>`).join('\n');
}

const EVERYTHING_GROUPS = [
  ['active', 'Active'], ['soon', 'Coming soon'], ['seasonal', 'Seasonal'], ['lab', 'Lab'], ['archived', 'Archive']
];

function everythingRow(project) {
  const chip = project.season ? `${STATUS_LABELS[project.status]} · ${project.season}` : STATUS_LABELS[project.status];
  const source = project.sourceUrl ? ` · <a href="${escapeHtml(project.sourceUrl)}">Source</a>` : '';
  // The grid is on an inner element: the wallet gate's display: revert would undo it on the li.
  return `    <li${cryptoAttribute(project)}><div class="everything-row">
      <a class="everything-place" href="${escapeHtml(projectHref(project))}"><strong>${escapeHtml(project.title)}</strong> <span>${escapeHtml(projectAddress(project))}${leavesStudio(project) ? OUT : ''}</span></a>
      <p class="everything-tagline">${escapeHtml(project.tagline)}</p>
      <p class="everything-meta"><span class="status-chip status-${project.status}">${chip}</span> Since ${formatSince(project.since)}${source}</p>
    </div></li>`;
}

// songaday.studio/everything: one line per project, by status. Within a status, rows keep the
// order of the verbs.
export function renderEverything(data) {
  const verbOrder = (project) => data.verbs.indexOf(project.verb);
  return EVERYTHING_GROUPS.map(([status, label]) => {
    const projects = data.projects.filter((project) => project.status === status)
      .sort((a, b) => verbOrder(a) - verbOrder(b));
    if (!projects.length) return '';
    return `<section class="everything-group"${groupCrypto(projects)} aria-labelledby="everything-${status}">
  <h2 id="everything-${status}">${label}</h2>
  <ul>
${projects.map(everythingRow).join('\n')}
  </ul>
</section>`;
  }).filter(Boolean).join('\n');
}
