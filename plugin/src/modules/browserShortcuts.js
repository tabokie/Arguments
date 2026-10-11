// Firefox exposes a shortcut editor API; Chromium opens its internal settings page.
function shortcutCommands() {
    return typeof browser !== 'undefined' && browser.commands?.openShortcutSettings
        ? browser.commands : chrome.commands;
}

export function canOpenBrowserShortcuts() {
    return !!shortcutCommands()?.openShortcutSettings
        || !!chrome.tabs?.create && chrome.runtime.getURL('').startsWith('chrome-extension:');
}

export async function openBrowserShortcuts() {
    const commands = shortcutCommands();
    if (commands?.openShortcutSettings) return commands.openShortcutSettings();
    if (!canOpenBrowserShortcuts()) return;
    const scheme = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
    return chrome.tabs.create({ url: `${scheme}://extensions/shortcuts` });
}
