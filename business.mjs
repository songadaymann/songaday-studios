// A song for a business: the request form on /business/. What it asks and the email it becomes
// are here; how a form is checked and sent is inquiry.mjs, shared with the Conference
// Troubadour's Book me.
//
// Business songs used to be a choice on the personal commission form, with a place in its line.
// They are a conversation instead: a budget, a deadline, what the song is for. So this form
// sends Jonathan an email and he writes back.
import { EMAIL, handleInquiry, inquiryEmail, oneLine, paragraphs, tooLong } from './inquiry.mjs';

export const BUSINESS_PATH = '/business/request';
// The choices under Budget, in order. build.mjs writes them into the page, and an answer that
// isn't one of them is refused.
export const BUSINESS_BUDGETS = ['$2,000 to $5,000', '$5,000 to $10,000'];
// The most characters each answer can have; the page's fields carry the same numbers.
export const BUSINESS_LIMITS = { name: 120, email: 254, company: 160, purpose: 160, deadline: 80, story: 4000 };
// "Tell me everything" has to say something to write a song from.
export const BUSINESS_STORY_MIN = 20;

// The form's answers, each cleaned to one line, except the story, which keeps its paragraphs.
export function readBusiness(form) {
  return {
    name: oneLine(form, 'name'),
    email: oneLine(form, 'email').toLowerCase(),
    company: oneLine(form, 'company'),
    purpose: oneLine(form, 'purpose'),
    // A rough date in their words, or nothing.
    deadline: oneLine(form, 'deadline'),
    budget: oneLine(form, 'budget'),
    story: paragraphs(form, 'story')
  };
}

// What's wrong with the answers, as a sentence for the person, or null.
export function businessProblem(answers) {
  if (!answers.name) return 'Add your name.';
  if (!EMAIL.test(answers.email)) return 'That email doesn’t look right.';
  if (!answers.company) return 'Add the company or project.';
  if (!answers.purpose) return 'Add what the song is for.';
  if (!BUSINESS_BUDGETS.includes(answers.budget)) return 'Pick a budget.';
  if (answers.story.length < BUSINESS_STORY_MIN) return 'Tell me a little more about it.';
  return tooLong(answers, BUSINESS_LIMITS);
}

// The email Jonathan gets.
export function businessEmail(answers) {
  return inquiryEmail({
    subject: `Business song: ${answers.company}`,
    opening: `${answers.name} wants a song for ${answers.company}.`,
    rows: [
      ['Name', answers.name], ['Email', answers.email], ['Company or project', answers.company],
      ['What it’s for', answers.purpose], ['Deadline', answers.deadline || 'None given'], ['Budget', answers.budget]
    ],
    story: answers.story,
    storyLabel: 'Everything they told me',
    replyTo: answers.email
  });
}

// /business/request, and nothing else (null hands the request on).
export const handleBusiness = (request, env, url) => handleInquiry(request, env, url, {
  path: BUSINESS_PATH,
  action: 'business',
  from: 'Business song request',
  read: readBusiness,
  problem: businessProblem,
  email: businessEmail,
  // 4,000 characters of story can be 16 KB on their own.
  maxBytes: 32 * 1024
});
