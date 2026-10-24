const { BrowserWindow, nativeImage } = require('electron');
const path = require('path');

/**
 * Live Mode: opens Open WebUI's native voice-call experience in a compact,
 * always-on-top glass window so you can talk to your model while working,
 * like keeping a floating call open on macOS/iOS.
 */
class LiveModeManager {
    // deps: { getConfig, onStateChange(active) }
    constructor(deps) {
        this.deps = deps;
        this.win = null;
    }

    get active() {
        return !!(this.win && !this.win.isDestroyed());
    }

    open({ chatId = null } = {}) {
        const cfg = this.deps.getConfig();
        if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.focus(); return; }

        this.win = new BrowserWindow({
            width: 420,
            height: 720,
            minWidth: 320,
            minHeight: 420,
            frame: false,
            titleBarStyle: 'hidden',
            transparent: false,
            backgroundColor: '#0a0a0f',
            autoHideMenuBar: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: true,
            show: false,
            title: 'Live',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                spellcheck: false,
                backgroundThrottling: false
            }
        });

        try { this.win.setAlwaysOnTop(true, 'floating'); } catch (_) {}
        this.win.webContents.setAudioMuted(false);

        // Always keep live window above others when clicked but allow focus
        this.win.on('closed', () => {
            this.win = null;
            this.deps.onStateChange?.(false);
        });

        // Esc closes the live window
        this.win.webContents.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && input.key === 'Escape') {
                this.close();
                event.preventDefault();
            }
        });

        const base = cfg.url.replace(/\/+$/, '');
        let url = base + '/?call=true';
        if (chatId) {
            const fmt = cfg.advanced?.chatUrlFormat || '/c/{id}';
            url = base + fmt.replace('{id}', encodeURIComponent(chatId)) + '?call=true';
        }

        this.win.once('ready-to-show', () => { this.win.show(); this.win.focus(); });
        this.win.webContents.on('did-finish-load', () => {
            // A little window dressing: floating drag pill + rounded glass on the call UI
            try {
                this.win.webContents.insertCSS(`
                    html, body { overflow: hidden; }
                    body::before {
                        content: '';
                        position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
                        width: 38px; height: 4px; border-radius: 3px;
                        background: rgba(255,255,255,0.25); pointer-events: none; z-index: 99999;
                    }
                    body { -webkit-app-region: drag; border-radius: 12px; }
                    button, a, input, textarea, video, canvas, [role="button"],
                    [role="slider"] { -webkit-app-region: no-drag !important; }
                `);
            } catch (_) {}
        });

        this.win.loadURL(url).catch(() => {});
        this.deps.onStateChange?.(true);
    }

    close() {
        try { this.win?.destroy(); } catch (_) {}
        this.win = null;
        this.deps.onStateChange?.(false);
    }

    toggle(options = {}) {
        if (this.active) this.close();
        else this.open(options);
    }
}

module.exports = LiveModeManager;
