(() => {
  "use strict";

  // Swap a thumbnail for the YouTube player when someone asks to watch. One film plays at a
  // time: starting another puts the previous one back to its thumbnail.
  let playing = null;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-film-id]");
    if (!button) return;
    if (playing) playing.frame.replaceWith(playing.button);
    const frame = document.createElement("iframe");
    frame.className = "film-frame";
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(button.dataset.filmId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    frame.title = (button.getAttribute("aria-label") || "Film").replace(/^Play /, "");
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    button.replaceWith(frame);
    playing = { frame, button };
    frame.focus();
  });

  // Older videos have no full-size thumbnail; YouTube answers with a 120px placeholder instead.
  document.querySelectorAll("img[data-fallback]").forEach((img) => {
    const useFallback = () => {
      if (img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
    };
    const check = () => {
      if (img.naturalWidth > 0 && img.naturalWidth <= 120) useFallback();
    };
    if (img.complete) check();
    else img.addEventListener("load", check, { once: true });
    img.addEventListener("error", useFallback, { once: true });
  });
})();
