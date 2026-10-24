const { Menu, nativeImage } = require('electron');
const path = require('path');

/**
 * Tray icon + context menu. Actions are injected from main.js so this class
 * stays dumb (no hidden placeholders like before).
 */
class TrayManager {
    constructor(deps) {
        // deps: { getConfig, actions: {openMain, openSpotlight, toggleLive, isLiveActive, openSettings,
        //        openInBrowser, selectInstance(url,name), detectInstances, quit} }
        this.deps = deps;
        this.tray = null;
        this.icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
    }

    create() {
        this.tray = new (require('electron').Tray)(this.icon);
        this.tray.setToolTip('Open WebUI Shell');
        this.rebuild();
        return this.tray;
    }

    rebuild() {
        if (!this.tray) return;
        const a = this.deps.actions;
        const cfg = this.deps.getConfig();
        const instances = (cfg.instances || []).map((i) => ({
            label: `${i.name || i.url}  —`,
            type: 'radio',
            checked: i.url === cfg.url,
            click: () => a.selectInstance(i.url, i.name)
        }));

        const template = [
            { label: 'Open WebUI Shell', enabled: false },
            { type: 'separator' },
            { label: 'Open Window', click: () => a.openMain() },
            { label: 'Spotlight  (' + (cfg.shortcuts?.spotlight || 'Alt+Space') + ')', click: () => a.openSpotlight() },
            {
                label: 'Live Mode  (' + (cfg.shortcuts?.liveMode || 'Ctrl+Alt+M') + ')',
                type: 'checkbox',
                checked: !!a.isLiveActive(),
                click: () => a.toggleLive()
            },
            { type: 'separator' },
            {
                label: 'Instances',
                submenu: instances.length ? instances : [{ label: 'No saved instances yet', enabled: false }]
            },
            { label: 'Detect Local Instances', click: () => a.detectInstances() },
            { label: 'Open in Default Browser', click: () => a.openInBrowser() },
            { type: 'separator' },
            { label: 'Settings…', click: () => a.openSettings() },
            {
                label: 'Always on Top',
                type: 'checkbox',
                checked: !!cfg.window?.alwaysOnTop,
                click: (item) => a.setAlwaysOnTop(item.checked)
            },
            { type: 'separator' },
            { label: 'Quit', click: () => a.quit() }
        ];

        this.tray.setContextMenu(Menu.buildFromTemplate(template));
    }
}

module.exports = TrayManager;
