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

// Download is a placeholder until signed releases exist.
document.querySelectorAll('[aria-disabled="true"]').forEach((el) =>
  el.addEventListener("click", (e) => e.preventDefault()),
);
