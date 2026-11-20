(() => {
  "use strict";

  // Book me opens a short form in a dialog, and its answers go to Jonathan as an email
  // (troubadour.mjs). The buttons are email links underneath: without scripts, in a browser
  // with no <dialog>, or when the server says the form can't be used, that's what they stay.
  const dialog = document.getElementById("booking");
  const form = dialog?.querySelector("[data-booking]");
  if (!dialog || !form || typeof dialog.showModal !== "function") return;

  const status = form.querySelector("[data-booking-status]");
  const check = form.querySelector("[data-booking-check]");
  const send = form.querySelector('button[type="submit"]');
  const done = dialog.querySelector("[data-booking-done]");
  const say = (text) => { status.textContent = text; };
  const token = () => form.querySelector('[name="cf-turnstile-response"]')?.value;
  let setup = null;     // what the server said: { open, siteKey }
  let widget = null;    // the human check, once it's on the page
  let waiting = false;  // Send was pressed before the human check finished

  // Turnstile usually passes without showing anything. It loads the first time the dialog
  // opens, not with the page.
  function addHumanCheck(siteKey) {
    if (widget !== null) return;
    const ready = window.turnstile ? Promise.resolve() : new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
    ready.then(() => {
      if (widget !== null) return;
      widget = window.turnstile.render(check, {
        sitekey: siteKey,
        action: "booking",
        theme: "dark",
        callback: () => { if (waiting) submit(); }
      });
    }).catch(() => say("The human check didn’t load. Email me instead."));
  }

  async function submit() {
    waiting = false;
    send.disabled = true;
    say("Sending…");
    try {
      const response = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
      const result = await response.json();
      if (result.ok) {
        form.hidden = true;
        done.hidden = false;
        done.querySelector("button").focus();
        return;
      }
      say(result.error || "That didn’t go through. Try again.");
    } catch {
      say("That didn’t go through. Check your connection and try again.");
    }
    send.disabled = false;
    if (widget !== null) window.turnstile?.reset(widget);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (send.disabled) return;
    if (!token()) {
      waiting = true;
      say("Checking you’re human…");
      return;
    }
    submit();
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest(".troubadour-book a");
    if (link) {
      event.preventDefault();
      dialog.showModal();
      setup ??= fetch(form.action, { headers: { Accept: "application/json" } })
        .then((response) => response.json()).catch(() => ({ open: false }));
      setup.then(({ open, siteKey }) => {
        if (open) return addHumanCheck(siteKey);
        // The form can't be used right now: the button does what it says underneath.
        dialog.close();
        window.location.href = link.href;
      });
      return;
    }
    if (event.target.closest("[data-booking-close]")) {
      dialog.close();
      return;
    }
    // A click on the page behind the dialog closes it; one on the dialog's own edge doesn't.
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    }
  });
})();
