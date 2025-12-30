// === Side Panel Logic (Enhanced UI/UX) ===

document.addEventListener('DOMContentLoaded', async () => {
    const iframe = document.getElementById('notebookFrame');
    const addBtn = document.getElementById('addBtn');
    const placeholder = document.getElementById('placeholder');
    // const extraActions = document.getElementById('extraActions'); // Removed from DOM

    // Initialize Localization
    localizeHtml();

    // Action Buttons
    // Action Buttons
    // const btnUpload = document.getElementById('btnUpload'); // Removed
    const btnUrl = document.getElementById('btnUrl');
    const btnText = document.getElementById('btnText');
    const btnDonate = document.getElementById('btnDonate');

    // Input UI Elements
    const manualInputContainer = document.getElementById('manualInputContainer');
    const manualUrlInput = document.getElementById('manualUrl');
    const manualAddBtn = document.getElementById('manualAddBtn');

    const textInputContainer = document.getElementById('textInputContainer');
    const manualTextTextarea = document.getElementById('manualTextTextarea');
    const manualTextAddBtn = document.getElementById('manualTextAddBtn');

    // History UI
    const historyBtn = document.getElementById('historyBtn');
    const historyPanel = document.getElementById('historyPanel');
    const closeHistory = document.getElementById('closeHistory');
    const historyList = document.getElementById('historyList');
    const clearHistory = document.getElementById('clearHistory');

    const shortcutHint = document.getElementById('shortcutHint');

    // Is Notebook Selected?
    let isNotebookSelected = false;

    // --- Visualization & State Management ---
    function updateState(selected) {
        isNotebookSelected = selected;
        if (selected) {
            addBtn.classList.remove('hidden');
            placeholder.classList.add('hidden');
            // Buttons are now always visible in header, or we can toggle them if we want strict behavior
            // But user asked for them next to Add button, so likely always visible or visible when notebook selected
            // Let's keep them visible only when notebook selected for consistency with "Add" button context
            btnUrl.style.display = 'flex';
            btnText.style.display = 'flex';
            shortcutHint.classList.remove('hidden');
        } else {
            addBtn.classList.add('hidden');
            placeholder.classList.remove('hidden');
            btnUrl.style.display = 'none';
            btnText.style.display = 'none';
            shortcutHint.classList.add('hidden');
        }
    }

    // Monitor Iframe URL
    function checkNotebookSelected() {
        try {
            const iframeSrc = iframe.contentWindow?.location?.href;
            if (iframeSrc && iframeSrc.includes('/notebook/')) {
                updateState(true);
            }
        } catch (e) {
            // Ignore cross-origin errors
        }
    }

    // Load initial URL
    iframe.src = "https://notebooklm.google.com/";
    setInterval(checkNotebookSelected, 1000);

    // --- Event Listeners ---

    // 1. Listen for background messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "notebookUrlChanged") {
            const hasNotebook = request.url && request.url.includes('/notebook/');
            updateState(hasNotebook);
        } else if (request.action === "automationComplete") {
            setLoading(false);
        }
    });

    // 2. Add Current Page Button
    addBtn.addEventListener('click', async () => {
        setLoading(true);
        sendMessage({ action: "forwardToAddSource" }, () => {
            incrementUsage();
        });
    });

    // 3. Extra Action Buttons
    // 3. Extra Action Buttons
    // Upload removed

    btnUrl.addEventListener('click', () => {
        toggleInput(manualInputContainer, manualUrlInput);
    });

    btnText.addEventListener('click', () => {
        toggleInput(textInputContainer, manualTextTextarea);
    });

    function toggleInput(container, focusElement) {
        const isShowing = container.classList.contains('show');
        closeAllInputs();
        if (!isShowing) {
            container.classList.add('show');
            if (focusElement) focusElement.focus();
        }
    }

    function closeAllInputs() {
        manualInputContainer.classList.remove('show');
        textInputContainer.classList.remove('show');
    }

    // 4. Manual URL Add Button
    manualAddBtn.addEventListener('click', async () => {
        const url = manualUrlInput.value.trim();
        if (!url) return;

        if (!url.startsWith('http')) {
            alert(chrome.i18n.getMessage("errorGeneric") + " (URL must start with http/https)");
            return;
        }

        setLoading(true);
        sendMessage({ action: "addManualSource", url: url }, () => {
            manualUrlInput.value = '';
            closeAllInputs();
            incrementUsage();
        });
    });

    // 5. Manual Text Add Button
    manualTextAddBtn.addEventListener('click', async () => {
        const text = manualTextTextarea.value.trim();
        if (!text) return;

        setLoading(true);
        sendMessage({ action: "addManualText", text: text }, () => {
            manualTextTextarea.value = '';
            closeAllInputs();
            incrementUsage();
        });
    });

    // 6. History Panel Logic
    historyBtn.addEventListener('click', () => {
        historyPanel.classList.add('show');
        loadHistory();
    });

    closeHistory.addEventListener('click', () => {
        historyPanel.classList.remove('show');
    });

    clearHistory.addEventListener('click', async () => {
        if (confirm(chrome.i18n.getMessage("confirmClear"))) {
            await chrome.runtime.sendMessage({ action: "clearHistory" });
            loadHistory();
        }
    });

    // 7. Donation Button
    btnDonate.addEventListener('click', () => {
        const donationUrl = "https://buymeacoffee.com/takumi272";
        chrome.tabs.create({ url: donationUrl });
        // Stop animation on click
        btnDonate.classList.remove('donate-nudge');
    });

    // --- Usage Tracking for Nudge ---
    function incrementUsage() {
        chrome.storage.local.get(['usageCount'], (result) => {
            const current = result.usageCount || 0;
            const newCount = current + 1;
            chrome.storage.local.set({ usageCount: newCount });
            checkNudge(newCount);
        });
    }

    function checkNudge(count) {
        // Nudge on 3rd use, and every 10 uses thereafter
        if (count >= 3 && (count === 3 || count % 10 === 0)) {
            btnDonate.classList.add('donate-nudge');
        }
    }

    // Check on load too
    chrome.storage.local.get(['usageCount'], (result) => {
        checkNudge(result.usageCount || 0);
    });

    // --- Helpers ---

    function sendMessage(message, callback) {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Runtime Error:", chrome.runtime.lastError);
                // Don't alert for every connectivity check, but here we expect user action
                return;
            }
            if (response && !response.success && response.error) {
                const msg = chrome.i18n.getMessage("errorGeneric");
                alert(msg + ": " + response.error);
                setLoading(false);
            }
            if (callback) callback(response);
        });
    }

    function setLoading(isLoading) {
        if (isLoading) {
            addBtn.classList.add('loading');
        } else {
            addBtn.classList.remove('loading');
        }
    }

    async function loadHistory() {
        chrome.runtime.sendMessage({ action: "getHistory" }, (response) => {
            if (response && response.history) {
                renderHistory(response.history);
            }
        });
    }

    function renderHistory(history) {
        if (!history || history.length === 0) {
            historyList.innerHTML = `
                <div style="
                    display: flex; flex-direction: column; align-items: center; 
                    justify-content: center; height: 100%; color: var(--secondary-text); gap: 10px;">
                    <div style="font-size: 24px;">📝</div>
                    <div>${chrome.i18n.getMessage("msgHistoryEmpty")}</div>
                </div>`;
            return;
        }

        historyList.innerHTML = history.map(item => {
            const date = new Date(item.date);
            // Use browser's default locale
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="history-item" data-url="${item.url}" title="クリックして開く">
                    <div class="history-item-title">${escapeHtml(item.title || 'No title')}</div>
                    <div class="history-item-url">${escapeHtml(item.url)}</div>
                    <div class="history-item-date">
                        <span>${dateStr}</span>
                        <span class="material-symbols-rounded">open_in_new</span>
                    </div>
                </div>
            `;
        }).join('');

        historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                chrome.tabs.create({ url: item.dataset.url });
            });
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function localizeHtml() {
        // Localize text content
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const message = chrome.i18n.getMessage(key);
            if (message) {
                element.textContent = message;
            }
        });

        // Localize placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const message = chrome.i18n.getMessage(key);
            if (message) {
                element.placeholder = message;
            }
        });

        // Localize titles (tooltips)
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const message = chrome.i18n.getMessage(key);
            if (message) {
                element.title = message;
            }
        });
    }
});
