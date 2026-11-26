(() => {
  "use strict";

  // The request form on /business/: its answers go to Jonathan as an email (business.mjs).
  // Without scripts it can't be sent, and the email link beside Send is the way in.
  const form = document.querySelector("[data-booking]");
  if (!form) return;

  // The form itself (booking-form.mjs), inlined by build.mjs.
  /* BOOKING_FORM_HELPER */
  const status = form.querySelector("[data-booking-status]");
  const start = initBookingForm(form, {
    action: "business",
    done: document.querySelector("[data-booking-done]"),
    unavailable: () => { status.textContent = "The form isn’t working right now. Email me instead."; }
  });
  // The human check loads when someone starts on the form, not with the page.
  form.addEventListener("focusin", start, { once: true });
})();
