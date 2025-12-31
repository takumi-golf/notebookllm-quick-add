// --- NotebookLLM Automation Script ---
// Version 3.0: Exact 4-Route Implementation

// === STATUS BOX ===
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

// === i18n HELPER ===
function i18n(key, fallback) {
    return chrome.i18n.getMessage(key) || fallback;
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

// === VERSION DETECTION ===
function detectVersion() {
    const allText = document.body.innerText || '';
    const hasPROLabel = allText.includes('PRO');

    if (hasPROLabel) {
        return 'pro';
    }

    return 'free';
}

// === URL TYPE DETECTION ===
function getUrlType(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return 'youtube';
    }
    return 'website';
}

// === HELPER: Find and click element by text ===
async function clickByText(texts, elementTypes = 'button, div[role="button"], span[role="button"], mat-chip, mat-chip-option, [role="tab"], [role="listitem"]', timeout = 8000) {
    const textArray = Array.isArray(texts) ? texts : [texts];

    const element = await waitFor(() => {
        const elements = document.querySelectorAll(elementTypes);
        for (const el of elements) {
            if (el.offsetParent === null) continue;
            const elText = (el.textContent || '').toLowerCase().trim();

            for (const t of textArray) {
                if (elText.includes(t.toLowerCase())) {
                    return el;
                }
            }
        }
        return null;
    }, timeout);

    if (element) {
        element.click();
        return true;
    }
    return false;
}

// === HELPER: Find textarea by label/placeholder ===
async function findTextarea(labels, timeout = 5000) {
    const labelArray = Array.isArray(labels) ? labels : [labels];

    return await waitFor(() => {
        const textareas = document.querySelectorAll('textarea');
        console.log(`[NLM Auto] Searching ${textareas.length} textareas for: ${labelArray.join(', ')}`);

        for (const ta of textareas) {
            if (ta.offsetParent === null) continue;

            // Get context
            const parent = ta.closest('mat-form-field') || ta.parentElement?.parentElement || ta.parentElement;
            const parentText = parent ? (parent.textContent || '').toLowerCase() : '';
            const placeholder = (ta.placeholder || '').toLowerCase();
            const aria = (ta.getAttribute('aria-label') || '').toLowerCase();
            const classes = ta.className || '';

            console.log(`[NLM Auto] Checking textarea: aria="${aria.substring(0, 30)}" placeholder="${placeholder.substring(0, 30)}" class="${classes.substring(0, 50)}" parentText="${parentText.substring(0, 30)}"`);

            // Skip emoji/search textareas (check BOTH aria AND placeholder)
            if (aria.includes('絵文字') || aria.includes('emoji')) continue;
            if (aria.includes('検索') || aria.includes('search') || aria.includes('クエリ') || aria.includes('query')) continue;
            if (placeholder.includes('検索') || placeholder.includes('search') || placeholder.includes('ソースを検索')) continue;

            // If it passes the skip checks and is a Material Design input, use it
            if (classes.includes('mat-mdc-input-element') || classes.includes('mdc-text-field__input')) {
                console.log('[NLM Auto] Found Material Design textarea (not search bar)');
                return ta;
            }


            for (const label of labelArray) {
                const l = label.toLowerCase();
                if (parentText.includes(l) || placeholder.includes(l) || aria.includes(l)) {
                    console.log(`[NLM Auto] Found textarea with label: "${label}"`);
                    return ta;
                }
            }
        }

        // Fallback: return first visible non-search textarea
        for (const ta of textareas) {
            if (ta.offsetParent === null) continue;
            const aria = (ta.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('絵文字') || aria.includes('検索')) continue;
            console.log('[NLM Auto] Using fallback textarea');
            return ta;
        }

        return null;

    }, timeout);
}

// === CONNECTION ===
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

// ============================================
// MAIN AUTOMATION
// ============================================
async function runAutomation(url) {
    const version = detectVersion();
    const urlType = getUrlType(url);

    updateStatus(i18n("statusStarting", "Starting..."), "#ffd93d");

    try {
        if (version === 'pro') {
            await runAutomationPro(url);
        } else {
            await runAutomationFree(url, urlType);
        }
    } catch (error) {
        console.error("Automation failed:", error);
        updateStatus(`✗ ${error.message}`, "#ff6b6b", true);
        chrome.runtime.sendMessage({
            action: "automationComplete",
            success: false,
            url: url,
            error: error.message
        });
    }
}

// ============================================
// PRO VERSION: All URLs go through "ウェブサイト"
// ============================================
async function runAutomationPro(url) {
    updateStatus(i18n("statusStep1", "Step 1 - Sources Tab"), "#ffd93d");

    // STEP 1: Click "ソース" tab
    if (!await clickByText(['ソース', 'sources', 'source'])) {
        // May already be on sources tab
    }
    await delay(300);

    // STEP 2: Click "ソースを追加" button
    updateStatus(i18n("statusStep2", "Step 2 - Add Source"), "#ffd93d");
    if (!await clickByText(['ソースを追加', 'add source', 'add sources'])) {
        throw new Error("ソースを追加ボタンが見つかりません");
    }
    await delay(500);

    // STEP 3: Click "ウェブサイト" button (Pro uses this for ALL URLs including YouTube)
    updateStatus(i18n("statusStep3Website", "Step 3 - Website"), "#ffd93d");
    if (!await clickByText(['ウェブサイト', 'website', 'websites'])) {
        throw new Error("ウェブサイトボタンが見つかりません");
    }
    await delay(500);

    // STEP 4: Find and fill URL input
    updateStatus(i18n("statusStep4", "Step 4 - Enter URL"), "#ffd93d");
    const input = await findTextarea(['url', '貼り付け', 'paste', 'links']);

    if (!input) throw new Error("URL入力欄が見つかりません");

    input.focus();
    input.value = url;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(500);

    // STEP 5: Click "挿入" button
    updateStatus(i18n("statusStep5", "Step 5 - Insert"), "#ffd93d");
    if (!await clickByText(['挿入', 'insert'])) {
        throw new Error("挿入ボタンが見つかりません");
    }

    updateStatus(i18n("statusSuccess", "✓ Added successfully!"), "#00ff88", true);
    chrome.runtime.sendMessage({ action: "automationComplete", success: true, url: url });
}

// ============================================
// FREE VERSION: YouTube and Website are separate
// ============================================
async function runAutomationFree(url, urlType) {
    updateStatus(i18n("statusStep1", "Step 1 - Sources Tab"), "#ffd93d");

    // STEP 1: Click "ソース" tab
    await clickByText(['ソース', 'sources', 'source']);
    await delay(300);

    // STEP 2: Click "ソースを追加" button
    updateStatus(i18n("statusStep2", "Step 2 - Add Source"), "#ffd93d");
    if (!await clickByText(['ソースを追加', 'add source', 'add sources'])) {
        throw new Error("ソースを追加ボタンが見つかりません");
    }
    await delay(500);

    // STEP 3: Click appropriate button based on URL type
    if (urlType === 'youtube') {
        updateStatus(i18n("statusStep3YouTube", "Step 3 - YouTube"), "#ffd93d");

        // Find YouTube chip/button specifically (avoid clicking icon)
        const youtubeClicked = await waitFor(() => {
            const chips = document.querySelectorAll('mat-chip, mat-chip-option, [role="listitem"]');

            for (const chip of chips) {
                if (chip.offsetParent === null) continue;

                // Get text content, but filter out icon names
                const textNodes = chip.querySelectorAll('span, .mat-mdc-chip-action-label, .mdc-evolution-chip__text-label');
                for (const node of textNodes) {
                    const text = (node.textContent || '').trim();
                    // Match exact "YouTube" (avoiding icon text like "video_youtube")
                    if (text === 'YouTube' || text.toLowerCase() === 'youtube') {
                        chip.click();
                        return true;
                    }
                }
            }
            return null;
        }, 5000);

        if (!youtubeClicked) {
            // Fallback to generic clickByText
            if (!await clickByText(['youtube'])) {
                throw new Error("YouTubeボタンが見つかりません");
            }
        }
        await delay(1000); // Wait longer for YouTube dialog to open


        // STEP 4: Find YouTube URL input
        updateStatus(i18n("statusStep4", "Step 4 - Enter URL"), "#ffd93d");

        const input = await waitFor(() => {
            const inputs = document.querySelectorAll('input.mat-mdc-input-element, textarea.mat-mdc-input-element, input.mdc-text-field__input, textarea.mdc-text-field__input');

            for (const inp of inputs) {
                if (inp.offsetParent === null) continue;

                // Get parent form field to check label
                const formField = inp.closest('mat-form-field') || inp.closest('.mat-mdc-form-field');
                const labelText = formField ? (formField.textContent || '').toLowerCase() : '';
                const placeholder = (inp.placeholder || '').toLowerCase();


                // SKIP: Search bar
                if (placeholder.includes('検索') || placeholder.includes('search') || labelText.includes('検索')) {
                    continue;
                }

                // MATCH: Label or form field contains "YouTube" or "URL" or "貼り付け"
                if (labelText.includes('youtube') || labelText.includes('url') || labelText.includes('貼り付け') ||
                    placeholder.includes('youtube') || placeholder.includes('url') || placeholder.includes('貼り付け')) {
                    return inp;
                }
            }

            return null;
        }, 5000);



        if (!input) throw new Error("YouTube URL入力欄が見つかりません");

        input.focus();
        input.value = url;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(500);

    } else {
        updateStatus(i18n("statusStep3Website", "Step 3 - Website"), "#ffd93d");
        if (!await clickByText(['ウェブサイト', 'website', 'websites'])) {
            throw new Error("ウェブサイトボタンが見つかりません");
        }
        await delay(500);

        // STEP 4: Find Website URL input
        updateStatus(i18n("statusStep4", "Step 4 - Enter URL"), "#ffd93d");
        const input = await findTextarea(['url', '貼り付け', 'paste']);

        if (!input) throw new Error("URL入力欄が見つかりません");

        input.focus();
        input.value = url;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(500);
    }

    // STEP 5: Click "挿入" button
    updateStatus(i18n("statusStep5", "Step 5 - Insert"), "#ffd93d");
    if (!await clickByText(['挿入', 'insert'])) {
        throw new Error("挿入ボタンが見つかりません");
    }

    updateStatus(i18n("statusSuccess", "✓ Added successfully!"), "#00ff88", true);
    chrome.runtime.sendMessage({ action: "automationComplete", success: true, url: url });
}

// ============================================
// ACTION TRIGGER (Upload, Drive, Text)
// ============================================
async function runAction(type) {
    try {
        updateStatus("Action: Starting...", "#ffd93d");

        // Click Sources tab
        await clickByText(['ソース', 'sources']);
        await delay(300);

        // Click Add Source
        await clickByText(['ソースを追加', 'add source']);
        await delay(500);

        // Click target button based on type
        if (type === "upload") {
            if (!await clickByText(['pdf', 'アップロード', 'upload', 'file'])) {
                throw new Error("アップロードボタンが見つかりません");
            }
        } else if (type === "drive") {
            if (!await clickByText(['ドライブ', 'drive', 'google'])) {
                throw new Error("Driveボタンが見つかりません");
            }
        } else if (type === "text") {
            if (!await clickByText(['コピーしたテキスト', 'テキスト', 'text', 'paste'])) {
                throw new Error("テキストボタンが見つかりません");
            }
        }

        updateStatus("✓ 完了", "#00ff88", true);

    } catch (error) {
        console.error("Action failed:", error);
        updateStatus(`✗ ${error.message}`, "#ff6b6b", true);
    }
}

// ============================================
// TEXT AUTOMATION
// ============================================
async function runTextAutomation(text) {
    try {
        updateStatus("Text: Starting...", "#ffd93d");

        // Helper function to find text input (search input AND textarea, in dialog or form-field)
        const findTextInput = () => {
            // Search for Material Design inputs
            const inputs = document.querySelectorAll('input.mat-mdc-input-element, textarea.mat-mdc-input-element, input.mdc-text-field__input, textarea.mdc-text-field__input, mat-dialog-container textarea, mat-dialog-container input');
            console.log(`[NLM Auto Text] Searching ${inputs.length} inputs`);

            for (const inp of inputs) {
                if (inp.offsetParent === null) continue;

                // Get parent form field to check label
                const formField = inp.closest('mat-form-field') || inp.closest('.mat-mdc-form-field');
                const labelText = formField ? (formField.textContent || '').toLowerCase() : '';
                const placeholder = (inp.placeholder || '').toLowerCase();
                const aria = (inp.getAttribute('aria-label') || '').toLowerCase();

                console.log(`[NLM Auto Text] Input: label="${labelText.substring(0, 40)}" placeholder="${placeholder.substring(0, 30)}"`);

                // SKIP: Search bar and emoji
                if (placeholder.includes('検索') || placeholder.includes('search') || aria.includes('絵文字')) continue;

                // MATCH: Text-related input (check label AND placeholder)
                if (labelText.includes('テキスト') || labelText.includes('text') || labelText.includes('貼り付け') || labelText.includes('paste') ||
                    placeholder.includes('text') || placeholder.includes('paste') || placeholder.includes('貼り付け') || placeholder.includes('テキスト')) {
                    console.log('[NLM Auto Text] Found text input!');
                    return inp;
                }

            }
            return null;
        };

        // First, check if input is already available
        let textarea = findTextInput();

        if (!textarea) {
            // Need to open the dialog
            // Click Sources tab
            if (!await clickByText(['ソース', 'sources'])) {
                console.log('[NLM Auto] Sources tab not found');
            }
            await delay(300);

            // Click Add Source
            if (!await clickByText(['ソースを追加', 'add source'])) {
                throw new Error("ソースを追加ボタンが見つかりません");
            }
            await delay(500);

            // Click "コピーしたテキスト" button
            if (!await clickByText(['コピーしたテキスト', 'テキスト', 'copied text', 'paste text'])) {
                throw new Error("テキストボタンが見つかりません");
            }
            await delay(800);

            // Find text input after opening dialog
            updateStatus("Text: Finding input...", "#ffd93d");
            textarea = await waitFor(findTextInput, 5000);
        }


        if (!textarea) throw new Error("テキスト入力欄が見つかりません");

        // Directly paste text and submit
        updateStatus("Text: Pasting...", "#ffd93d");
        textarea.focus();
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(300);

        // Click Insert
        if (!await clickByText(['挿入', 'insert'])) {
            throw new Error("挿入ボタンが見つかりません");
        }

        updateStatus("✓ テキスト追加完了！", "#00ff88", true);
        chrome.runtime.sendMessage({ action: "automationComplete", success: true });

    } catch (error) {
        console.error("Text Automation failed:", error);
        updateStatus(`✗ ${error.message}`, "#ff6b6b", true);
        chrome.runtime.sendMessage({ action: "automationComplete", success: false });
    }
}

