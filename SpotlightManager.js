const { BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SPOTLIGHT_WIDTH = Math.round(680);
const SPOTLIGHT_HEIGHT = Math.round(230);

/**
 * The Spotlight bar: a floating, frameless, always-on-top, translucent
 * command bar styled after macOS' search overlay. Shows with a smooth
 * spring animation handled inside spotlight.html and hides after a short
 * fade-out requested by the renderer.
 */
class SpotlightManager {
    constructor(deps) {
        // deps: { getConfig, onCommand(run), onQuery(text)=>Promise<chats>, onStateChanged, isLiveActive, sendToLive }
        this.deps = deps;
        this.win = null;
        this._hiding = false;
        this._closingForReal = false;
        this.targetHeight = SPOTLIGHT_HEIGHT;
    }

    setHeight(h) {
        const height = Math.max(150, Math.min(620, Math.round(h)));
        if (Math.abs(height - this.targetHeight) < 8) return;
        this.targetHeight = height;
        try {
            if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
                const b = this.win.getBounds();
                this.win.setBounds({ x: b.x, y: b.y, width: b.width, height });
            }
        } catch (_) {}
    }

    createWindow() {
        // acrylic requires Win11 22H2+ (build 22621); transparent windows can't use it
        const acrylic = this.deps.acrylicSupported?.() && !process.env.SHELL_SMOKE;
        this.win = new BrowserWindow({
            width: SPOTLIGHT_WIDTH,
            height: this.targetHeight,
            frame: false,
            transparent: false,
            backgroundMaterial: acrylic ? 'acrylic' : undefined,
            backgroundColor: acrylic ? '#00000000' : (process.env.SHELL_SMOKE ? '#15151a' : 'rgba(15,15,19,0.96)'),
            thickFrame: true,
            hasShadow: true,
            resizable: false,
            maximizable: false,
            minimizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            show: false,
            alwaysOnTop: true,
            center: false,
            acceptFocus: true,
            title: 'Spotlight',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'ui', 'preload.js'),
                backgroundThrottling: false
            }
        });
        const level = 'screen-saver';
        try { this.win.setAlwaysOnTop(true, level); } catch (_) { try { this.win.setAlwaysOnTop(true); } catch (_) {} }

        // Prefer reusing this hidden window (keeps it fast + warm).
        this.win.on('close', (e) => {
            if (!this._closingForReal && !this.deps.isQuitting?.()) {
                e.preventDefault();
                this.win.hide();
            }
        });

        // Any deviation of focus (clicking out) hides the overlay.
        this.win.on('blur', () => {
            if (this.win.isVisible()) this.hide();
        });

        try {
            this._loaded = this.win.loadFile(path.join(__dirname, 'ui', 'spotlight.html'));
            this._loaded.catch((e) => console.error('[Spotlight] Failed to load overlay html:', e));
        } catch (e) {
            console.error('[Spotlight] Failed to load overlay html:', e);
        }
        return this.win;
    }

    _ensure() {
        let w = this.win;
        if (!w || w.isDestroyed()) w = this.createWindow();
        return w;
    }

    async show() {
        const w = this._ensure();
        const state = this.deps.getState();
        // Position: centered horizontal, ~18% from top of the work area of the display the mouse is on.
        try {
            const pt = screen.getCursorScreenPoint();
            const display = screen.getDisplayNearestPoint(pt);
            const wa = display.workArea;
            w.setBounds({
                x: Math.round(wa.x + (wa.width - SPOTLIGHT_WIDTH) / 2),
                y: Math.round(wa.y + Math.min(160, wa.height * 0.2)),
                width: SPOTLIGHT_WIDTH,
                height: this.targetHeight
            });
        } catch (_) {
            w.center();
        }
        this._hiding = false;
        w.webContents.send('spotlight:state', state);
        await (this._loaded || Promise.resolve());
        w.show();
        w.focus();        // ensure keyboard focus so we can type immediately
        w.webContents.focus();
        w.webContents.send('spotlight:show');
    }

    async hide() {
        if (!this.win || this.win.isDestroyed()) return;
        this._hiding = true;
        try { this.win.webContents.send('spotlight:requestHide'); } catch (_) {}
        await new Promise((r) => setTimeout(r, 150)); // let the renderer fade out
        if (this.win && !this.win.isDestroyed()) this.win.hide();
        this._hiding = false;
    }

    toggle() {
        const w = this.win || null;
        if (!w || w.isDestroyed() || !w.isVisible()) this.show();
        else this.hide();
    }

    broadcastState(state) {
        try { this.win?.webContents.send('spotlight:state', state); } catch (_) {}
        try { this.deps.broadcaster?.('spotlight:state', state); } catch (_) {}
    }

    destroy() {
        this._closingForReal = true;
        try { this.win?.destroy(); } catch (_) {}
        this.win = null;
    }
}

module.exports = SpotlightManager;
