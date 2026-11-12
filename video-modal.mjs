// The video dialog the home page and the story page share. Anything on the page that carries a
// YouTube id (data-video-id, with an optional data-video-start in seconds) or a file
// (data-video-src) opens it, with data-video-title as its name. build.mjs inlines this into
// each page's script; the dialog's markup is the .video-modal block in profile.html.
//
// onOpen and onClose let a page quiet its own sound while a video plays (the home page pauses
// its film). The function it returns opens the dialog for an element set up after the page
// loaded, as the calendar does for the day that was picked.
export function initVideoModal({ onOpen = () => {}, onClose = () => {} } = {}) {
  const videoModal = document.getElementById("video-modal");
  const videoModalFrame = document.getElementById("video-modal-frame");
  const videoModalVideo = document.getElementById("video-modal-video");
  const videoModalTitle = document.getElementById("video-modal-title");
  let lastVideoTrigger = null;

  function closeVideoModal() {
    if (!videoModal || !videoModalFrame) return;
    onClose();
    videoModal.hidden = true;
    videoModalFrame.src = "about:blank";
    videoModalFrame.hidden = false;
    if (videoModalVideo) {
      videoModalVideo.pause();
      videoModalVideo.removeAttribute("src");
      videoModalVideo.load();
      videoModalVideo.hidden = true;
    }
    document.body.classList.remove("video-modal-open");
    lastVideoTrigger?.focus();
    lastVideoTrigger = null;
  }

  function openVideoModal(trigger) {
    if (!videoModal || !videoModalFrame) return;
    const videoId = trigger.dataset.videoId;
    const videoSrc = trigger.dataset.videoSrc;
    if (!videoId && !videoSrc) return;
    const title = trigger.dataset.videoTitle || "Song A Day video";

    if (videoSrc && videoModalVideo) {
      videoModalFrame.src = "about:blank";
      videoModalFrame.hidden = true;
      videoModalVideo.src = videoSrc;
      videoModalVideo.title = title;
      videoModalVideo.hidden = false;
      videoModalVideo.load();
    } else if (videoId) {
      const start = Number.parseInt(trigger.dataset.videoStart ?? "0", 10);
      const startQuery = Number.isFinite(start) && start > 0 ? `&start=${start}` : "";
      videoModalVideo?.pause();
      if (videoModalVideo) {
        videoModalVideo.removeAttribute("src");
        videoModalVideo.load();
        videoModalVideo.hidden = true;
      }
      videoModalFrame.hidden = false;
      videoModalFrame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1${startQuery}`;
      videoModalFrame.title = title;
    } else {
      return;
    }

    onOpen();
    if (videoModalTitle) videoModalTitle.textContent = title;
    lastVideoTrigger = trigger;
    videoModal.hidden = false;
    document.body.classList.add("video-modal-open");
    document.getElementById("video-modal-close")?.focus();
    if (videoSrc && videoModalVideo) videoModalVideo.play().catch(() => {});
  }

  document.querySelectorAll("[data-video-id], [data-video-src]").forEach((trigger) => {
    trigger.addEventListener("click", () => openVideoModal(trigger));
  });
  videoModal?.querySelectorAll("[data-video-close]").forEach((closeControl) => {
    closeControl.addEventListener("click", closeVideoModal);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && videoModal && !videoModal.hidden) closeVideoModal();
  });
  return openVideoModal;
}
