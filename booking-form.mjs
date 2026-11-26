// What the site's two booking forms do in the browser: the Book me dialog on the Conference
// Troubadour page and the request form on the business page. It asks the form's address whether
// the form can be used, loads the human check the first time it's needed, sends the answers,
// and shows the thank-you. build.mjs inlines it into each page's script.
//
// The form is a <form data-booking> holding [data-booking-check] (where the human check goes)
// and [data-booking-status] (what the person is told). `action` is the form's name on the
// server (inquiry.mjs), `done` is what takes the form's place once it's sent, and `unavailable`
// runs when the server says the form can't be used. It returns start(), which may be called
// more than once: when the dialog opens, or when someone begins on the form.
export function initBookingForm(form, { action, done, unavailable = () => {} }) {
  const status = form.querySelector("[data-booking-status]");
  const check = form.querySelector("[data-booking-check]");
  const send = form.querySelector('button[type="submit"]');
  const say = (text) => { status.textContent = text; };
  const token = () => form.querySelector('[name="cf-turnstile-response"]')?.value;
  let setup = null;     // what the server said: { open, siteKey }
  let widget = null;    // the human check, once it's on the page
  let waiting = false;  // Send was pressed before the human check finished

  // Turnstile usually passes without showing anything.
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
        action,
        theme: "dark",
        callback: () => { if (waiting) submit(); }
      });
    }).catch(() => say("The human check didn’t load. Email me instead."));
  }

  function start() {
    setup ??= fetch(form.action, { headers: { Accept: "application/json" } })
      .then((response) => response.json()).catch(() => ({ open: false }));
    setup.then(({ open, siteKey }) => {
      if (open) addHumanCheck(siteKey);
      else unavailable();
    });
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
        (done.querySelector("button, a") ?? done).focus();
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
      start();
      return;
    }
    submit();
  });

  return start;
}
