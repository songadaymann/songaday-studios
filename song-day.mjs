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

// How long Song A Day had been going on the day of song #number: whole years since January 1,
// 2009, and days since that year's January 1 (#1 is 0 years and 0 days). The home page's
// calendar heading and its scrolling numbers both use it.
export function songADayAge(number) {
  const day = new Date(Date.UTC(2009, 0, number));
  const years = day.getUTCFullYear() - 2009;
  const days = Math.round((day - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86400000);
  const count = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  return { years, days, text: `${count(years, "year")} and ${count(days, "day")}` };
}
