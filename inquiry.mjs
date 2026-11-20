// What the site's two "hire me" forms share: Book me on the Conference Troubadour page
// (troubadour.mjs) and the request form on the business page (business.mjs). Each form asks
// its address whether it can be used (GET) and sends its answers there (POST). They go straight
// to Jonathan as one email, with Reply-To set to the person who asked, so writing back is
// pressing Reply.
//
// Nothing is stored. The email is sent before the answer goes back, so if it can't be sent the
// person is told, and the page offers the email link instead.
//
// The same guards as the commission form: a size limit, a field people can't see, the shared
// rate limit (counted apart for each form), and Turnstile last, since its tokens work once.
import { isHuman } from './turnstile.mjs';
import { cleanLine, cleanText, readForm, visitorKey } from './commission-core.mjs';

const FORM_MAX_BYTES = 16 * 1024;
// One plain address: it becomes the email's Reply-To.
export const EMAIL = /^[^\s@,;:<>()[\]"'\\]+@[^\s@,;:<>()[\]"'\\]+\.[^\s@,;:<>()[\]"'\\.]+$/;
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// One of a form's answers: as one line, or (a story) with its paragraphs kept.
const typed = (form, name) => (typeof form.get(name) === 'string' ? form.get(name) : '');
export const oneLine = (form, name) => cleanLine(typed(form, name));
export const paragraphs = (form, name) => cleanText(typed(form, name));

// The first answer that is longer than it may be, as a sentence for the person, or null.
export function tooLong(answers, limits) {
  for (const [field, most] of Object.entries(limits)) {
    if (answers[field].length > most) return 'One of those answers is too long.';
  }
  return null;
}

// The email Jonathan gets: an opening line, the short answers as rows, then the longer answer
// (when there is one) a paragraph at a time, and whom Reply reaches.
export function inquiryEmail({ subject, opening, rows, story = '', storyLabel = 'The story', replyTo }) {
  const parts = story ? story.split(/\n{2,}/) : [];
  return {
    subject,
    text: `${opening}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n${
      story ? `\n${storyLabel}:\n${story}\n` : ''}\nReply to this email to write back to ${replyTo}.\n`,
    html: `<p>${escapeHtml(opening)}</p>
<table>
${rows.map(([label, value]) => `<tr><th align="left">${label}</th><td>${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
${parts.length ? `<p><strong>${storyLabel}</strong></p>\n${parts.map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`).join('\n')}\n` : ''}<p>Reply to this email to write back to <a href="mailto:${escapeHtml(replyTo)}">${escapeHtml(replyTo)}</a>.</p>`
  };
}

// Whether a form can do its whole job here: check a person, and send the email.
const ready = (env) => Boolean(env.COMMISSION_EMAIL && env.COMMISSION_FROM_EMAIL && env.COMMISSION_NOTIFY_TO
  && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

// One form's address, and nothing else (null hands the request on). `form` says what is its own:
//   path     where it answers
//   action   its name: the Turnstile action, the rate limit's prefix, and the word in the log
//   from     the sender's name on the email
//   read     the form's answers, cleaned (must include `email`)
//   problem  what's wrong with them, as a sentence, or null
//   email    the email for them: { subject, text, html }
//   maxBytes the biggest body it takes, when the usual 16 KB is too small
export async function handleInquiry(request, env, url, form) {
  if (url.pathname !== form.path) return null;
  const reply = (status, error) => Response.json(error ? { error } : { ok: true }, { status, headers: NO_STORE });

  if (request.method === 'GET' || request.method === 'HEAD') {
    const open = ready(env);
    return Response.json({ open, siteKey: open ? env.TURNSTILE_SITE_KEY : null }, { headers: NO_STORE });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: 'GET, HEAD, POST' } });

  if (!ready(env)) return reply(503, 'The form isn’t working right now. Email me instead.');
  // The page's own form is the only thing that sends here.
  if (request.headers.get('Origin') !== url.origin) return reply(403, 'That came from somewhere else.');
  const { form: sent, status, error } = await readForm(request, form.maxBytes ?? FORM_MAX_BYTES);
  if (!sent) return reply(status, error);
  // Bots fill in every field, including this one people can't see.
  if (sent.get('website')) return reply(200);

  const answers = form.read(sent);
  const problem = form.problem(answers);
  if (problem) return reply(400, problem);

  if (env.COMMISSION_LIMIT) {
    const { success } = await env.COMMISSION_LIMIT.limit({ key: `${form.action}:${visitorKey(request.headers.get('CF-Connecting-IP'))}` });
    if (!success) return reply(429, 'Too many at once. Try again in a minute.');
  }
  if (!(await isHuman(env, sent.get('cf-turnstile-response'), form.action))) {
    return reply(403, 'The human check didn’t pass. Try again.');
  }

  try {
    await env.COMMISSION_EMAIL.send({
      to: env.COMMISSION_NOTIFY_TO,
      from: { email: env.COMMISSION_FROM_EMAIL, name: form.from },
      replyTo: answers.email,
      ...form.email(answers)
    });
  } catch (failure) {
    // Only the code is logged, never the message: it can quote the address or the answers.
    console.log(`${form.action} email`, typeof failure?.code === 'string' ? failure.code.slice(0, 64) : 'unknown');
    return reply(502, 'That didn’t go through. Email me instead.');
  }
  return reply(200);
}
