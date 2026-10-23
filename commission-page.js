(() => {
  "use strict";
  // The request form (songaday.studio/commission) sends with fetch, so a problem doesn't lose
  // the answers. It checks the memo's size first, and waits for Turnstile, which usually passes
  // without showing anything. Without this script the form still posts normally.
  const form = document.querySelector("[data-request]");
  if (form) {
    const status = document.getElementById("commission-status");
    const button = form.querySelector('button[type="submit"]');
    const memo = form.querySelector('input[name="memo"]');
    const deadline = form.querySelector("[data-deadline]");
    let waiting = false;
    const say = (text) => { status.textContent = text; };
    const token = () => form.querySelector('[name="cf-turnstile-response"]')?.value;

    // The earliest deadline is today in New York, where Jonathan is.
    if (deadline) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      deadline.min = today;
    }

    async function send() {
      waiting = false;
      button.disabled = true;
      say("Sending…");
      try {
        const response = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
        const result = await response.json();
        if (result.ok && result.url) {
          say("Got it. Taking you to your page…");
          window.location.assign(result.url);
          return;
        }
        say(result.error || "That didn’t go through. Try again.");
      } catch {
        say("That didn’t go through. Check your connection and try again.");
      }
      button.disabled = false;
      window.turnstile?.reset();
    }

    window.commissionChecked = () => { if (waiting) send(); };
    window.commissionExpired = () => window.turnstile?.reset();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const file = memo?.files?.[0];
      if (file && file.size > Number(memo.dataset.maxBytes)) {
        say(`The voice memo can be up to ${Math.round(Number(memo.dataset.maxBytes) / 1048576)} MB. Try a shorter one, or spell the names out instead.`);
        return;
      }
      if (token()) return send();
      waiting = true;
      say("Checking you’re human…");
    });
  }

  // The buyer's pay form: what a monthly plan comes to, worked out the way the server does it.
  const pay = document.querySelector("[data-pay]");
  if (pay) {
    const note = pay.querySelector("[data-plan-note]");
    const other = pay.querySelector('input[name="other"]');
    const money = (cents) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
    const amount = () => {
      const picked = pay.querySelector('input[name="amount"]:checked');
      const typed = picked?.value === "other" ? other.value : picked?.value;
      const match = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.0{1,2})?$/.exec(String(typed ?? "").trim());
      return match ? Number(match[1].replaceAll(",", "")) * 100 : null;
    };
    const update = () => {
      const months = Number(pay.querySelector('input[name="plan"]:checked')?.value);
      const cents = amount();
      if (!months || !cents) { note.textContent = ""; return; }
      const monthly = Math.ceil(cents / months);
      note.textContent = `${months} payments of ${money(monthly)}, once a month (${money(monthly * months)} in all)`;
    };
    other?.addEventListener("focus", () => { pay.querySelector('input[name="amount"][value="other"]').checked = true; update(); });
    pay.addEventListener("input", update);
    pay.addEventListener("change", update);
    update();
  }
})();
