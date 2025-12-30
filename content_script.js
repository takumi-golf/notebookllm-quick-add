// --- NotebookLLM Automation Script ---

// Remove any existing status boxes first
document.querySelectorAll('.nlm-status-box').forEach(el => el.remove());

const statusBox = document.createElement('div');
statusBox.className = 'nlm-status-box';
statusBox.style.cssText = `
    position: fixed; bottom: 10px; right: 10px;
    background: #1a1a2e; color: #eee; padding: 12px 16px;
    border-radius: 8px; z-index: 99999; font-family: sans-serif;
    font-size: 13px; pointer-events: none;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    border-left: 4px solid #00ff88;
    transition: opacity 0.3s;
`;
document.body.appendChild(statusBox);

let statusTimeout = null;

function updateStatus(text, color = "#eee", autoDismiss = false) {
    console.log(`[NLM Auto] ${text}`);
    statusBox.innerHTML = `<span style="color:${color}">${text}</span>`;
    statusBox.style.opacity = '1';
    statusBox.style.display = 'block';

    if (statusTimeout) clearTimeout(statusTimeout);

    if (autoDismiss) {
        statusTimeout = setTimeout(() => {
            statusBox.style.opacity = '0';
            setTimeout(() => statusBox.style.display = 'none', 300);
        }, 3000);
    }
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function waitFor(fn, timeout = 8000, interval = 300) {
    return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
            const result = fn();
            if (result) {
                if (result instanceof HTMLElement) {
                    result.style.outline = '3px solid lime';
                    setTimeout(() => result.style.outline = '', 800);
                }
                resolve(result);
            } else if (Date.now() - start > timeout) {
                resolve(null);
            } else {
                setTimeout(check, interval);
            }
        };
        check();
    });
}

let port = null;
function connect() {
    try {
        port = chrome.runtime.connect({ name: "notebook-iframe" });
        port.onDisconnect.addListener(() => {
            port = null;
            setTimeout(connect, 2000);
        });
        port.onMessage.addListener((msg) => {
            if (msg.action === "addSource") {
                runAutomation(msg.url);
            } else if (msg.action === "triggerAction") {
                runAction(msg.type);
            } else if (msg.action === "pasteText") {
                runTextAutomation(msg.text);
            }
        });
        updateStatus("✓ Ready", "#00ff88", true);

        chrome.runtime.sendMessage({
            action: "notebookUrlChanged",
            url: window.location.href
        });
    } catch (e) {
        updateStatus("Connection Error", "#ff6b6b", true);
    }
}
connect();

// URL change detection
let lastUrl = window.location.href;
setInterval(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        chrome.runtime.sendMessage({
            action: "notebookUrlChanged",
            url: window.location.href
        });
    }
}, 500);

async function runAutomation(url) {
    try {
        updateStatus("Starting...", "#ffd93d");

        // === STEP 0: Click Sources Tab if needed ===
        const allTabs = document.querySelectorAll('[role="tab"]');
        for (const tab of allTabs) {
            const text = tab.textContent || '';
            if (text.includes('ソース') || text.includes('Sources')) {
                if (tab.getAttribute('aria-selected') !== 'true') {
                    updateStatus("Clicking Sources tab...", "#ffd93d");
                    tab.click();
                    await delay(500);
                }
                break;
            }
        }

        // === STEP 1: Click Add Source Button ===
        const addSourceBtn = await waitFor(() => {
            // Strategy 1: Specific Classes
            const classSelectors = ['.add-source-button', '.upload-button', '.upload-icon-button'];
            for (const selector of classSelectors) {
                const el = document.querySelector(selector);
                if (el && !el.disabled && el.offsetParent) return el;
            }

            // Strategy 2: Text Content ( জাপ Japanese / English)
            const buttons = document.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
                if (btn.offsetParent === null) continue; // Skip hidden
                const text = (btn.textContent || "").trim().toLowerCase();
                if (text.includes("ソースを追加") || text.includes("add source")) {
                    return btn;
                }
                // Strategy 3: Icon Content check
                const icon = btn.querySelector('.material-icons, .material-symbols-outlined, .material-symbols-rounded');
                if (icon && (icon.textContent === 'add_circle' || icon.textContent === 'add')) {
                    // Be careful not to pick other add buttons if multiple exist, but usually main one is prominent
                    if (btn.classList.contains('mat-fab') || btn.classList.contains('mat-mdc-fab')) return btn;
                }
            }
            return null;
        }, 8000); // Increased timeout

        if (!addSourceBtn) throw new Error("ソース追加ボタンが見つかりません");

        updateStatus("Clicking Add Source...", "#ffd93d");
        addSourceBtn.click();
        await delay(500);

        // === Scroll to ensure visibility ===
        // 1. Scroll main containers to bottom
        const scrollSelectors = ['.mat-drawer-content', '.notebook-content', 'main'];
        scrollSelectors.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) try { el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); } catch (e) { }
        });
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });

        // 2. Find the dialog and scroll its LAST button into view
        // This forces the "Copied text" or bottom options to appear
        await delay(300);
        const dialog = document.querySelector('mat-dialog-container') || document.querySelector('[role="dialog"]');
        if (dialog) {
            // Find all buttons inside the dialog
            const buttons = dialog.querySelectorAll('button');
            if (buttons.length > 0) {
                const lastButton = buttons[buttons.length - 1];
                lastButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                dialog.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
        }

        await delay(500);

        // === STEP 2: Click Website Option ===
        updateStatus("Finding Website option...", "#ffd93d");

        const websiteBtn = await waitFor(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.offsetParent === null) continue;
                const text = btn.textContent || '';
                if (text.includes('ウェブサイト') || text.includes('Website')) {
                    return btn;
                }
            }
            return null;
        }, 5000);

        if (!websiteBtn) throw new Error("ウェブサイトオプションが見つかりません");

        websiteBtn.click();
        await delay(500);

        // === STEP 3: Find and Fill Input ===
        updateStatus("Finding input field...", "#ffd93d");

        const input = await waitFor(() => {
            let textarea = document.querySelector('textarea[aria-label="URL を入力"]');
            if (textarea) return textarea;

            textarea = document.querySelector('textarea[placeholder="リンクを貼り付ける"]');
            if (textarea) return textarea;

            const allTextareas = document.querySelectorAll('textarea');
            for (const ta of allTextareas) {
                if (ta.offsetParent !== null) return ta;
            }
            return null;
        }, 5000);

        if (!input) throw new Error("入力フィールドが見つかりません");

        updateStatus("Entering URL...", "#ffd93d");

        input.focus();
        input.value = url;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));

        await delay(500);

        // === STEP 4: Click Insert Button ===
        updateStatus("Waiting for Insert button...", "#ffd93d");

        const insertBtn = await waitFor(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const text = btn.textContent?.trim() || '';
                if ((text.includes('挿入') || text.includes('Insert')) && !btn.disabled) {
                    return btn;
                }
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return null;
        }, 8000);

        if (!insertBtn) throw new Error("挿入ボタンが無効です");

        insertBtn.click();

        updateStatus("✓ 追加しました！", "#00ff88", true);

        chrome.runtime.sendMessage({
            action: "automationComplete",
            success: true,
            url: url
        });

    } catch (error) {
        console.error("Automation failed:", error);
        updateStatus(`✗ ${error.message}`, "#ff6b6b", true);

        chrome.runtime.sendMessage({
            action: "automationComplete",
            success: false,
            url: url
        });
    }
}

async function runAction(type) {
    try {
        updateStatus("Starting Action...", "#ffd93d");

        // === STEP 1: Open Menu ===
        // Reuse common logic to find and click Add Source
        const addSourceBtn = await waitFor(() => {
            // Strategy 1: Specific Classes
            const classSelectors = ['.add-source-button', '.upload-button', '.upload-icon-button'];
            for (const selector of classSelectors) {
                const el = document.querySelector(selector);
                if (el && !el.disabled && el.offsetParent) return el;
            }

            // Strategy 2: Text Content
            const buttons = document.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
                if (btn.offsetParent === null) continue;
                const text = (btn.textContent || "").trim().toLowerCase();
                if (text.includes("ソースを追加") || text.includes("add source")) return btn;

                const icon = btn.querySelector('.material-icons, .material-symbols-outlined, .material-symbols-rounded');
                if (icon && (icon.textContent === 'add_circle' || icon.textContent === 'add')) {
                    if (btn.classList.contains('mat-fab') || btn.classList.contains('mat-mdc-fab')) return btn;
                }
            }
            return null;
        }, 8000);

        if (!addSourceBtn) throw new Error("ソース追加ボタンが見つかりません");
        addSourceBtn.click();
        await delay(500);

        // Scroll to ensure visibility (Force last button into view)
        const scrollSelectors = ['.mat-drawer-content', '.notebook-content', 'main'];
        scrollSelectors.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) try { el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); } catch (e) { }
        });
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });

        await delay(300);
        const dialog = document.querySelector('mat-dialog-container') || document.querySelector('[role="dialog"]');
        if (dialog) {
            const buttons = dialog.querySelectorAll('button');
            if (buttons.length > 0) {
                buttons[buttons.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        await delay(500);

        // === STEP 2: Find Specific Target ===
        let targetText = [];
        let targetIcon = "";

        if (type === "upload") {
            targetText = ["PDF", "アップロード", "Upload", "file"];
            targetIcon = "upload_file";
        } else if (type === "drive") {
            targetText = ["ドライブ", "Drive", "Slides", "Docs"];
            targetIcon = "add_to_drive";
        } else if (type === "text") {
            targetText = ["テキスト", "Text", "Clipboard", "Paste"];
            targetIcon = "content_paste";
        }

        updateStatus(`Finding ${type}...`, "#ffd93d");

        const targetBtn = await waitFor(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.offsetParent === null) continue;
                const text = (btn.textContent || "").toLowerCase();
                const icon = btn.querySelector('.material-icons, .material-symbols-outlined')?.textContent;

                // Check text match
                const textMatch = targetText.some(t => text.includes(t.toLowerCase()));

                // Check icon match (if available) - loose check
                const iconMatch = icon && targetIcon && icon.includes(targetIcon);

                if (textMatch || iconMatch) {
                    return btn;
                }
            }
            return null;
        }, 5000);

        if (!targetBtn) throw new Error(`${type} ボタンが見つかりません`);

        targetBtn.click();
        updateStatus("✓ 完了", "#00ff88", true);

    } catch (error) {
        console.error("Action failed:", error);
        updateStatus(`✗ ${error.message}`, "#ff6b6b", true);
    }
}

async function runTextAutomation(text) {
    try {
        updateStatus("Starting Text Paste...", "#ffd93d");

        // === STEP 1: Open Menu ===
        const addSourceBtn = await waitFor(() => {
            // Strategy 1: Specific Classes
            const classSelectors = ['.add-source-button', '.upload-button', '.upload-icon-button'];
            for (const selector of classSelectors) {
                const el = document.querySelector(selector);
                if (el && !el.disabled && el.offsetParent) return el;
            }

            // Strategy 2: Text Content
            const buttons = document.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
                if (btn.offsetParent === null) continue;
                const text = (btn.textContent || "").trim().toLowerCase();
                if (text.includes("ソースを追加") || text.includes("add source")) return btn;

                const icon = btn.querySelector('.material-icons, .material-symbols-outlined, .material-symbols-rounded');
                if (icon && (icon.textContent === 'add_circle' || icon.textContent === 'add')) {
                    if (btn.classList.contains('mat-fab') || btn.classList.contains('mat-mdc-fab')) return btn;
                }
            }
            return null;
        }, 8000);

        if (!addSourceBtn) throw new Error("ソース追加ボタンが見つかりません");
        addSourceBtn.click();
        await delay(500);

        // Scroll (Force last button into view)
        const scrollSelectors = ['.mat-drawer-content', '.notebook-content', 'main'];
        scrollSelectors.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) try { el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); } catch (e) { }
        });
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });

        await delay(300);
        const dialog = document.querySelector('mat-dialog-container') || document.querySelector('[role="dialog"]');
        if (dialog) {
            const buttons = dialog.querySelectorAll('button');
            if (buttons.length > 0) {
                buttons[buttons.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        await delay(500);

        // === STEP 2: Find Copied Text Option ===
        // Reuse logic from runAction("text") but more specific if needed
        const targetText = ["テキスト", "Text", "Clipboard", "Paste"];
        const targetIcon = "content_paste";

        const textBtn = await waitFor(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.offsetParent === null) continue;
                const text = (btn.textContent || "").toLowerCase();
                const icon = btn.querySelector('.material-icons, .material-symbols-outlined')?.textContent;

                const textMatch = targetText.some(t => text.includes(t.toLowerCase()));
                const iconMatch = icon && targetIcon && icon.includes(targetIcon);

                if (textMatch || iconMatch) return btn;
            }
            return null;
        }, 5000);

        if (!textBtn) throw new Error("テキストボタンが見つかりません");
        textBtn.click();
        await delay(500);

        // === STEP 3: Find Textarea and Paste ===
        updateStatus("Finding text area...", "#ffd93d");
        const textarea = await waitFor(() => {
            // Updated selectors to be more robust
            let ta = document.querySelector('textarea[aria-label*="テキスト"]');
            if (ta) return ta;

            ta = document.querySelector('textarea[placeholder*="テキスト"]');
            if (ta) return ta;

            ta = document.querySelector('textarea[placeholder*="Text"]');
            if (ta) return ta;

            // Fallback: any textarea in dialog
            const dialog = document.querySelector('mat-dialog-container') || document.querySelector('[role="dialog"]');
            if (dialog) {
                ta = dialog.querySelector('textarea');
                if (ta) return ta;
            }
            return null;
        }, 5000);

        if (!textarea) throw new Error("テキストエリアが見つかりません");

        updateStatus("Pasting text...", "#ffd93d");
        textarea.focus();
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.dispatchEvent(new Event('blur', { bubbles: true }));

        await delay(500);

        // === STEP 4: Click Insert Button ===
        updateStatus("Waiting for Insert button...", "#ffd93d");

        const insertBtn = await waitFor(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const buttonText = btn.textContent?.trim() || '';
                if ((buttonText.includes('挿入') || buttonText.includes('Insert')) && !btn.disabled) {
                    return btn;
                }
            }
            // Trigger input again just in case
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            return null;
        }, 8000);

        if (!insertBtn) throw new Error("挿入ボタンが無効です");

        insertBtn.click();

        updateStatus("✓ 追加しました！", "#00ff88", true);
        chrome.runtime.sendMessage({ action: "automationComplete", success: true });

    } catch (error) {
        console.error("Text Automation failed:", error);
        updateStatus(`✗ ${error.message}`, "#ff6b6b", true);
        chrome.runtime.sendMessage({ action: "automationComplete", success: false });
    }
}
