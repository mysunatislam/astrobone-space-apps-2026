import "./twin.css";
import "./labTheme.css";
import { EXPERIENCES, CAPTURE } from "./siteNav.js";
import { registerOffline } from "./offline.js";

// Live Capture uses the twin's header, menu and palette, so the two pages read as one app. The page's
// own (older) top bar stays in the DOM for the code that reads it, hidden by labTheme.css.
registerOffline();
document.documentElement.dataset.theme = "dark";
document.body.classList.add("lab-body");

const link = (href, label, current = false) => {
  const a = document.createElement("a"); a.href = href; a.textContent = label;
  if (current) a.setAttribute("aria-current", "page");
  return a;
};
const header = document.createElement("header");
header.className = "tw-top lab-top";
header.innerHTML = `<a class="tw-brand" href="./" aria-label="AstroBone home"><span class="tw-mark" aria-hidden="true"></span><span><b>ASTROBONE</b><small>DIGITAL PHYSIOLOGICAL TWIN</small></span></a>
  <nav class="tw-nav" aria-label="AstroBone sections"></nav>
  <span class="lab-chip"><i aria-hidden="true"></i>On this device · nothing uploaded</span>`;
const nav = header.querySelector("nav");
for (const [key, label] of EXPERIENCES) nav.append(link(`./#${key}`, label));
const live = link(CAPTURE.href, CAPTURE.label, true); live.className = "tw-live"; live.prepend(Object.assign(document.createElement("i"), { ariaHidden: "true" }));
nav.after(live);
document.body.prepend(header);
