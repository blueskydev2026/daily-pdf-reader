importScripts("../web-app-config.js");

const PACKAGED_READER_URL = chrome.runtime.getURL("index.html");
const WEB_READER_URL = normalizeWebAppUrl(globalThis.DAILY_PDF_READER_WEB_APP_URL);
const READER_URL = WEB_READER_URL || PACKAGED_READER_URL;

chrome.action.onClicked.addListener(() => {
  openReader();
});

function openReader() {
  chrome.tabs.create({ url: READER_URL });
}

function normalizeWebAppUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}
