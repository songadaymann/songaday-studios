// Same calendar count as songaday-toolkit/lib/delayed-twitter-quote.ts:
// January 1, 2009 is Song A Day #1. All visitors use Jonathan's New York date.
export function songADayNumber(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  const currentDay = Date.UTC(value("year"), value("month") - 1, value("day"));
  return Math.floor((currentDay - Date.UTC(2009, 0, 1)) / 86400000) + 1;
}
