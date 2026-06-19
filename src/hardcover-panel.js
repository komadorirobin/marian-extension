import { getLastDetails, LAST_DETAILS_KEY } from "./shared/lastDetails.js";

const PANEL_ID = "marian-hardcover-panel";
const STYLE_ID = "marian-hardcover-panel-style";

const rows = [
  ["ISBN-13", "ISBN-13"],
  ["ISBN-10", "ISBN-10"],
  ["ASIN", "ASIN"],
  ["Mappings", "Source ID"],
  ["Contributors", "Contributors"],
  ["Publisher", "Publisher"],
  ["Reading Format", "Reading Format"],
  ["Listening Length", "Listening Length"],
  ["Listening Length Seconds", "Total Seconds"],
  ["Pages", "Pages"],
  ["Edition Format", "Edition Format"],
  ["Edition Information", "Edition Information"],
  ["Publication date", "Publication date"],
  ["Language", "Language"],
  ["Country", "Country"],
];

let closed = false;
let currentUrl = location.href;

function isHardcoverEditPage() {
  return location.hostname === "hardcover.app" && /\/editions\/[^/]+\/edit\/?$/.test(location.pathname);
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      top: 72px;
      right: 12px;
      bottom: 16px;
      width: min(320px, calc(100vw - 32px));
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      background: #172234;
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.25);
      box-shadow: 0 20px 48px rgba(15, 23, 42, 0.35);
      border-radius: 10px;
      overflow: hidden;
      font: 13px/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: left;
    }

    #${PANEL_ID} * {
      box-sizing: border-box;
    }

    #${PANEL_ID} .marian-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 42px;
      padding: 0 12px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(15, 23, 42, 0.36);
      font-weight: 700;
    }

    #${PANEL_ID} .marian-close {
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #f8fafc;
      font: 20px/1 system-ui, sans-serif;
      cursor: pointer;
    }

    #${PANEL_ID} .marian-close:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    #${PANEL_ID} .marian-body {
      flex: 1;
      overflow: auto;
      padding: 12px;
    }

    #${PANEL_ID} .marian-top {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr);
      gap: 12px;
      padding-bottom: 12px;
      margin-bottom: 12px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.24);
    }

    #${PANEL_ID} .marian-cover-wrap {
      position: relative;
      width: 88px;
    }

    #${PANEL_ID} .marian-cover {
      display: block;
      width: 88px;
      max-height: 132px;
      object-fit: cover;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
    }

    #${PANEL_ID} .marian-score {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 2px 4px;
      border-radius: 0 0 6px 6px;
      color: white;
      font-size: 11px;
      font-weight: 700;
      text-align: center;
    }

    #${PANEL_ID} .marian-title {
      margin: 0 0 4px;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.2;
    }

    #${PANEL_ID} .marian-description {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 4;
      overflow: hidden;
      color: #cbd5e1;
      font-size: 12px;
      line-height: 1.25;
    }

    #${PANEL_ID} .marian-row {
      margin: 0 0 6px;
      color: #e2e8f0;
      overflow-wrap: anywhere;
    }

    #${PANEL_ID} .marian-label {
      color: #fff;
      font-weight: 700;
    }

    #${PANEL_ID} .marian-copy {
      color: #e2e8f0;
      cursor: pointer;
    }

    #${PANEL_ID} .marian-copy:hover {
      text-decoration: underline;
    }

    #${PANEL_ID} .marian-empty {
      color: #cbd5e1;
      padding: 8px 0;
    }

    #${PANEL_ID} .marian-muted {
      color: #94a3b8;
      font-size: 12px;
    }

    @media (max-width: 760px) {
      #${PANEL_ID} {
        top: 82px;
        right: 8px;
        bottom: 8px;
        width: min(304px, calc(100vw - 16px));
      }
    }
  `;
  document.documentElement.appendChild(style);
}

function valueText(value) {
  if (value == null || value === "") return "";

  if (Array.isArray(value)) {
    return value.map(valueText).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    if ("name" in value && Array.isArray(value.roles)) {
      const roles = value.roles.filter(Boolean).join(", ");
      return roles ? `${value.name} (${roles})` : value.name;
    }

    return Object.entries(value)
      .flatMap(([source, ids]) => {
        const values = Array.isArray(ids) ? ids : [ids];
        return values.filter(Boolean).map((id) => `${id} (${source})`);
      })
      .join(", ");
  }

  return String(value);
}

function scoreLabel(score) {
  if (typeof score !== "number") return null;
  if (score < 33000) return { text: "Poor", color: "#c0392b" };
  if (score < 100000) return { text: "Medium", color: "#f39c12" };
  return { text: "High", color: "#27ae60" };
}

function copyValue(text, node) {
  if (!text || !navigator.clipboard?.writeText) return;

  navigator.clipboard.writeText(text).then(() => {
    const original = node.textContent;
    node.textContent = "Copied";
    setTimeout(() => {
      node.textContent = original;
    }, 900);
  }).catch(() => { });
}

function createCopySpan(text) {
  const span = document.createElement("span");
  span.className = "marian-copy";
  span.textContent = text;
  span.title = "Click to copy";
  span.addEventListener("click", () => copyValue(text, span));
  return span;
}

function renderRows(details, container) {
  if (details.Series || details["Series Place"]) {
    const series = document.createElement("div");
    series.className = "marian-row";
    if (details.Series) {
      series.appendChild(label("Series"));
      series.appendChild(createCopySpan(valueText(details.Series)));
    }
    if (details.Series && details["Series Place"]) {
      series.appendChild(document.createTextNode(" "));
    }
    if (details["Series Place"]) {
      series.appendChild(label("Series Place"));
      series.appendChild(createCopySpan(valueText(details["Series Place"])));
    }
    container.appendChild(series);
  }

  rows.forEach(([key, display]) => {
    const text = valueText(details[key]);
    if (!text) return;

    const row = document.createElement("div");
    row.className = "marian-row";
    row.appendChild(label(display));
    row.appendChild(createCopySpan(text));
    container.appendChild(row);
  });
}

function label(text) {
  const span = document.createElement("span");
  span.className = "marian-label";
  span.textContent = `${text}: `;
  return span;
}

function renderDetails(panel, details) {
  const body = panel.querySelector(".marian-body");
  body.innerHTML = "";

  if (!details || Object.keys(details).length === 0) {
    const empty = document.createElement("div");
    empty.className = "marian-empty";
    empty.textContent = "No checked-out details yet.";
    body.appendChild(empty);

    const muted = document.createElement("div");
    muted.className = "marian-muted";
    muted.textContent = "Open a supported product page with Marian first.";
    body.appendChild(muted);
    return;
  }

  const top = document.createElement("div");
  top.className = "marian-top";

  const coverWrap = document.createElement("div");
  coverWrap.className = "marian-cover-wrap";

  const cover = document.createElement("img");
  cover.className = "marian-cover";
  cover.alt = "";
  cover.src = details.img || chrome.runtime.getURL("icons/third-party/hardcover.svg");
  coverWrap.appendChild(cover);

  const score = scoreLabel(details.imgScore);
  if (score) {
    const scoreEl = document.createElement("div");
    scoreEl.className = "marian-score";
    scoreEl.textContent = score.text;
    scoreEl.style.background = score.color;
    coverWrap.appendChild(scoreEl);
  }

  const summary = document.createElement("div");
  const title = document.createElement("div");
  title.className = "marian-title";
  title.appendChild(createCopySpan(valueText(details.Title) || "Untitled"));
  summary.appendChild(title);

  if (details.Description) {
    const description = document.createElement("div");
    description.className = "marian-description";
    description.appendChild(createCopySpan(valueText(details.Description)));
    summary.appendChild(description);
  }

  top.appendChild(coverWrap);
  top.appendChild(summary);
  body.appendChild(top);

  renderRows(details, body);
}

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;

  ensureStyles();

  panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.setAttribute("aria-label", "Marian");

  const header = document.createElement("div");
  header.className = "marian-header";

  const title = document.createElement("span");
  title.textContent = "Marian";

  const close = document.createElement("button");
  close.className = "marian-close";
  close.type = "button";
  close.setAttribute("aria-label", "Close Marian panel");
  close.textContent = "x";
  close.addEventListener("click", () => {
    closed = true;
    panel.remove();
  });

  header.appendChild(title);
  header.appendChild(close);

  const body = document.createElement("div");
  body.className = "marian-body";

  panel.appendChild(header);
  panel.appendChild(body);
  document.documentElement.appendChild(panel);

  return panel;
}

async function renderPanel() {
  if (closed) return;

  if (!isHardcoverEditPage()) {
    document.getElementById(PANEL_ID)?.remove();
    return;
  }

  const panel = ensurePanel();
  const cached = await getLastDetails();
  renderDetails(panel, cached?.details);
}

function watchUrlChanges() {
  setInterval(() => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    closed = false;
    renderPanel();
  }, 1000);
}

function init() {
  renderPanel();
  watchUrlChanges();

  const api = typeof browser !== "undefined" ? browser : chrome;
  api?.storage?.onChanged?.addListener((changes) => {
    if (LAST_DETAILS_KEY in changes) renderPanel();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
