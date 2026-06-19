import { getLastDetails, LAST_DETAILS_KEY } from "./shared/lastDetails.js";
import { getLibrisDetailsWithPhysicalByIsbn } from "./extractors/libris.js";
import { getAdlibrisDetailsFromHtml } from "./extractors/adlibris.js";
import { cleanText, fetchBackground } from "./shared/utils.js";

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
  ["Weight", "Weight"],
  ["Edition Format", "Edition Format"],
  ["Edition Information", "Edition Information"],
  ["Publication date", "Publication date"],
  ["Language", "Language"],
  ["Country", "Country"],
];

let closed = false;
let currentUrl = location.href;
let autoLookupState = { key: "", context: null, loading: false, results: [] };
let autoLookupRun = 0;

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

    #${PANEL_ID} .marian-sources {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(148, 163, 184, 0.24);
    }

    #${PANEL_ID} .marian-section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0 0 8px;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    #${PANEL_ID} .marian-source {
      padding: 10px 0;
      border-top: 1px solid rgba(148, 163, 184, 0.16);
    }

    #${PANEL_ID} .marian-source:first-of-type {
      border-top: 0;
      padding-top: 0;
    }

    #${PANEL_ID} .marian-source-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    #${PANEL_ID} .marian-source-name {
      color: #fff;
      font-weight: 700;
    }

    #${PANEL_ID} .marian-source-link {
      color: #93c5fd;
      font-size: 12px;
      text-decoration: none;
    }

    #${PANEL_ID} .marian-source-link:hover {
      text-decoration: underline;
    }

    #${PANEL_ID} .marian-source-error {
      color: #fbbf24;
      font-size: 12px;
      line-height: 1.3;
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

function createSourceLink(url, text = "Open") {
  const link = document.createElement("a");
  link.className = "marian-source-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

function label(text) {
  const span = document.createElement("span");
  span.className = "marian-label";
  span.textContent = `${text}: `;
  return span;
}

function renderDetails(panel, details, autoLookup) {
  const body = panel.querySelector(".marian-body");
  body.innerHTML = "";

  if (!details || Object.keys(details).length === 0) {
    const hasAutoResults = (autoLookup?.results || []).some((source) => source.details);
    const empty = document.createElement("div");
    empty.className = "marian-empty";
    empty.textContent = hasAutoResults
      ? "Automatic sources found."
      : autoLookup?.loading
        ? "Looking up sources..."
        : "No checked-out details yet.";
    body.appendChild(empty);

    const muted = document.createElement("div");
    muted.className = "marian-muted";
    muted.textContent = hasAutoResults
      ? "Copy values from the source sections below."
      : autoLookup?.context?.isbn
      ? `Automatic lookup for ISBN ${autoLookup.context.isbn}.`
      : "Open a supported product page with Marian first.";
    body.appendChild(muted);
    renderAutoSources(autoLookup, body);
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
  renderAutoSources(autoLookup, body);
}

function renderAutoSources(autoLookup, body) {
  if (!autoLookup?.context?.isbn) return;

  const section = document.createElement("div");
  section.className = "marian-sources";

  const title = document.createElement("div");
  title.className = "marian-section-title";
  title.appendChild(document.createTextNode("Automatic sources"));
  title.appendChild(createCopySpan(autoLookup.context.isbn));
  section.appendChild(title);

  if (autoLookup.loading) {
    const muted = document.createElement("div");
    muted.className = "marian-muted";
    muted.textContent = "Checking Libris and Adlibris...";
    section.appendChild(muted);
  }

  for (const source of autoLookup.results || []) {
    const sourceEl = document.createElement("div");
    sourceEl.className = "marian-source";

    const head = document.createElement("div");
    head.className = "marian-source-head";

    const name = document.createElement("span");
    name.className = "marian-source-name";
    name.textContent = source.name;
    head.appendChild(name);

    if (source.url) head.appendChild(createSourceLink(source.url));
    sourceEl.appendChild(head);

    if (source.details && Object.keys(source.details).length > 0) {
      if (source.details.Title) {
        const row = document.createElement("div");
        row.className = "marian-row";
        row.appendChild(label("Title"));
        row.appendChild(createCopySpan(valueText(source.details.Title)));
        sourceEl.appendChild(row);
      }

      if (source.details.Description) {
        const description = document.createElement("div");
        description.className = "marian-description";
        description.appendChild(createCopySpan(valueText(source.details.Description)));
        sourceEl.appendChild(description);
      }

      renderRows(source.details, sourceEl);
    }

    if (source.error) {
      const error = document.createElement("div");
      error.className = "marian-source-error";
      error.textContent = source.error;
      sourceEl.appendChild(error);
    }

    section.appendChild(sourceEl);
  }

  if (!autoLookup.loading && !(autoLookup.results || []).length) {
    const muted = document.createElement("div");
    muted.className = "marian-muted";
    muted.textContent = "No automatic sources found.";
    section.appendChild(muted);
  }

  body.appendChild(section);
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
  const context = getHardcoverContext();
  const autoLookup = ensureAutoLookup(context);
  const cached = await getLastDetails();
  const details = detailsMatchContext(cached?.details, context) ? cached?.details : null;
  renderDetails(panel, details, autoLookup);
}

function ensureAutoLookup(context) {
  const key = context?.isbn ? `${context.isbn}|${context.title || ""}` : "";
  if (!key) {
    autoLookupState = { key: "", context, loading: false, results: [] };
    return autoLookupState;
  }

  if (autoLookupState.key === key) return autoLookupState;

  const runId = ++autoLookupRun;
  autoLookupState = { key, context, loading: true, results: [] };

  lookupAutomaticSources(context).then((results) => {
    if (runId !== autoLookupRun) return;
    autoLookupState = { key, context, loading: false, results };
    renderPanel();
  }).catch((error) => {
    if (runId !== autoLookupRun) return;
    autoLookupState = {
      key,
      context,
      loading: false,
      results: [{ name: "Automatic lookup", error: error.message || String(error) }],
    };
    renderPanel();
  });

  return autoLookupState;
}

async function lookupAutomaticSources(context) {
  const groups = await Promise.all([
    lookupLibrisSources(context),
    lookupAdlibrisSource(context),
  ]);

  return groups.flat().filter(Boolean);
}

async function lookupLibrisSources(context) {
  try {
    const { details, physicalDetails, physicalRecordUrl, physicalError } = await getLibrisDetailsWithPhysicalByIsbn(context.isbn);
    const sources = [{
      name: "Libris",
      url: firstMapping(details, "Libris URI") || `https://libris.kb.se/find?q=isbn:${encodeURIComponent(context.isbn)}`,
      details,
    }];

    if (physicalDetails) {
      sources.push({
        name: "Libris physical edition",
        url: physicalRecordUrl || firstMapping(physicalDetails, "Libris URI"),
        details: physicalDetails,
      });
    } else if (physicalError) {
      sources.push({
        name: "Libris physical edition",
        url: firstMapping(details, "Libris URI") || `https://libris.kb.se/find?q=isbn:${encodeURIComponent(context.isbn)}`,
        error: physicalError,
      });
    }

    return sources;
  } catch {
    return [{
      name: "Libris",
      url: `https://libris.kb.se/find?q=isbn:${encodeURIComponent(context.isbn)}`,
      error: "No exact Libris record found.",
    }];
  }
}

async function lookupAdlibrisSource(context) {
  const url = buildAdlibrisProductUrl(context);
  const searchUrl = buildAdlibrisSearchUrl(context);
  if (!url && !searchUrl) return null;

  try {
    const html = await fetchBackground(url, {
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const details = await getAdlibrisDetailsFromHtml(html, url);

    if (!details?.Title || details.Title === "Vercel Security Checkpoint") {
      throw new Error("Adlibris blocked automated fetch");
    }

    return { name: "Adlibris", url, details };
  } catch {
    return {
      name: "Adlibris",
      url: searchUrl || url,
      error: "Open the source link if Adlibris asks Safari to verify the browser first.",
    };
  }
}

function firstMapping(details, source) {
  const values = details?.Mappings?.[source];
  return Array.isArray(values) ? values[0] : values;
}

function buildAdlibrisProductUrl(context) {
  if (!context?.isbn) return "";
  const slug = slugify(context.title || "bok");
  if (!slug) return "";
  return `https://www.adlibris.com/sv/bok/${slug}-${context.isbn}`;
}

function buildAdlibrisSearchUrl(context) {
  if (!context?.isbn) return "";
  return `https://www.adlibris.com/sv/sok?q=${encodeURIComponent(context.isbn)}`;
}

function getHardcoverContext() {
  const isbns = getPageIsbns();
  const isbn = isbns.find((value) => value.length === 13) || isbns[0] || "";
  const title = getHardcoverTitle();
  return { isbn, title, isbns };
}

function getPageIsbns() {
  const texts = [document.body?.innerText || ""];
  document.querySelectorAll("input, textarea").forEach((input) => {
    if (input.value) texts.push(input.value);
  });

  const matches = texts.join("\n").match(/(?:97[89][-\s]?)?(?:\d[-\s]?){8,16}[\dX]/gi) || [];
  const isbns = matches
    .map((value) => value.replace(/[^0-9X]/gi, ""))
    .filter((value) => value.length === 10 || value.length === 13);

  return [...new Set(isbns)];
}

function detailsMatchContext(details, context) {
  if (!details || !context) return false;

  const contextIsbns = expandIsbns(context.isbns?.length ? context.isbns : [context.isbn]);
  const detailIsbns = expandIsbns(getDetailsIsbns(details));

  if (contextIsbns.length && detailIsbns.length) {
    return detailIsbns.some((isbn) => contextIsbns.includes(isbn));
  }

  const contextTitle = normalizeComparableTitle(context.title);
  const detailTitle = normalizeComparableTitle(details.Title);
  if (contextTitle && detailTitle) {
    return contextTitle === detailTitle || contextTitle.includes(detailTitle) || detailTitle.includes(contextTitle);
  }

  return !contextIsbns.length;
}

function getDetailsIsbns(details) {
  const values = [
    details?.["ISBN-13"],
    details?.["ISBN-10"],
  ];

  for (const ids of Object.values(details?.Mappings || {})) {
    values.push(...(Array.isArray(ids) ? ids : [ids]));
  }

  return values;
}

function expandIsbns(values) {
  const result = [];

  for (const value of values || []) {
    const isbn = cleanIsbn(value);
    if (!isbn) continue;

    result.push(isbn);
    if (isbn.length === 10) {
      const isbn13 = isbn13From10(isbn);
      if (isbn13) result.push(isbn13);
    }
  }

  return [...new Set(result)];
}

function cleanIsbn(value) {
  const isbn = String(value || "").replace(/[^0-9X]/gi, "");
  return isbn.length === 10 || isbn.length === 13 ? isbn : "";
}

function isbn13From10(isbn) {
  if (!/^\d{9}[\dX]$/i.test(isbn)) return "";

  const body = `978${isbn.slice(0, 9)}`;
  const checksum = (10 - ([...body].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10)) % 10;
  return `${body}${checksum}`;
}

function normalizeComparableTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function getHardcoverTitle() {
  const field = Array.from(document.querySelectorAll("input, textarea")).find((input) => {
    const name = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
    return name.includes("title") && cleanText(input.value);
  });

  return cleanText(field?.value || document.querySelector("h1")?.textContent || "");
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " och ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function watchUrlChanges() {
  setInterval(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      closed = false;
      autoLookupRun += 1;
      autoLookupState = { key: "", context: null, loading: false, results: [] };
      renderPanel();
      return;
    }

    const context = getHardcoverContext();
    const key = context?.isbn ? `${context.isbn}|${context.title || ""}` : "";
    if (key && key !== autoLookupState.key) renderPanel();
  }, 1000);
}

function init() {
  renderPanel();
  watchUrlChanges();

  const api = typeof browser !== "undefined" ? browser : chrome;
  api?.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== "GET_HARDCOVER_CONTEXT") return false;
    sendResponse(getHardcoverContext());
    return false;
  });

  api?.storage?.onChanged?.addListener((changes) => {
    if (LAST_DETAILS_KEY in changes) renderPanel();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
