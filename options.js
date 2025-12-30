// Saves options to chrome.storage
function saveOptions() {
    const notebookId = document.getElementById('notebookId').value.trim();

    chrome.storage.sync.set({
        defaultNotebookId: notebookId
    }, () => {
        // Update status to let user know options were saved.
        const status = document.getElementById('status');
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 2000);
    });
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restoreOptions() {
    chrome.storage.sync.get("defaultNotebookId", (items) => {
        if (items.defaultNotebookId) {
            document.getElementById('notebookId').value = items.defaultNotebookId;
        }
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
