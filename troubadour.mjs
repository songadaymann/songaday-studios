// Booking the Conference Troubadour: the Book me dialog on /conference-troubadour/. What it asks
// and the email it becomes are here; how a form is checked and sent is inquiry.mjs, shared with
// the business page's form.
import { EMAIL, handleInquiry, inquiryEmail, oneLine, paragraphs, tooLong } from './inquiry.mjs';

export const BOOKING_PATH = '/conference-troubadour/booking';
// The choices under Budget, in order. build.mjs writes them into the page, and an answer that
// isn't one of them is refused. They are the fee alone: the page's line above them says travel
// and lodging are on top.
export const BUDGETS = ['$2,500 to $5,000', '$5,000 to $7,500', '$7,500 to $10,000', '$10,000 to $20,000'];
// The most characters each answer can have; the page's fields carry the same numbers.
export const BOOKING_LIMITS = { name: 120, email: 254, event: 160, date: 80, location: 160, people: 40, story: 2000 };

// The form's answers, each cleaned to one line, except the story, which keeps its paragraphs.
export function readBooking(form) {
  return {
    name: oneLine(form, 'name'),
    email: oneLine(form, 'email').toLowerCase(),
    event: oneLine(form, 'event'),
    date: oneLine(form, 'date'),
    location: oneLine(form, 'location'),
    people: oneLine(form, 'people'),
    budget: oneLine(form, 'budget'),
    // "Tell me the story": whatever they want to say, in their own words. It can be left empty.
    story: paragraphs(form, 'story')
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
  return tooLong(answers, BOOKING_LIMITS);
}

// The email Jonathan gets.
export function bookingEmail(answers) {
  return inquiryEmail({
    subject: `Conference Troubadour: ${answers.event}`,
    opening: `${answers.name} wants to book the Conference Troubadour.`,
    rows: [
      ['Name', answers.name], ['Email', answers.email], ['Event', answers.event], ['Date', answers.date],
      ['Location', answers.location], ['People', answers.people], ['Budget', answers.budget]
    ],
    story: answers.story,
    replyTo: answers.email
  });
}

// /conference-troubadour/booking, and nothing else (null hands the request on).
export const handleTroubadour = (request, env, url) => handleInquiry(request, env, url, {
  path: BOOKING_PATH,
  action: 'booking',
  from: 'Conference Troubadour booking',
  read: readBooking,
  problem: bookingProblem,
  email: bookingEmail
});
