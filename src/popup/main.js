import { isAllowedUrl } from "../extractors";
import { tryGetDetails } from "./messaging.js";
import {
  showStatus, showDetails, renderDetails, initSidebarLogger,
  addRefreshButton, updateRefreshButtonForUrl
} from "./ui.js";
import {
  setLastFetchedUrl, getCurrentTab, notifyBackground, rememberWindowId,
  isForThisSidebar, saveLastDetails, getLastDetails
} from "./utils.js";

const DEBUG = false;

function hasNativeSidebar() {
  return typeof chrome.sidePanel !== "undefined" || typeof chrome.sidebarAction !== "undefined";
}

function isHardcoverEditUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "hardcover.app" && /\/editions\/[^/]+\/edit\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function queryTabs(query) {
  return new Promise((resolve) => {
    try {
      const maybePromise = chrome.tabs.query(query, (tabs) => {
        resolve(tabs || []);
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve).catch(() => resolve([]));
      }
    } catch {
      resolve([]);
    }
  });
}

async function findSupportedSiblingTab(currentTab, context = null) {
  const tabs = await queryTabs({ currentWindow: true });
  const candidates = tabs
    .filter((tab) => tab?.id !== currentTab?.id && tab?.url && isAllowedUrl(tab.url))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  if (!context?.isbn && !context?.isbns?.length) return candidates[0];

  return candidates.find((tab) => tabLikelyMatchesContext(tab, context));
}

async function renderDetailsForUrl(details, url) {
  showDetails();
  const detailsEl = document.getElementById('details');
  if (detailsEl) detailsEl.innerHTML = "";
  await renderDetails(details);

  setLastFetchedUrl(url || "");
}

async function fetchAndRenderCurrentTab() {
  showStatus("Loading details...");
  let tab = await getCurrentTab();
  try {
    const details = await tryGetDetails(tab);
    await saveLastDetails(details, tab?.url || "");
    await renderDetailsForUrl(details, tab?.url || "");

    getCurrentTab().then((activeTab) => {
      updateRefreshButtonForUrl(activeTab?.url || "");
    });
  } catch (err) {
    console.log("err", err);
    showStatus(err);
    notifyBackground("REFRESH_ICON", { tab });
  };
}

async function renderCachedDetailsForUnsupportedPage(url, tab) {
  const hardcover = isHardcoverEditUrl(url);
  const context = hardcover ? await getHardcoverContextFromTab(tab) : null;
  const cached = await getLastDetails();
  const cachedMatches = !hardcover || detailsMatchContext(cached?.details, context);

  if (cached && cachedMatches) {
    await renderDetailsForUrl(cached.details, cached.url);
    updateRefreshButtonForUrl(url, { hasCachedDetails: true });
    return;
  }

  if (!hardcover) {
    showStatus("This extension only works on supported product pages.");
    return;
  }

  const sourceTab = await findSupportedSiblingTab(tab, context);
  if (!sourceTab) {
    showStatus(cached
      ? "Checked-out details are for another book. Open a matching source page or use the automatic sources on this Hardcover edit page."
      : "No checked-out details yet. Open a supported product page with Marian first.");
    return;
  }

  try {
    showStatus("Loading details from another supported tab...");
    const details = await tryGetDetails(sourceTab);
    if (!detailsMatchContext(details, context)) {
      showStatus("The source tab is for another book. Open a matching source page first.");
      return;
    }
    await saveLastDetails(details, sourceTab.url || "");
    await renderDetailsForUrl(details, sourceTab.url || "");
    updateRefreshButtonForUrl(url, { hasCachedDetails: true });
  } catch (err) {
    console.log("fallback tab fetch failed", err);
    showStatus(err);
  }
}

async function getHardcoverContextFromTab(tab) {
  if (!tab?.id) return null;

  const fromContentScript = await sendTabMessage(tab.id, { type: "GET_HARDCOVER_CONTEXT" });
  if (fromContentScript?.isbn || fromContentScript?.title) return fromContentScript;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectHardcoverContextFromPage,
    });
    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

function sendTabMessage(tabId, msg) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function collectHardcoverContextFromPage() {
  function clean(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\p{Cf}/gu, "")
      .replace(/[\u200E\u200F\u202A-\u202E\u00A0\uFEFF‎‏]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const texts = [document.body?.innerText || ""];
  document.querySelectorAll("input, textarea").forEach((input) => {
    if (input.value) texts.push(input.value);
  });

  const matches = texts.join("\n").match(/(?:97[89][-\s]?)?(?:\d[-\s]?){8,16}[\dX]/gi) || [];
  const isbns = [...new Set(matches
    .map((value) => value.replace(/[^0-9X]/gi, ""))
    .filter((value) => value.length === 10 || value.length === 13))];

  const field = Array.from(document.querySelectorAll("input, textarea")).find((input) => {
    const name = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
    return name.includes("title") && clean(input.value);
  });

  const title = clean(field?.value || document.querySelector("h1")?.textContent || "");
  const isbn = isbns.find((value) => value.length === 13) || isbns[0] || "";
  return { isbn, title, isbns };
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

function tabLikelyMatchesContext(tab, context) {
  const contextIsbns = expandIsbns(context?.isbns?.length ? context.isbns : [context?.isbn]);
  if (!contextIsbns.length) return true;

  const tabIsbns = expandIsbns((`${tab.url || ""} ${tab.title || ""}`.match(/(?:97[89][-\s]?)?(?:\d[-\s]?){8,16}[\dX]/gi) || []));
  return tabIsbns.some((isbn) => contextIsbns.includes(isbn));
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
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

document.addEventListener("DOMContentLoaded", () => {
  if (hasNativeSidebar()) {
    notifyBackground("SIDEBAR_READY");
    window.addEventListener("pagehide", () => notifyBackground("SIDEBAR_UNLOADED"));
  }

  chrome.windows.getCurrent(rememberWindowId);

  if (DEBUG) initSidebarLogger(); // DEBUG: Initialize sidebar logger

  getCurrentTab().then(async (tab) => {
    const url = tab?.url || "";

    showStatus("DOM Loaded, fetching details...");

    addRefreshButton();
    updateRefreshButtonForUrl(url);

    if (!isAllowedUrl(url)) {
      await renderCachedDetailsForUnsupportedPage(url, tab);
      return;
    }

    if (!hasNativeSidebar()) {
      await fetchAndRenderCurrentTab();
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SIDEBAR_PING") {
    if (isForThisSidebar(msg.windowId)) {
      sendResponse("pong");
    }
    return;
  }

  if (msg.type === "REFRESH_SIDEBAR" && isForThisSidebar(msg.windowId) && msg.url && isAllowedUrl(msg.url)) {
    fetchAndRenderCurrentTab();
  }

  if (msg.type === "TAB_URL_CHANGED" && isForThisSidebar(msg.windowId)) {
    updateRefreshButtonForUrl(msg.url);
  }
});
