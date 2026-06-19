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

async function renderCachedDetailsForUnsupportedPage(url) {
  const cached = await getLastDetails();
  if (!cached) {
    showStatus("This extension only works on supported product pages.");
    return;
  }

  await renderDetailsForUrl(cached.details, cached.url);
  updateRefreshButtonForUrl(url, { hasCachedDetails: true });
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
      await renderCachedDetailsForUnsupportedPage(url);
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
