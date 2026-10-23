(() => {
  "use strict";

  // The kind filters on /press/ are links (/press/?kind=podcasts) that the Worker answers with the
  // other kinds hidden. Here they filter in place instead: show the matching rows, hide years
  // with none left, and keep the address in step so it can be shared.
  const press = document.getElementById("press");
  if (!press) return;
  const kinds = [...press.querySelectorAll(".press-filters a[data-kind]")].map((link) => link.dataset.kind);
  const asked = new URLSearchParams(location.search).get("kind") || "";
  let current = kinds.includes(asked) ? asked : "";

  // Wallet-only rows count only when the wallet gate shows them.
  const visible = (item) => !item.hasAttribute("data-crypto") || document.documentElement.dataset.wallet === "yes";

  function apply(kind) {
    let shown = 0;
    let total = 0;
    for (const year of press.querySelectorAll(".press-year")) {
      let any = false;
      for (const item of year.querySelectorAll(".press-item")) {
        const match = !kind || item.dataset.kind === kind;
        item.hidden = !match;
        if (!visible(item)) continue;
        total++;
        if (match) { shown++; any = true; }
      }
      year.hidden = !any;
    }
    for (const link of press.querySelectorAll(".press-filters a[data-kind]")) {
      if (link.dataset.kind === kind) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    // Only a chosen kind gets a count line; the totals (the opening line, the link down to the
    // list, "14 more featured") count the rows this browser shows.
    const status = press.querySelector(".press-status");
    if (status) status.textContent = kind ? `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}.` : "";
    for (const count of document.querySelectorAll("[data-press-count]")) count.textContent = total.toLocaleString("en-US");
    const more = press.querySelector(".press-more");
    const moreCount = more?.querySelector("[data-press-more-count]");
    if (moreCount) moreCount.textContent = [...more.querySelectorAll(".press-cards > li")].filter(visible).length.toLocaleString("en-US");
  }

  press.addEventListener("click", (event) => {
    const link = event.target.closest(".press-filters a[data-kind]");
    // Let a new-tab or new-window click go to the address as usual.
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    current = link.dataset.kind;
    apply(current);
    // Change only ?kind=, keeping anything else in the address (?utm_source=…).
    const url = new URL(location.href);
    if (current) url.searchParams.set("kind", current);
    else url.searchParams.delete("kind");
    url.hash = "";
    history.replaceState(null, "", url);
  });

  // The wallet gate (inlined after this script) decides whether wallet-only rows show.
  window.addEventListener("wallet-gate", () => apply(current));
  apply(current);
})();
