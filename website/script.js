// Theme: System (default) → Light → Dark, persisted in localStorage.
const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");
const MODES = ["system", "light", "dark"];
const LABELS = { system: "System", light: "Light", dark: "Dark" };

function currentMode() {
  const t = root.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

function applyMode(mode) {
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    if (mode === "system") localStorage.removeItem("kayet-theme");
    else localStorage.setItem("kayet-theme", mode);
  } catch {}
  toggle.dataset.mode = mode;
  toggle.title = toggle.ariaLabel = `Theme: ${LABELS[mode]}`;
}

applyMode(currentMode());
toggle.addEventListener("click", () => {
  const next = MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length];
  applyMode(next);
});

// Install command: a click copies it (DataFast counts the click through data-fast-goal).
document.querySelectorAll(".install-cmd").forEach((button) => {
  const label = button.ariaLabel;
  let timer;
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.querySelector("code").textContent);
    button.classList.add("copied");
    button.ariaLabel = "Copied";
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.classList.remove("copied");
      button.ariaLabel = label;
    }, 1500);
  });
});

// Scroll reveal, staggered within each section.
document.querySelectorAll("section").forEach((section) => {
  section.querySelectorAll(".reveal").forEach((el, i) => {
    el.style.setProperty("--delay", `${Math.min(i, 6) * 70}ms`);
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        entry.target.addEventListener("transitionend", () => entry.target.classList.add("done"), { once: true });
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
);
document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

// Promo video: plays in a modal. The YouTube embed (privacy-enhanced mode) is created on open
// and removed on close, so nothing loads from YouTube until asked and playback stops on close.
const modal = document.querySelector(".video-modal");
if (modal) {
  const frame = modal.querySelector(".video-frame");

  function closeVideo() {
    modal.close();
  }

  document.querySelectorAll("[data-video]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube-nocookie.com/embed/${link.dataset.video}?autoplay=1&rel=0&playsinline=1`;
      iframe.title = "kayet promo video";
      iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      frame.replaceChildren(iframe);
      modal.showModal();
    });
  });

  modal.querySelector(".video-close").addEventListener("click", closeVideo);
  // A click on the backdrop (the dialog itself, outside the frame) closes it.
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeVideo();
  });
  modal.addEventListener("close", () => frame.replaceChildren());
}
