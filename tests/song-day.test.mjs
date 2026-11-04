import assert from 'node:assert/strict';
import test from 'node:test';
import { songADayAge, songADayNumber } from '../song-day.mjs';

test('matches the toolkit calendar numbering and the catalog snapshot', () => {
  assert.equal(songADayNumber(new Date('2009-01-01T05:00:00Z')), 1);
  assert.equal(songADayNumber(new Date('2026-08-04T16:37:26Z')), 6425);
  assert.equal(songADayNumber(new Date('2026-10-14T16:00:00Z')), 6496);
});

test('rolls over at New York midnight, not UTC midnight', () => {
  assert.equal(songADayNumber(new Date('2026-10-15T03:59:59Z')), 6496);
  assert.equal(songADayNumber(new Date('2026-10-15T04:00:00Z')), 6497);
  assert.equal(songADayNumber(new Date('2026-01-01T04:59:59Z')), 6209);
  assert.equal(songADayNumber(new Date('2026-01-01T05:00:00Z')), 6210);
});

test('daylight saving changes do not skip or repeat song numbers', () => {
  const spring = ['2026-03-08T05:00:00Z', '2026-03-08T07:00:00Z', '2026-03-09T04:00:00Z'].map(date => songADayNumber(new Date(date)));
  assert.equal(spring[1], spring[0]);
  assert.equal(spring[2], spring[0] + 1);
  const fall = ['2026-11-01T04:00:00Z', '2026-11-01T06:00:00Z', '2026-11-02T05:00:00Z'].map(date => songADayNumber(new Date(date)));
  assert.equal(fall[1], fall[0]);
  assert.equal(fall[2], fall[0] + 1);
});

test('the age counts whole years since 2009 and days since that January 1', () => {
  assert.deepEqual(songADayAge(1), { years: 0, days: 0, text: '0 years and 0 days' });
  assert.equal(songADayAge(2).text, '0 years and 1 day');
  assert.equal(songADayAge(366).text, '1 year and 0 days');
  // 2012 was a leap year, so its December 31 is day 365 of that year.
  assert.equal(songADayAge(songADayNumber(new Date('2012-12-31T17:00:00Z'))).text, '3 years and 365 days');
  assert.equal(songADayAge(6508).text, '17 years and 298 days');
});
