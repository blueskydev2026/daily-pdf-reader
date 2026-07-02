const READER_URL = chrome.runtime.getURL("index.html");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-reader",
    title: "פתח את קורא PDF יומי",
    contexts: ["action", "page", "selection", "link"]
  });
});

chrome.action.onClicked.addListener(() => {
  openReader();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-reader") {
    openReader();
  }
});

function openReader() {
  chrome.tabs.create({ url: READER_URL });
}
