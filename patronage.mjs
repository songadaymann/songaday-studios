// The monthly goals the donation ask names, in whole dollars a month. The home page's hero and
// its Patronage section take them from here (build.mjs), and tests/patronage.test.mjs keeps the
// bio link page's copy in step.
//
// Only the goals are shown. How much has come in so far is left off the site on purpose
// (Jonathan, November 2026: a small number would discourage people), so there is no progress
// figure here and no bar on the page. Zeffy can supply one later.
export const MONTHLY_GOALS = { first: 3000, dream: 20000 };

export const dollars = (amount) => "$" + amount.toLocaleString("en-US");
