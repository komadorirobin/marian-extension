export const LAST_DETAILS_KEY = "marian.lastDetails";

const storageAPI = typeof browser !== 'undefined' ? browser : chrome;

function getStorageArea() {
  return storageAPI?.storage?.local;
}

function storageGet(key) {
  const area = getStorageArea();
  if (!area) return Promise.resolve({});

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result = {}) => {
      if (settled) return;
      settled = true;
      resolve(result || {});
    };

    try {
      const maybePromise = area.get([key], finish);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(finish).catch(() => finish({}));
      }
    } catch {
      try {
        Promise.resolve(area.get([key])).then(finish).catch(() => finish({}));
      } catch {
        finish({});
      }
    }
  });
}

function storageSet(values) {
  const area = getStorageArea();
  if (!area) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      const maybePromise = area.set(values, finish);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(finish).catch(finish);
      }
    } catch {
      try {
        Promise.resolve(area.set(values)).then(finish).catch(finish);
      } catch {
        finish();
      }
    }
  });
}

export async function saveLastDetails(details, url) {
  if (!details || Object.keys(details).length === 0) return;

  await storageSet({
    [LAST_DETAILS_KEY]: {
      details,
      url: url || "",
      savedAt: Date.now(),
    }
  });
}

export async function getLastDetails() {
  const stored = await storageGet(LAST_DETAILS_KEY);
  const cached = stored[LAST_DETAILS_KEY];
  if (!cached?.details || Object.keys(cached.details).length === 0) return null;
  return cached;
}
