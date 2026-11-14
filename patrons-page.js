// songaday.studio/patrons/: the line about a patron pops up above their picture. The styles
// (patrons.css) do that for a mouse, by pointing, and for a keyboard, by landing on the
// picture. This does it for a finger: tap a picture to open its line; tap the picture, the line
// or anywhere else to close it. Escape puts away whichever one is showing, however it was opened.
(() => {
  "use strict";
  const pictures = [...document.querySelectorAll(".patron-picture")].filter((picture) => picture.querySelector("button.patron-face"));
  const closeOthers = (keep) => {
    for (const picture of pictures) if (picture !== keep) picture.classList.remove("is-open");
  };

  for (const picture of pictures) {
    picture.querySelector("button.patron-face").addEventListener("click", () => {
      closeOthers(picture);
      picture.classList.remove("is-dismissed");
      picture.classList.toggle("is-open");
    });
    // Tapping the open line itself closes it.
    picture.querySelector(".patron-bio").addEventListener("click", () => picture.classList.remove("is-open"));
    // A mouse that has moved on, or a keyboard that has, starts fresh next time.
    picture.addEventListener("mouseleave", () => picture.classList.remove("is-open", "is-dismissed"));
    picture.addEventListener("focusout", () => picture.classList.remove("is-dismissed"));
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".patron-picture")) closeOthers(null);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeOthers(null);
    for (const picture of pictures) {
      if (picture.matches(":hover") || picture.contains(document.activeElement)) picture.classList.add("is-dismissed");
    }
  });
})();
