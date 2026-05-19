const revealItems = document.querySelectorAll(".reveal");
const previewSection = document.querySelector(".preview-section");
const previewFrame = document.querySelector(".morph-preview[data-src]");
const previewStart = document.querySelector(".preview-start");

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

revealItems.forEach(item => observer.observe(item));

function loadPreviewOnDemand() {
  if (!previewFrame) {
    return;
  }

  previewStart?.setAttribute("disabled", "");
  previewSection?.classList.add("is-3d-loading");

  previewFrame.addEventListener("load", () => {
    previewSection?.classList.add("is-3d-loaded");
    previewSection?.classList.remove("is-3d-loading");
  }, { once: true });

  previewFrame.src = previewFrame.dataset.src;
}

previewStart?.addEventListener("click", loadPreviewOnDemand, { once: true });

const resultVideos = Array.from(document.querySelectorAll(".video-grid video"));
const autoDisplayUnits = Array.from(document.querySelectorAll(".video-grid .auto-display"));
const videoUnits = Array.from(document.querySelectorAll(".video-card > .video-stage, .video-grid .ablation-unit"));
const visibleUnits = new WeakSet();
const userPausedUnits = new WeakSet();
let activeVideoUnit = null;
let suppressPauseTracking = false;

function getVideoRate(video) {
  const rate = Number(video.dataset.playbackRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function prepareVideo(video) {
  const unit = getVideoUnit(video);
  video.autoplay = false;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.controls = !(unit?.classList.contains("auto-display") || unit?.classList.contains("ablation-unit"));
  video.playbackRate = getVideoRate(video);
}

function ensureVideoSource(video) {
  if (!video.getAttribute("src") && video.dataset.src) {
    video.src = video.dataset.src;
  }
}

function playVideo(video) {
  ensureVideoSource(video);
  video.playbackRate = getVideoRate(video);
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

function playUnit(unit) {
  unit.querySelectorAll("video").forEach(playVideo);
}

function pauseUnit(unit) {
  suppressPauseTracking = true;
  unit.querySelectorAll("video").forEach(video => video.pause());
  suppressPauseTracking = false;
}

function getVideoUnit(element) {
  return element.closest(".ablation-unit") || element.closest(".video-stage") || element.closest(".subject-pair");
}

function setUnitPausedByUser(unit) {
  userPausedUnits.add(unit);
  pauseUnit(unit);
  updateUnitControl(unit);
}

function syncVideoGroup(group) {
  const videos = Array.from(group.querySelectorAll("video"));
  if (videos.length < 2) return;

  const master = videos[0];
  if (master.readyState < HTMLMediaElement.HAVE_METADATA) return;

  videos.slice(1).forEach(video => {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    if (Number.isFinite(master.currentTime) && Math.abs(video.currentTime - master.currentTime) > 0.08) {
      video.currentTime = master.currentTime;
    }
    video.playbackRate = getVideoRate(video);
  });
}

function syncVisibleGroups() {
  if (activeVideoUnit) {
    syncVideoGroup(activeVideoUnit);
  }

  autoDisplayUnits.forEach(unit => {
    if (isPartlyInViewport(unit)) {
      syncVideoGroup(unit);
    }
  });
}

resultVideos.forEach(video => {
  prepareVideo(video);
  video.addEventListener("loadedmetadata", () => {
    video.playbackRate = getVideoRate(video);
  });
  video.addEventListener("ended", () => {
    const unit = getVideoUnit(video);
    if (unit?.classList.contains("auto-display")) {
      video.currentTime = 0;
      playVideo(video);
    }
  });
  video.addEventListener("pause", () => {
    if (!suppressPauseTracking) {
      const unit = getVideoUnit(video);
      if (unit?.classList.contains("auto-display")) {
        return;
      }
      if (unit) {
        setUnitPausedByUser(unit);
      }
    }
  });
  video.addEventListener("play", () => {
    const unit = getVideoUnit(video);
    if (unit?.classList.contains("auto-display")) {
      return;
    }
    if (unit) {
      userPausedUnits.delete(unit);
      activeVideoUnit = unit;
      updateUnitControl(unit);
      videoUnits.forEach(otherUnit => {
        if (otherUnit !== unit) {
          pauseUnit(otherUnit);
          updateUnitControl(otherUnit);
        }
      });
    }
  });
});

function getCenteredVisibleUnit() {
  const centerY = window.innerHeight / 2;
  let bestUnit = null;
  let bestDistance = Infinity;

  videoUnits.forEach(unit => {
    if (!visibleUnits.has(unit) || userPausedUnits.has(unit) || !isFullyInViewport(unit)) {
      return;
    }

    const rect = unit.getBoundingClientRect();
    const unitCenter = rect.top + rect.height / 2;
    const distance = Math.abs(unitCenter - centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestUnit = unit;
    }
  });

  return bestUnit;
}

function isFullyInViewport(element) {
  const rect = element.getBoundingClientRect();
  if (element.classList.contains("ablation-unit")) {
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

function isPartlyInViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

function updateActiveVideoUnit() {
  if (activeVideoUnit && !isFullyInViewport(activeVideoUnit)) {
    pauseUnit(activeVideoUnit);
    updateUnitControl(activeVideoUnit);
    activeVideoUnit = null;
  }

  const nextUnit = getCenteredVisibleUnit();

  if (nextUnit === activeVideoUnit) {
    return;
  }

  if (activeVideoUnit) {
    pauseUnit(activeVideoUnit);
    updateUnitControl(activeVideoUnit);
  }

  activeVideoUnit = nextUnit;
  if (activeVideoUnit) {
    activeVideoUnit.querySelectorAll("video").forEach(video => {
      ensureVideoSource(video);
      video.preload = "auto";
    });
    playUnit(activeVideoUnit);
    updateUnitControl(activeVideoUnit);
  }
}

function updateUnitControl(unit) {
  const control = unit.querySelector(":scope > .video-control");
  if (!control) {
    return;
  }

  const isPlaying = Array.from(unit.querySelectorAll("video")).some(video => !video.paused);
  control.textContent = isPlaying ? "Pause" : "Play";
  control.setAttribute("aria-label", isPlaying ? "Pause video" : "Play video");
}

function toggleUnitPlayback(unit) {
  if (Array.from(unit.querySelectorAll("video")).some(video => !video.paused)) {
    setUnitPausedByUser(unit);
    return;
  }

  userPausedUnits.delete(unit);
  activeVideoUnit = unit;
  videoUnits.forEach(otherUnit => {
    if (otherUnit !== unit) {
      pauseUnit(otherUnit);
      updateUnitControl(otherUnit);
    }
  });
  playUnit(unit);
  updateUnitControl(unit);
}

const videoUnitObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      const unit = entry.target;

      if (entry.isIntersecting) {
        visibleUnits.add(unit);
      } else {
        visibleUnits.delete(unit);
        pauseUnit(unit);
        updateUnitControl(unit);
        if (activeVideoUnit === unit) {
          activeVideoUnit = null;
        }
      }
    });

    updateActiveVideoUnit();
  },
  { threshold: 0.01, rootMargin: "0px" }
);

videoUnits.forEach(unit => {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "video-control";
  control.textContent = "Play";
  control.setAttribute("aria-label", "Play video");
  control.addEventListener("click", event => {
    event.stopPropagation();
    toggleUnitPlayback(unit);
  });
  unit.appendChild(control);
  videoUnitObserver.observe(unit);
});

const autoDisplayObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      const unit = entry.target;
      if (entry.isIntersecting) {
        unit.querySelectorAll("video").forEach(video => {
          ensureVideoSource(video);
          video.preload = "auto";
        });
        playUnit(unit);
      } else {
        pauseUnit(unit);
      }
    });
  },
  { threshold: 0.01, rootMargin: "0px" }
);

autoDisplayUnits.forEach(unit => autoDisplayObserver.observe(unit));

window.addEventListener("scroll", updateActiveVideoUnit, { passive: true });
window.addEventListener("resize", updateActiveVideoUnit);
setInterval(syncVisibleGroups, 700);
