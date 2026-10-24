const { BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * A native-feeling settings window (Windows 11 mica-style) rendered from
 * ui/settings.html, talking to main over the ui/preload.js bridge.
 */
class SettingsWindow {
    constructor(deps) {
        // deps: { getConfig, isQuitting }
        this.deps = deps;
        this.win = null;
    }

    show() {
        if (this.win && !this.win.isDestroyed()) {
            this.win.show();
            this.win.focus();
            return;
        }
        this.win = new BrowserWindow({
            width: 980,
            height: 660,
            minWidth: 780,
            minHeight: 540,
            frame: false,
            titleBarStyle: 'hidden',
            titleBarOverlay: {
                color: '#00000000',
                symbolColor: '#cfccc6',
                height: 36
            },
            backgroundColor: '#0e0e12',
            show: false,
            resizable: true,
            title: 'Open WebUI Shell — Settings',
            icon: nativeImage.createFromPath(path.join(__dirname, 'icon.png')),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'ui', 'preload.js'),
                backgroundThrottling: false
            }
        });

        this.win.on('close', (e) => {
            if (!this.deps.isQuitting?.()) {
                e.preventDefault();
                this.win.hide(); // keep warm for next open
            }
        });

        try {
            const html = fs.readFileSync(path.join(__dirname, 'ui', 'settings.html'), 'utf8');
            this.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        } catch (e) {
            console.error('[Settings] Failed to load html:', e);
        }
        this.win.once('ready-to-show', () => { this.win.show(); this.win.focus(); });
    }

    broadcast(channel, payload) {
        try { this.win?.webContents.send(channel, payload); } catch (_) {}
    }

    destroy() {
        try { this.win?.destroy(); } catch (_) {}
        this.win = null;
    }
}

module.exports = SettingsWindow;
