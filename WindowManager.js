const { BrowserWindow, nativeImage, shell } = require('electron');
const path = require('path');
const { deepMerge } = require('./ConfigManager');

const DRAG_CSS = `
    html, body { padding: 0 !important; margin: 0 !important; overflow: hidden !important; border-radius: 0 !important; }
    header, nav, [role="navigation"], .top-nav, [class*="nav"]:not([class*="navbar-"]):not([class*="nav-"]),
    .header-container, .navbar {
        padding-right: 135px !important;
        -webkit-app-region: drag !important;
        box-sizing: border-box !important;
    }
    button, a, input, textarea, [role="button"], [role="combobox"], [role="menu"], [role="listbox"],
    .sidebar, #sidebar, [data-sidebar] {
        -webkit-app-region: no-drag !important;
    }
`;

/**
 * Owns the main app window: loading the instance, zoom, CSS housekeeping,
 * origin-safe external links, and close-to-tray behavior.
 */
class WindowManager {
    /**
     * @param {object} deps
     * @param {() => object} deps.getConfig
     * @param {() => void} deps.onOpenSettings
     * @param {(c:string)=>Promise<void>} deps.insertCSS
     */
    constructor(deps) {
        this.deps = deps;
        this.win = null;
        this.quitting = false;
        this._closeToTray = false;
    }

    setCloseToTray(flag) {
        this._closeToTray = !!flag;
    }

    create() {
        const cfg = this.deps.getConfig();
        const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
        const w = cfg.window || {};

        this.win = new BrowserWindow({
            width: (w.rememberSize && w.width) || 1400,
            height: (w.rememberSize && w.height) || 1000,
            minWidth: 900,
            minHeight: 620,
            resizable: true,
            title: cfg.appName || 'Open WebUI Shell',
            icon,
            show: process.env.SHELL_SMOKE ? true : false,
            backgroundColor: '#00000000',
            frame: false,
            titleBarStyle: 'hidden',
            thickFrame: true,
            titleBarOverlay: {
                color: '#00000000',
                symbolColor: cfg.theme?.symbolColor || '#FFFFFF',
                height: cfg.appearance?.titleBarOverlayHeight || 40
            },
            backgroundMaterial: (w.backdrop === 'mica' || w.backdrop === 'acrylic') && !process.env.SHELL_SMOKE ? w.backdrop : undefined,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                spellcheck: true,
                backgroundThrottling: process.env.SHELL_SMOKE ? false : (cfg.behavior?.backgroundThrottling ?? true)
            }
        });

        this._applyAlwaysOnTop(!!w.alwaysOnTop);

        // Zoom + app-level hotkeys inside page
        this.win.webContents.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown') return;
            const wc = this.win?.webContents;
            if (!wc) return;
            if (input.control && input.key === '=') wc.setZoomLevel(wc.getZoomLevel() + 0.5);
            else if (input.control && input.key === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5);
            else if (input.control && input.key === '0') wc.setZoomLevel(0);
            else if (input.control && (input.key === ',')) {
                event.preventDefault();
                this.openSettings();
            }
        });

        // External links -> system browser
        this.win.webContents.setWindowOpenHandler(({ url }) => {
            let internal = false;
            try {
                internal = new URL(url).origin === new URL(cfg.url).origin;
            } catch (_) {}
            if (!internal) shell.openExternal(url);
            return { action: internal ? 'allow' : 'deny' };
        });

        this.win.on('close', (e) => {
            if (this.quitting || !this._closeToTray) return;
            // minimize to tray instead of closing
            e.preventDefault();
            this.win.hide();
        });

        this.win.on('closed', () => { this.win = null; });

        this.win.once('ready-to-show', () => {
            this.win.show();
        });

        this.win.webContents.on('did-finish-load', () => {
            const c = this.deps.getConfig();
            this.injectCss(DRAG_CSS);
            if (c.appearance?.hideScrollbar !== false) {
                this.injectCss('::-webkit-scrollbar { width: 7px !important; height: 7px !important; } '
                    + '::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.35) !important; border-radius: 4px !important; } '
                    + '::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,0.55) !important; }');
            }
            if (c.appearance?.customCSS) {
                this.injectCss(String(c.appearance.customCSS));
            }
        });

        if (w.rememberSize) {
            const save = () => {
                try {
                    const cur = this.deps.getConfig();
                    const [width, height] = this.win.getSize();
                    cur.window.width = width;
                    cur.window.height = height;
                    this.deps.persistThrottled(cur);
                } catch (_) {}
            };
            let t = null;
            this.win.on('resized', () => { clearTimeout(t); t = setTimeout(save, 700); });
        }

        return this.win;
    }

    /** Destroys and re-creates the window (for DWM backdrop material changes). */
    recreate(url) {
        try { this.win?.destroy(); } catch (_) {}
        this.win = null;
        this.quitting = false;
        this.create();
        if (url) {
            try { this.win.loadURL(url); } catch (_) {}
        }
        return this.win;
    }

    /** Re-applies chrome + custom CSS to the current page without reloading. */
    applyAppearance(cfg) {
        if (!this.win || this.win.isDestroyed()) return;
        this.injectCss(DRAG_CSS.replace(/[\r\n]/g, ' '));
        if (cfg.appearance?.hideScrollbar !== false) {
            this.injectCss('::-webkit-scrollbar { width: 7px !important; height: 7px !important; } '
                + '::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.35) !important; border-radius: 4px !important; } '
                + '::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,0.55) !important; }');
        }
        if (cfg.appearance?.customCSS) {
            this.injectCss(String(cfg.appearance.customCSS).replace(/[\r\n]/g, ' '));
        }
        try {
            this.win.setTitleBarOverlay({
                color: '#00000000',
                symbolColor: cfg.theme?.symbolColor || '#FFFFFF',
                height: cfg.appearance?.titleBarOverlayHeight || 40
            });
        } catch (_) {}
    }

    applyConfigLive(cfg) {
        if (!this.win || this.win.isDestroyed()) return;
        this._applyAlwaysOnTop(!!cfg.window?.alwaysOnTop);
        this.win.webContents.setWindowOpenHandler(({ url }) => {
            let internal = false;
            try {
                internal = new URL(url).origin === new URL(cfg.url).origin;
            } catch (_) {}
            if (!internal) shell.openExternal(url);
            return { action: internal ? 'allow' : 'deny' };
        });
    }

    injectCss(css) {
        try { this.win?.webContents.insertCSS(css); } catch (_) {}
    }

    _applyAlwaysOnTop(on) {
        if (!this.win || this.win.isDestroyed()) return;
        this.win.setAlwaysOnTop(on, 'floating');
    }

    navigate(url) {
        if (!this.win) this.create();
        this.win.loadURL(url);
        this.win.show();
        this.win.focus();
    }

    navigateToChat(chatId) {
        const cfg = this.deps.getConfig();
        const base = cfg.url.replace(/\/+$/, '');
        const fmt = cfg.advanced?.chatUrlFormat || '/c/{id}';
        const url = base + fmt.replace('{id}', encodeURIComponent(chatId));
        this.navigate(url);
    }

    newChat() {
        const cfg = this.deps.getConfig();
        this.navigate(cfg.url.replace(/\/+$/, '') + '/');
    }

    openVoiceCall(chatId = null) {
        const cfg = this.deps.getConfig();
        const base = cfg.url.replace(/\/+$/, '');
        // Open WebUI enables its native voice call overlay via ?call=true
        const url = chatId
            ? base + (cfg.advanced?.chatUrlFormat || '/c/{id}').replace('{id}', encodeURIComponent(chatId)) + '?call=true'
            : base + '/?call=true';
        this.navigate(url);
    }

    openSettings() {
        this.deps.spawnSettings?.();
    }

    reload() {
        try { this.win?.reload(); } catch (_) {}
    }

    isFocused() {
        return !!this.win && !this.win.isDestroyed() && this.win.isFocused();
    }

    toggleVisible() {
        if (!this.win || this.win.isDestroyed()) {
            this.create();
            return;
        }
        if (this.win.isVisible() && this.win.isFocused()) {
            this.win.hide();
        } else {
            this.win.show();
            this.win.focus();
        }
    }

    /** Executes code in the page (used for session-authenticated API calls). */
    executeJs(code) {
        const wc = this.win && !this.win.isDestroyed() ? this.win.webContents : null;
        if (!wc) return Promise.resolve(null);
        return wc.executeJavaScript(code, true).catch(() => null);
    }

    destroy() {
        this.quitting = true;
        try { this.win?.destroy(); } catch (_) {}
        this.win = null;
    }
}

module.exports = WindowManager;
