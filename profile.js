(() => {
  "use strict";

  // Same conservative wallet detection as Fridays at The Park's donation routing.
  const explicitWalletRdns = new Set([
    "app.phantom",
    "com.coinbase.wallet",
    "io.metamask",
    "io.rabby",
    "io.zerion.wallet",
    "me.rainbow"
  ]);

  async function hasStrongWalletSignal(detail) {
    if (!detail || typeof detail !== "object") return false;
    const { info, provider } = detail;
    if (!info || typeof info !== "object") return false;
    if (!provider || typeof provider !== "object") return false;
    if (
      typeof info.uuid !== "string" ||
      typeof info.name !== "string" ||
      typeof info.icon !== "string" ||
      typeof info.rdns !== "string" ||
      typeof provider.request !== "function"
    ) return false;

    if (explicitWalletRdns.has(info.rdns.trim().toLowerCase())) return true;
    try {
      // Passive check only: never ask the visitor to connect their wallet.
      const accounts = await provider.request({ method: "eth_accounts" });
      return Array.isArray(accounts) && accounts.some(
        (account) => typeof account === "string" && /^0x[a-fA-F0-9]{40}$/.test(account)
      );
    } catch {
      return false;
    }
  }

  const cryptoDonate = document.getElementById("crypto-donate");
  const zeffyDonate = document.getElementById("zeffy-donate");
  let prefersZeffy = false;

  if (cryptoDonate && zeffyDonate) {
    window.addEventListener("eip6963:announceProvider", (event) => {
      if (!(event instanceof CustomEvent)) return;
      void hasStrongWalletSignal(event.detail).then((hasWallet) => {
        // ?crypto=0 (the wallet gate's "no") keeps the card and bank form too.
        if (!hasWallet || prefersZeffy || document.documentElement.dataset.wallet === "no") return;
        zeffyDonate.hidden = true;
        cryptoDonate.hidden = false;
      });
    });
    document.getElementById("donate-by-card")?.addEventListener("click", () => {
      prefersZeffy = true;
      cryptoDonate.hidden = true;
      zeffyDonate.hidden = false;
      zeffyDonate.focus({ preventScroll: true });
    });
  }

  // wallet-detect.js and wallet-gate.js from the crypto-wallet-gate skill (wallet/), inlined
  // by build.mjs. The gate shows [data-crypto] parts ("Where to go next") only when this
  // browser has a wallet. Its check asks installed wallets to announce themselves, and the
  // donation check above hears the same announcements, so the page asks once. A forced
  // ?crypto=1 skips that check, so then the donation check asks for itself.
  /* WALLET_GATE_HELPER */

  void applyWalletGate().then((result) => {
    if (result.forced && result.hasWallet) window.dispatchEvent(new Event("eip6963:requestProvider"));
  });

  // SONG A DAY CATALOG SNAPSHOT START
  const catalogSnapshot = {
    "sourceGeneratedAt": "2026-08-04T16:37:26.082Z",
    "sourceSongCount": 6425,
    "latestSongId": 6425,
    "latestSongDate": "2026-08-04",
    "durationSeconds": 904277,
    "catSongs": 46,
    "dogSongs": 33,
    "robotSongs": 18,
    "birthdaySongs": 53,
    "sickSongs": 102,
    "songTitleSongs": 418,
    "uniqueLocations": 159
  };
  // SONG A DAY CATALOG SNAPSHOT END

  const tickerTrack = document.getElementById("catalog-ticker-track");
  const tickerSummary = document.getElementById("catalog-ticker-summary");
  const heroVideo = document.getElementById("hero-video");
  const heroPlayer = heroVideo?.closest(".hero-video-player");
  const soundToggle = document.getElementById("hero-sound-toggle");
  const soundLabel = document.getElementById("hero-sound-label");
  const pauseToggle = document.getElementById("hero-video-pause");
  const videoSeek = document.getElementById("hero-video-seek");
  const videoTime = document.getElementById("hero-video-time");
  const walletAlt = document.getElementById("wallet-alt");
  const walletAltName = document.getElementById("wallet-alt-name");

  // Zeffy hides Apple Pay and Google Pay inside embeds (and its own page only shows
  // them below 900px in Safari), so only phones that can use a wallet see this link.
  const walletScreen = window.matchMedia("(max-width: 899px)");

  function supportedWallet() {
    if (!walletScreen.matches) return null;
    try {
      if (window.ApplePaySession?.canMakePayments()) return "Apple Pay";
    } catch {
      // Apple Pay checks throw outside secure contexts.
    }
    const agent = navigator.userAgent;
    // Chrome on Android only: in-app web views ("; wv)") and other Android browsers can't use
    // Google Pay on Zeffy's page.
    const androidChrome = /Android/i.test(agent) && /Chrome\/\d/.test(agent)
      && !/; wv\)|SamsungBrowser|EdgA|OPR|YaBrowser|Firefox/.test(agent);
    if (androidChrome && "PaymentRequest" in window) return "Google Pay";
    return null;
  }

  const walletAltMark = document.getElementById("wallet-alt-mark");

  function renderWalletLink() {
    if (!walletAlt || !walletAltName) return;
    const wallet = supportedWallet();
    walletAlt.hidden = !wallet;
    if (!wallet) return;
    // Apple Pay shows its own mark (people know it on sight); Google Pay stays as text.
    const showMark = wallet === "Apple Pay" && walletAltMark;
    if (walletAltMark) walletAltMark.hidden = !showMark;
    walletAltName.hidden = Boolean(showMark);
    walletAltName.textContent = wallet;
  }

  renderWalletLink();
  walletScreen.addEventListener?.("change", renderWalletLink);

  /* SONG_DAY_NUMBER_HELPER */

  function renderSongNumbers() {
    const number = songADayNumber();
    document.querySelectorAll('[data-song-day="today"]').forEach((el) => {
      el.textContent = String(number);
    });
    document.querySelectorAll('[data-song-day="tomorrow"]').forEach((el) => {
      el.textContent = String(number + 1);
    });
    document.querySelectorAll('[data-song-day="count"]').forEach((el) => {
      el.textContent = number.toLocaleString("en-US");
    });
  }

  renderSongNumbers();
  window.setInterval(renderSongNumbers, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderSongNumbers();
  });

  function songADayAge(date) {
    const years = date.getFullYear() - 2009;
    const currentDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const anniversary = Date.UTC(date.getFullYear(), 0, 1);
    return {
      years,
      days: Math.floor((currentDay - anniversary) / 86400000)
    };
  }

  function formatListenTime(totalSeconds) {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    return `${days} DAYS + ${hours} HOURS`;
  }

  function shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  function renderCatalogTicker() {
    if (!tickerTrack || !tickerSummary) return;
    const now = new Date();
    const age = songADayAge(now);
    const currentSongCount = Math.max(
      songADayNumber(now),
      catalogSnapshot.sourceSongCount,
      catalogSnapshot.latestSongId
    );
    const averageSongSeconds = catalogSnapshot.durationSeconds / catalogSnapshot.sourceSongCount;
    const estimatedListenSeconds = catalogSnapshot.durationSeconds
      + Math.max(0, currentSongCount - catalogSnapshot.sourceSongCount) * averageSongSeconds;
    const songCountFact = {
      value: currentSongCount.toLocaleString(),
      label: "SONGS AND COUNTING",
      color: "#ff2445"
    };
    const rotatingFacts = [
      { value: `${age.years} YEARS + ${age.days} DAYS`, label: "OF SONG A DAY", color: "#ffffff" },
      { value: `ABOUT ${formatListenTime(estimatedListenSeconds)}`, label: "TO HEAR THEM ALL", color: "#e6203f" },
      { value: catalogSnapshot.catSongs.toLocaleString(), label: "SONGS ABOUT CATS", color: "#ffffff" },
      { value: catalogSnapshot.birthdaySongs.toLocaleString(), label: "BIRTHDAY SONGS", color: "#e6203f" },
      { value: catalogSnapshot.robotSongs.toLocaleString(), label: "ROBOT SONGS", color: "#ff2445" },
      { value: catalogSnapshot.dogSongs.toLocaleString(), label: "SONGS ABOUT DOGS", color: "#ffffff" },
      { value: "ONE", label: "GUINNESS WORLD RECORD", color: "#e6203f" },
      { value: catalogSnapshot.sickSongs.toLocaleString(), label: "SONGS WRITTEN WHILE SICK", color: "#ffffff" },
      { value: catalogSnapshot.uniqueLocations.toLocaleString(), label: "RECORDING LOCATIONS", color: "#e6203f" },
      { value: catalogSnapshot.songTitleSongs.toLocaleString(), label: "TITLES WITH ‘SONG’ IN THEM", color: "#ff2445" }
    ];
    const facts = [];
    shuffled(rotatingFacts).forEach((fact, index) => {
      if (index % 3 === 0) facts.push(songCountFact);
      facts.push(fact);
    });
    const markup = facts.map((fact) =>
      `<span class="catalog-ticker-fact" style="--ticker-color:${fact.color}"><strong>${fact.value}</strong> ${fact.label}<i>✦</i></span>`
    ).join("");
    tickerTrack.innerHTML = `<div class="catalog-ticker-group">${markup}</div><div class="catalog-ticker-group" aria-hidden="true">${markup}</div>`;
    tickerSummary.textContent = [songCountFact, ...rotatingFacts]
      .map((fact) => `${fact.value} ${fact.label}`)
      .join(". ");
  }

  renderCatalogTicker();

  function formatVideoTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  }

  // The film's last seconds are a Patreon end card, so the hero treats 2:52 as the end
  // and loops back before it.
  const HERO_VIDEO_END = 172.4;
  let heroHasSound = false;

  function heroDuration() {
    if (!heroVideo || !Number.isFinite(heroVideo.duration) || heroVideo.duration <= 0) return 0;
    return Math.min(heroVideo.duration, HERO_VIDEO_END);
  }

  let videoIsScrubbing = false;
  let videoWasPlaying = false;

  function renderVideoPosition(position, currentTime, duration) {
    if (!videoSeek || !videoTime) return;
    const boundedPosition = Math.max(0, Math.min(1000, position));
    videoSeek.setAttribute("aria-valuenow", String(Math.round(boundedPosition)));
    videoSeek.style.setProperty("--seek-progress", `${boundedPosition / 10}%`);
    videoSeek.setAttribute(
      "aria-valuetext",
      `${formatVideoTime(currentTime)} of ${formatVideoTime(duration)}`,
    );
    videoTime.textContent = `${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`;
  }

  function renderVideoProgress() {
    if (!heroVideo || !videoSeek || !videoTime || videoIsScrubbing) return;
    if (heroVideo.currentTime >= HERO_VIDEO_END) {
      // The muted preview loops. Someone watching with sound gets the starting state back.
      if (heroHasSound) {
        heroVideo.pause();
        heroVideo.muted = true;
        heroHasSound = false;
      }
      heroVideo.currentTime = 0;
      return;
    }
    const duration = heroDuration();
    if (!duration) return;
    const ratio = heroVideo.currentTime / duration;
    const position = Math.max(0, Math.min(1000, Math.round(ratio * 1000)));
    renderVideoPosition(position, heroVideo.currentTime, duration);
  }

  function previewVideoAtControl() {
    const duration = heroDuration();
    if (!duration) return;
    const position = Number(videoSeek?.getAttribute("aria-valuenow") ?? 0);
    renderVideoPosition(position, (position / 1000) * duration, duration);
  }

  function commitVideoSeek() {
    const duration = heroDuration();
    if (!duration) return;
    const position = Number(videoSeek?.getAttribute("aria-valuenow") ?? 0);
    // Stop just short of the end so seeking to the end doesn't trip the loop back to 0:00.
    const targetTime = Math.min((position / 1000) * duration, duration - .25);
    heroVideo.currentTime = targetTime;
    renderVideoPosition(position, targetTime, duration);
  }

  function updateVideoSeekFromPointer(event) {
    if (!videoSeek) return;
    const bounds = videoSeek.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
    videoSeek.setAttribute(
      "aria-valuenow",
      String(Math.round(Math.max(0, Math.min(1, ratio)) * 1000)),
    );
    previewVideoAtControl();
  }

  function beginVideoScrub(event) {
    if (!heroVideo || videoIsScrubbing) return;
    event.preventDefault();
    videoIsScrubbing = true;
    videoWasPlaying = !heroVideo.paused;
    heroVideo.pause();
    videoSeek?.focus();
    videoSeek?.setPointerCapture?.(event.pointerId);
    updateVideoSeekFromPointer(event);
  }

  function moveVideoScrub(event) {
    if (!videoIsScrubbing) return;
    updateVideoSeekFromPointer(event);
  }

  function finishVideoScrub(event) {
    if (!heroVideo || !videoIsScrubbing) return;
    updateVideoSeekFromPointer(event);
    const shouldResume = videoWasPlaying;
    if (videoSeek?.hasPointerCapture?.(event.pointerId)) {
      videoSeek.releasePointerCapture(event.pointerId);
    }
    let seekFinished = false;
    const finishSeek = () => {
      if (seekFinished) return;
      seekFinished = true;
      videoIsScrubbing = false;
      renderVideoProgress();
      if (shouldResume) void heroVideo.play().catch(() => {});
    };
    heroVideo.addEventListener("seeked", finishSeek, { once: true });
    commitVideoSeek();
    window.setTimeout(finishSeek, 1500);
  }

  function cancelVideoScrub(event) {
    if (!heroVideo || !videoIsScrubbing) return;
    videoIsScrubbing = false;
    if (videoSeek?.hasPointerCapture?.(event.pointerId)) {
      videoSeek.releasePointerCapture(event.pointerId);
    }
    renderVideoProgress();
    if (videoWasPlaying) void heroVideo.play().catch(() => {});
  }

  videoSeek?.addEventListener("pointerdown", beginVideoScrub);
  videoSeek?.addEventListener("pointermove", moveVideoScrub);
  videoSeek?.addEventListener("pointerup", finishVideoScrub);
  videoSeek?.addEventListener("pointercancel", cancelVideoScrub);
  videoSeek?.addEventListener("keydown", (event) => {
    const duration = heroDuration();
    if (!duration) return;
    const currentPosition = Number(videoSeek.getAttribute("aria-valuenow") ?? 0);
    const fiveSeconds = (5 / duration) * 1000;
    const thirtySeconds = (30 / duration) * 1000;
    const changes = {
      ArrowLeft: -fiveSeconds,
      ArrowDown: -fiveSeconds,
      ArrowRight: fiveSeconds,
      ArrowUp: fiveSeconds,
      PageDown: -thirtySeconds,
      PageUp: thirtySeconds,
      Home: -currentPosition,
      End: 1000 - currentPosition,
    };
    if (!(event.key in changes)) return;
    event.preventDefault();
    videoSeek.setAttribute(
      "aria-valuenow",
      String(Math.round(Math.max(0, Math.min(1000, currentPosition + changes[event.key])))),
    );
    commitVideoSeek();
  });
  heroVideo?.addEventListener("loadedmetadata", renderVideoProgress);
  heroVideo?.addEventListener("durationchange", renderVideoProgress);
  heroVideo?.addEventListener("timeupdate", renderVideoProgress);
  heroVideo?.addEventListener("seeking", renderVideoProgress);
  renderVideoProgress();

  // Wide screens get a muted preview loop. Phones, reduced motion and Save-Data get the
  // poster until someone asks to watch, which also spares them the 18 MB download.
  const canPreviewHero = window.matchMedia("(min-width: 900px)").matches
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    && !navigator.connection?.saveData;

  // Browsers can only seek when the film is served with byte ranges (the Worker does
  // that from R2, see media.mjs), so the slider only shows when it's seekable.
  function renderSeekAvailability() {
    if (!heroVideo || !videoSeek) return;
    const { seekable } = heroVideo;
    videoSeek.hidden = !(seekable.length && seekable.end(seekable.length - 1) > 1);
  }

  function renderHeroControls() {
    if (!heroVideo) return;
    const started = !heroVideo.paused || heroVideo.currentTime > 0;
    heroPlayer?.classList.toggle("is-started", started);
    heroPlayer?.classList.toggle("is-watching", heroHasSound);
    if (soundToggle && soundLabel) {
      soundToggle.classList.toggle("is-sound-on", !heroVideo.muted);
      soundLabel.textContent = heroVideo.muted ? (heroHasSound ? "Unmute" : "Watch with sound") : "Mute";
    }
    if (pauseToggle) {
      pauseToggle.hidden = !started;
      pauseToggle.classList.toggle("is-paused", heroVideo.paused);
      pauseToggle.setAttribute("aria-label", heroVideo.paused ? "Play video" : "Pause video");
    }
  }

  function watchHeroWithSound() {
    if (!heroVideo) return;
    // The first time someone asks for sound, start the film from the top.
    if (!heroHasSound) heroVideo.currentTime = 0;
    heroHasSound = true;
    heroVideo.preload = "auto";
    heroVideo.muted = false;
    void heroVideo.play().catch(() => {});
    renderHeroControls();
  }

  soundToggle?.addEventListener("click", () => {
    if (!heroVideo) return;
    if (!heroHasSound) {
      watchHeroWithSound();
    } else {
      // After the first watch, the pill only toggles sound and leaves play/pause alone.
      heroVideo.muted = !heroVideo.muted;
      renderHeroControls();
    }
  });
  pauseToggle?.addEventListener("click", () => {
    if (!heroVideo) return;
    if (heroVideo.paused) void heroVideo.play().catch(() => {});
    else heroVideo.pause();
  });
  heroVideo?.addEventListener("click", () => {
    if (!heroHasSound) watchHeroWithSound();
    else if (heroVideo.paused) void heroVideo.play().catch(() => {});
    else heroVideo.pause();
  });
  ["play", "pause", "volumechange", "loadeddata"].forEach((type) => {
    heroVideo?.addEventListener(type, renderHeroControls);
  });
  ["loadedmetadata", "progress", "durationchange"].forEach((type) => {
    heroVideo?.addEventListener(type, renderSeekAvailability);
  });
  if (heroVideo && canPreviewHero) {
    heroVideo.preload = "auto";
    void heroVideo.play().catch(() => {});
  }
  renderSeekAvailability();
  renderHeroControls();

  // Name Zeffy's iframe for screen readers once its script inserts it.
  const zeffyHost = document.querySelector("[data-zeffy-embed]");
  if (zeffyHost) {
    new MutationObserver(() => {
      const frame = zeffyHost.querySelector("iframe:not([title])");
      if (frame) frame.title = "Donate to Song A Day Studio";
    }).observe(zeffyHost, { childList: true, subtree: true });
  }

  // The Game A Day montage plays only for people who haven't asked for reduced motion.
  const gameMontage = document.querySelector(".video-game-card-media video");
  if (gameMontage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    void gameMontage.play().catch(() => {});
  }

  // The profile is rendered from srcdoc. Prevent fragment links from resolving
  // against the parent profile URL and recursively loading the public page.
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
      // Move keyboard focus with the scroll (Donate lands on the gift form, the skip link on main).
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });

  const videoModal = document.getElementById("video-modal");
  const videoModalFrame = document.getElementById("video-modal-frame");
  const videoModalVideo = document.getElementById("video-modal-video");
  const videoModalTitle = document.getElementById("video-modal-title");
  const videoTriggers = [...document.querySelectorAll("[data-video-id], [data-video-src]")];
  let lastVideoTrigger = null;
  let resumeHeroPreview = false;

  function closeVideoModal() {
    if (!videoModal || !videoModalFrame) return;
    if (resumeHeroPreview) void heroVideo?.play().catch(() => {});
    resumeHeroPreview = false;
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

    // One soundtrack at a time: pause the hero film, and bring back its muted preview on close.
    if (heroVideo && !heroVideo.paused) {
      resumeHeroPreview = heroVideo.muted;
      heroVideo.pause();
    }
    if (videoModalTitle) videoModalTitle.textContent = title;
    lastVideoTrigger = trigger;
    videoModal.hidden = false;
    document.body.classList.add("video-modal-open");
    document.getElementById("video-modal-close")?.focus();
    if (videoSrc && videoModalVideo) videoModalVideo.play().catch(() => {});
  }

  videoTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => openVideoModal(trigger));
  });
  videoModal?.querySelectorAll("[data-video-close]").forEach((closeControl) => {
    closeControl.addEventListener("click", closeVideoModal);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && videoModal && !videoModal.hidden) closeVideoModal();
  });
})();
