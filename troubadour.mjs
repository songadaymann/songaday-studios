// Booking the Conference Troubadour. The Book me dialog on /conference-troubadour/ asks this
// address whether the form can be used (GET) and sends its answers here (POST). They go
// straight to Jonathan as one email, with Reply-To set to the person who asked, so writing
// back is pressing Reply.
//
// Nothing is stored. The email is sent before the answer goes back, so if it can't be sent the
// person is told, and the dialog offers the email link instead.
//
// The same guards as the commission form: a size limit, a field people can't see, the shared
// rate limit, and Turnstile last, since its tokens work once.
import { isHuman } from './turnstile.mjs';
import { cleanLine, readForm, visitorKey } from './commission-core.mjs';

export const BOOKING_PATH = '/conference-troubadour/booking';
// The choices under Budget, in order. build.mjs writes them into the page, and an answer that
// isn't one of them is refused. They are the fee alone: the page's line above them says travel
// and lodging are on top.
export const BUDGETS = ['$2,500 to $5,000', '$5,000 to $7,500', '$7,500 to $10,000', '$10,000 to $20,000'];
// The most characters each answer can have; the page's fields carry the same numbers.
export const BOOKING_LIMITS = { name: 120, email: 254, event: 160, date: 80, location: 160, people: 40 };
const FORM_MAX_BYTES = 16 * 1024;
// One plain address: it becomes the email's Reply-To.
const EMAIL = /^[^\s@,;:<>()[\]"'\\]+@[^\s@,;:<>()[\]"'\\]+\.[^\s@,;:<>()[\]"'\\.]+$/;
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// The form's answers, each cleaned to one line.
export function readBooking(form) {
  const line = (name) => cleanLine(typeof form.get(name) === 'string' ? form.get(name) : '');
  return {
    name: line('name'),
    email: line('email').toLowerCase(),
    event: line('event'),
    date: line('date'),
    location: line('location'),
    people: line('people'),
    budget: line('budget')
  };
}

// What's wrong with the answers, as a sentence for the person, or null.
export function bookingProblem(answers) {
  if (!answers.name) return 'Add your name.';
  if (!EMAIL.test(answers.email)) return 'That email doesn’t look right.';
  if (!answers.event) return 'Add the event’s name.';
  if (!answers.date) return 'Add the date, even a rough one.';
  if (!answers.location) return 'Add where it is.';
  if (!answers.people) return 'Add about how many people will be there.';
  if (!BUDGETS.includes(answers.budget)) return 'Pick a budget.';
  for (const [field, most] of Object.entries(BOOKING_LIMITS)) {
    if (answers[field].length > most) return 'One of those answers is too long.';
  }
  return null;
}

// The email Jonathan gets.
export function bookingEmail(answers) {
  const rows = [
    ['Name', answers.name], ['Email', answers.email], ['Event', answers.event], ['Date', answers.date],
    ['Location', answers.location], ['People', answers.people], ['Budget', answers.budget]
  ];
  return {
    subject: `Conference Troubadour: ${answers.event}`,
    text: `${answers.name} wants to book the Conference Troubadour.\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nReply to this email to write back to ${answers.email}.\n`,
    html: `<p>${escapeHtml(answers.name)} wants to book the Conference Troubadour.</p>
<table>
${rows.map(([label, value]) => `<tr><th align="left">${label}</th><td>${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
<p>Reply to this email to write back to <a href="mailto:${escapeHtml(answers.email)}">${escapeHtml(answers.email)}</a>.</p>`
  };
}

// Whether the form can do its whole job here: check a person, and send the email.
const ready = (env) => Boolean(env.COMMISSION_EMAIL && env.COMMISSION_FROM_EMAIL && env.COMMISSION_NOTIFY_TO
  && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

// /conference-troubadour/booking, and nothing else (null hands the request on).
export async function handleTroubadour(request, env, url) {
  if (url.pathname !== BOOKING_PATH) return null;
  const reply = (status, error) => Response.json(error ? { error } : { ok: true }, { status, headers: NO_STORE });

  if (request.method === 'GET' || request.method === 'HEAD') {
    const open = ready(env);
    return Response.json({ open, siteKey: open ? env.TURNSTILE_SITE_KEY : null }, { headers: NO_STORE });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: 'GET, HEAD, POST' } });

  if (!ready(env)) return reply(503, 'The form isn’t working right now. Email me instead.');
  // The page's own dialog is the only thing that sends here.
  if (request.headers.get('Origin') !== url.origin) return reply(403, 'That came from somewhere else.');
  const { form, status, error } = await readForm(request, FORM_MAX_BYTES);
  if (!form) return reply(status, error);
  // Bots fill in every field, including this one people can't see.
  if (form.get('website')) return reply(200);

  const answers = readBooking(form);
  const problem = bookingProblem(answers);
  if (problem) return reply(400, problem);

  if (env.COMMISSION_LIMIT) {
    const { success } = await env.COMMISSION_LIMIT.limit({ key: `booking:${visitorKey(request.headers.get('CF-Connecting-IP'))}` });
    if (!success) return reply(429, 'Too many at once. Try again in a minute.');
  }
  if (!(await isHuman(env, form.get('cf-turnstile-response'), 'booking'))) {
    return reply(403, 'The human check didn’t pass. Try again.');
  }

  try {
    await env.COMMISSION_EMAIL.send({
      to: env.COMMISSION_NOTIFY_TO,
      from: { email: env.COMMISSION_FROM_EMAIL, name: 'Conference Troubadour booking' },
      replyTo: answers.email,
      ...bookingEmail(answers)
    });
  } catch (failure) {
    // Only the code is logged, never the message: it can quote the address or the answers.
    console.log('booking email', typeof failure?.code === 'string' ? failure.code.slice(0, 64) : 'unknown');
    return reply(502, 'That didn’t go through. Email me instead.');
  }
  return reply(200);
}
