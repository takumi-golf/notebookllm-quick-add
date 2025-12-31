// === NotebookLLM Quick Add - Background Script ===

// Enable Side Panel to open on icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

let iframePort = null;
let currentNotebookUrl = null;

// === Connection Handling ===
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "notebook-iframe") {
    iframePort = port;
    port.onDisconnect.addListener(() => {
      iframePort = null;
    });
  }
});

// === Helper: Get Notebook ID ===
function getNotebookId(url) {
  if (!url) return null;
  const match = url.match(/\/notebook\/([^\/]+)/);
  return match ? match[1] : null;
}

// === Helper: Check for Duplicates ===
async function isDuplicate(url, notebookId) {
  if (!notebookId) return false; // If we don't know the notebook, assume no duplicate (safer)

  const data = await chrome.storage.local.get("history");
  const history = data.history || [];
  // Simple normalization
  const normalizedUrl = url.replace(/\/$/, "");

  return history.some(item => {
    // Only check items that belong to the SAME notebook
    if (item.notebookId && item.notebookId === notebookId) {
      return item.url.replace(/\/$/, "") === normalizedUrl;
    }
    return false;
  });
}

// === Message Handling ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "forwardToAddSource") {
    (async () => {
      chrome.tabs.query({}, async (allTabs) => {
        const suitableTab = allTabs.find(tab =>
          tab.active &&
          tab.url &&
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.includes('notebooklm.google.com')
        );

        const fallbackTab = allTabs.find(tab =>
          tab.url &&
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.includes('notebooklm.google.com')
        );

        const selectedTab = suitableTab || fallbackTab;

        if (!selectedTab) {
          sendResponse({ success: false, error: "追加可能なタブが見つかりません" });
          return;
        }

        const currentUrl = getUrlWithTimestamp(selectedTab);
        const notebookId = getNotebookId(currentNotebookUrl);


        if (iframePort) {
          try {
            iframePort.postMessage({ action: "addSource", url: currentUrl });
            saveToHistory(currentUrl, selectedTab.title, notebookId);
            sendResponse({ success: true });
          } catch (e) {
            iframePort = null;
            sendResponse({ success: false, error: "接続が切れました" });
          }
        } else {
          sendResponse({ success: false, error: "サイドパネル内のNotebookLMをクリックしてください" });
        }
      });
    })();
    return true; // Keep channel open
  } else if (request.action === "addManualSource") {
    (async () => {
      const manualUrl = request.url;


      if (iframePort) {
        try {
          iframePort.postMessage({ action: "addSource", url: manualUrl });
          saveToHistory(manualUrl, "手動入力: " + manualUrl, notebookId);
          sendResponse({ success: true });
        } catch (e) {
          iframePort = null;
          sendResponse({ success: false, error: "接続が切れました" });
        }
      } else {
        sendResponse({ success: false, error: "NotebookLMに接続していません" });
      }
    })();
    return true; // Keep channel open
  } else if (request.action === "addManualText") {
    (async () => {
      const text = request.text;
      if (iframePort) {
        try {
          iframePort.postMessage({ action: "pasteText", text: text });
          saveToHistory("Text Input", "Text: " + text.substring(0, 30) + "...");
          sendResponse({ success: true });
        } catch (e) {
          iframePort = null;
          sendResponse({ success: false, error: "接続が切れました" });
        }
      } else {
        sendResponse({ success: false, error: "NotebookLMに接続していません" });
      }
    })();
    return true;
  } else if (request.action === "triggerAction") {
    // Direct Action Trigger (Upload, Drive, Text)
    if (iframePort) {
      try {
        iframePort.postMessage({ action: "triggerAction", type: request.type });
        sendResponse({ success: true });
      } catch (e) {
        iframePort = null;
        sendResponse({ success: false, error: "接続が切れました" });
      }
    } else {
      sendResponse({ success: false, error: "NotebookLMのタブを開いてください" });
    }
    return true;
  } else if (request.action === "notebookUrlChanged") {
    currentNotebookUrl = request.url;
    updateBadge(request.url);
  } else if (request.action === "automationComplete") {
    showNotification(request.success, request.url);
  } else if (request.action === "getHistory") {
    chrome.storage.local.get("history", (data) => {
      sendResponse({ history: data.history || [] });
    });
  } else if (request.action === "clearHistory") {
    chrome.storage.local.set({ history: [] }, () => {
      sendResponse({ success: true });
    });
  }
  return true;
});

// === Context Menu ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-notebooklm",
    title: "NotebookLMに追加",
    contexts: ["page", "link", "video"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "add-to-notebooklm") {
    const url = info.linkUrl || info.pageUrl;
    const notebookId = getNotebookId(currentNotebookUrl);

    addSourceToNotebook(url, tab, notebookId);
  }
});

// === Keyboard Shortcut ===
chrome.commands.onCommand.addListener((command) => {
  if (command === "add-current-page") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      if (tabs[0]) {
        const url = getUrlWithTimestamp(tabs[0]);
        const notebookId = getNotebookId(currentNotebookUrl);

        addSourceToNotebook(url, tabs[0], notebookId);
      }
    });
  }
});

// === YouTube Timestamp Support ===
function getUrlWithTimestamp(tab) {
  let url = tab.url;

  // For YouTube, try to get current timestamp
  if (url.includes('youtube.com/watch')) {
    // The timestamp will be added by content script if playing
    // For now, return URL with t param if it exists, otherwise base URL
    // Future improvement: inject script to get exact current time
  }

  return url;
}

// === Add Source Function ===
function addSourceToNotebook(url, tab, notebookId) {
  if (iframePort) {
    iframePort.postMessage({ action: "addSource", url: url });
    saveToHistory(url, tab?.title || url, notebookId);
  } else {
    // Open side panel first if not connected
    chrome.sidePanel.open({ windowId: tab.windowId });
    // Retry after delay
    setTimeout(() => {
      if (iframePort) {
        iframePort.postMessage({ action: "addSource", url: url });
        saveToHistory(url, tab?.title || url, notebookId);
      }
    }, 2000);
  }
}

// === History ===
async function saveToHistory(url, title, notebookId) {
  const data = await chrome.storage.local.get("history");
  const history = data.history || [];

  // Add to beginning, limit to 50 items
  history.unshift({
    url: url,
    title: title,
    date: new Date().toISOString(),
    notebookId: notebookId || null // Save context
  });

  if (history.length > 50) {
    history.pop();
  }

  await chrome.storage.local.set({ history: history });
}

// === Badge Counter ===
function updateBadge(url) {
  if (url && url.includes('/notebook/')) {
    // Show "N" to indicate notebook is selected
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#00C853" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// === Notifications ===
function showNotification(success, url, customMessage = null) {
  const title = success ? "ソースを追加しました" : "エラー";

  let message = "";
  if (customMessage) {
    message = customMessage;
  } else {
    message = success
      ? url.substring(0, 50) + (url.length > 50 ? "..." : "")
      : "もう一度お試しください";
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: title,
    message: message
  });
}
