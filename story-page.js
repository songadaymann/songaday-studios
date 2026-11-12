(() => {
  "use strict";

  /* SONG_DAY_NUMBER_HELPER */

  // The closing ask names tomorrow's song, and keeps naming it if the page is open past midnight.
  function renderSongNumbers() {
    const number = songADayNumber();
    document.querySelectorAll('[data-song-day="tomorrow"]').forEach((el) => {
      el.textContent = String(number + 1);
    });
  }
  renderSongNumbers();
  window.setInterval(renderSongNumbers, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderSongNumbers();
  });

  // The Game A Day montage plays only for people who haven't asked for reduced motion.
  const gameMontage = document.querySelector(".video-game-card-media video");
  if (gameMontage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    void gameMontage.play().catch(() => {});
  }

  // The video dialog (video-modal.mjs), inlined by build.mjs.
  /* VIDEO_MODAL_HELPER */
  initVideoModal();
})();
