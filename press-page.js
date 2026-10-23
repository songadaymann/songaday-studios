(() => {
  "use strict";

  // The filters on /press/ (the kind links, and the project and year menus) make an address
  // (/press/?kind=tv&project=sec&year=2010) that the Worker answers with the other rows hidden.
  // Here they filter in place instead: show the matching rows, hide years with none left, recount,
  // and keep the address in step so it can be shared.
  const press = document.getElementById("press");
  if (!press) return;
  const FILTERS = ["kind", "project", "year"];
  const links = [...press.querySelectorAll(".press-filters a[data-kind]")];
  const form = press.querySelector(".press-pick");
  const menus = { project: form?.elements.project, year: form?.elements.year };
  const choices = {
    kind: links.map((link) => link.dataset.kind),
    project: [...(menus.project?.options ?? [])].map((option) => option.value),
    year: [...(menus.year?.options ?? [])].map((option) => option.value)
  };
  // Anything in the address that isn't one of the page's own choices is ignored.
  const asked = new URLSearchParams(location.search);
  const current = Object.fromEntries(FILTERS.map((name) => [name, choices[name].includes(asked.get(name)) ? asked.get(name) : ""]));
  const number = (n) => n.toLocaleString("en-US");

  // Wallet-only rows count only when the wallet gate shows them.
  const wallet = () => document.documentElement.dataset.wallet === "yes";
  const visible = (item) => !item.hasAttribute("data-crypto") || wallet();
  // The address of a set of filters, as the Worker reads it.
  const href = (filters) => {
    const query = new URLSearchParams(FILTERS.filter((name) => filters[name]).map((name) => [name, filters[name]])).toString();
    return `/press/${query ? `?${query}` : ""}#press-list`;
  };

  function apply() {
    const on = FILTERS.some((name) => current[name]);
    // Each menu choice counts the rows it would show with the other filters as they are.
    const counts = { project: new Map(), year: new Map() };
    let shown = 0;
    let total = 0;
    for (const year of press.querySelectorAll(".press-year")) {
      let any = false;
      for (const item of year.querySelectorAll(".press-item")) {
        const fits = Object.fromEntries(FILTERS.map((name) => [name, !current[name] || item.dataset[name] === current[name]]));
        const match = FILTERS.every((name) => fits[name]);
        item.hidden = !match;
        if (!visible(item)) continue;
        total++;
        for (const [name, count] of Object.entries(counts)) {
          if (FILTERS.every((other) => other === name || fits[other])) count.set(item.dataset[name], (count.get(item.dataset[name]) ?? 0) + 1);
        }
        if (match) { shown++; any = true; }
      }
      year.hidden = !any;
    }
    for (const [name, menu] of Object.entries(menus)) {
      if (!menu) continue;
      menu.value = current[name];
      for (const option of menu.options) {
        if (!option.value) continue;
        option.textContent = option.textContent.replace(/\([\d,]+\)$/, `(${number(counts[name].get(option.value) ?? 0)})`);
        // A choice whose rows are all wallet-only can be picked once they show.
        if (option.hasAttribute("data-crypto")) option.disabled = !wallet();
      }
    }
    for (const link of links) {
      link.href = href({ ...current, kind: link.dataset.kind });
      if (link.dataset.kind === current.kind) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    // The featured pieces, and the link down past them, are for the whole list.
    for (const part of press.querySelectorAll(".press-jump, .press-featured")) part.hidden = on;
    // Only a filter gets a count line and a way back; the totals (the opening line, the link down
    // to the list, "13 more featured") count the rows this browser shows.
    const status = press.querySelector(".press-status");
    if (status) status.textContent = on ? `Showing ${number(shown)} of ${number(total)}.` : "";
    const clear = press.querySelector(".press-clear");
    if (clear) clear.hidden = !on;
    for (const count of document.querySelectorAll("[data-press-count]")) count.textContent = number(total);
    const more = press.querySelector(".press-more");
    const moreCount = more?.querySelector("[data-press-more-count]");
    if (moreCount) moreCount.textContent = number([...more.querySelectorAll(".press-cards > li")].filter(visible).length);
  }

  // Hiding or showing the featured pieces moves everything under them, so the filters are put
  // back where they were on the screen.
  function choose(changes) {
    Object.assign(current, changes);
    const anchor = press.querySelector(".press-filters");
    const before = anchor?.getBoundingClientRect().top;
    apply();
    if (anchor) window.scrollBy({ top: anchor.getBoundingClientRect().top - before, behavior: "instant" });
    // Change only the filters, keeping anything else in the address (?utm_source=…).
    const url = new URL(location.href);
    for (const name of FILTERS) {
      if (current[name]) url.searchParams.set(name, current[name]);
      else url.searchParams.delete(name);
    }
    url.hash = "";
    history.replaceState(null, "", url);
  }

  press.addEventListener("click", (event) => {
    const link = event.target.closest(".press-filters a[data-kind], .press-clear");
    // Let a new-tab or new-window click go to the address as usual.
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!link.matches(".press-clear")) return choose({ kind: link.dataset.kind });
    choose({ kind: "", project: "", year: "" });
    // Clear filters is hidden now; the kind links are just above it.
    links[0]?.focus({ preventScroll: true });
  });
  // The menus apply as they change, so their Show button is only for browsers without JavaScript.
  form?.addEventListener("change", (event) => {
    const name = Object.keys(menus).find((key) => menus[key] === event.target);
    if (name) choose({ [name]: event.target.value });
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    choose({ project: menus.project?.value ?? "", year: menus.year?.value ?? "" });
  });
  const show = form?.querySelector('button[type="submit"]');
  if (show) show.hidden = true;

  // The wallet gate (inlined after this script) decides whether wallet-only rows show.
  window.addEventListener("wallet-gate", () => apply());
  apply();
})();
