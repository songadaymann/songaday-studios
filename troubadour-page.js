(() => {
  "use strict";

  // Book me opens a short form in a dialog, and its answers go to Jonathan as an email
  // (troubadour.mjs). The buttons are email links underneath: without scripts, in a browser
  // with no <dialog>, or when the server says the form can't be used, that's what they stay.
  const dialog = document.getElementById("booking");
  const form = dialog?.querySelector("[data-booking]");
  if (!dialog || !form || typeof dialog.showModal !== "function") return;

  // The form itself (booking-form.mjs), inlined by build.mjs.
  /* BOOKING_FORM_HELPER */
  let opener = null;  // the Book me that opened the dialog
  const start = initBookingForm(form, {
    action: "booking",
    done: dialog.querySelector("[data-booking-done]"),
    // The form can't be used right now: the button does what it says underneath.
    unavailable: () => {
      dialog.close();
      if (opener) window.location.href = opener.href;
    }
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest(".troubadour-book a");
    if (link) {
      event.preventDefault();
      opener = link;
      dialog.showModal();
      // The human check loads the first time the dialog opens, not with the page.
      start();
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
