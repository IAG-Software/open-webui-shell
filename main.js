const { app, ipcMain, globalShortcut, session, dialog, shell } = require('electron');
const path = require('path');
const { loadConfig, saveConfig, deepMerge, normalizeUrl, DEFAULT_CONFIG, getConfigPath } = require('./ConfigManager');
const WindowManager = require('./WindowManager');
const SpotlightManager = require('./SpotlightManager');
const LiveModeManager = require('./LiveModeManager');
const SettingsWindow = require('./SettingsWindow');
const TrayManager = require('./TrayManager');
const { detectInstances, checkAlive } = require('./InstanceScanner');

let config = null;
let isQuitting = false;
let windowManager, spotlight, settingsWindow, live, tray;
let persistTimer = null;

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Bring the shell forward — argv/extra args could carry a "show spotlight" hint:
        try {
            windowManager?.win?.show?.();
        } catch (_) {}
        spotlight?.show();
    });

    app.whenReady().then(bootstrap);
}

async function bootstrap() {
    config = await loadConfig();
    config.appVersion = app.getVersion();

    // Acrylic backdrop needs Windows 11 22H2+ (build 22621)
    const supportAcrylic = (() => {
        try {
            const [a, b, build] = require('os').release().split('.').map(Number);
            return a > 10 || (a === 10 && b === 0 && build >= 22621);
        } catch (_) { return false; }
    })();

    windowManager = new WindowManager({
        getConfig: () => config,
        spawnSettings: () => settingsWindow.show(),
        persistThrottled: (c) => {
            config = c;
            clearTimeout(persistTimer);
            persistTimer = setTimeout(() => saveConfig(config), 800);
        }
    });

    spotlight = new SpotlightManager({
        getConfig: () => config,
        isQuitting: () => isQuitting,
        acrylicSupported: () => supportAcrylic,
        getState: () => ({
            url: config.url,
            connected: false, // updated async below
            liveActive: live?.active || false,
            acrylic: supportAcrylic
        }),
        broadcaster: (ch, payload) => broadcaster(ch, payload)
    });

    settingsWindow = new SettingsWindow({ getConfig: () => config, isQuitting: () => isQuitting });

    live = new LiveModeManager({
        getConfig: () => config,
        onStateChange: (active) => {
            spotlight?.broadcastState({ url: config.url, connected: lastAlive, liveActive: active });
            try { tray?.rebuild(); } catch (_) {}
        }
    });
    windowManager.create();
    windowManager.setCloseToTray(config.behavior?.closeToTray !== false);

    tray = new TrayManager({ getConfig: () => config, actions: trayActions });

    setupIpc();
    registerShortcuts();
    applyLoginItem();
    tray.create();

    // status probes
    updateAlive();

    if (config.behavior?.spotlightOnStartup) setTimeout(() => spotlight.show(), 600);

    if (process.env.SHELL_SMOKE) runSmokeTest();
}

/* ──────────────────────────────────────────────── */

let lastAlive = false;
async function updateAlive() {
    lastAlive = await checkAlive(config.url);
    spotlight.broadcastState({ url: config.url, connected: lastAlive, liveActive: live?.active || false });
    try { tray?.rebuild(); } catch (_) {}
}

function broadcaster(ch, payload) {
    try { settingsWindow?.broadcast(ch, payload); } catch (_) {}
}

function registerShortcuts() {
    globalShortcut.unregisterAll();
    const s = config.shortcuts || DEFAULT_CONFIG.shortcuts;
    const ok = globalShortcut.register(s.spotlight, () => spotlight.toggle());
    globalShortcut.register(s.toggleWindow, () => windowManager.toggleVisible());
    globalShortcut.register(s.liveMode, () => toggleLive());
    globalShortcut.register(s.devTools, () => {
        const wc = windowManager?.win?.webContents;
        if (!wc) return;
        wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' });
    });
    if (!ok) console.error('[Shell] Spotlight shortcut failed to register:', s.spotlight);
}

function toggleLive(chatId = null) {
    if (live?.active) live.close();
    else {
        live.open({ chatId });
        // bring main window up too if hidden? No — live is meant to float above anything.
    }
    spotlight.broadcastState({ url: config.url, connected: lastAlive, liveActive: live?.active || false });
}

const trayActions = {
    openMain: () => windowManager.toggleVisible(),
    openSpotlight: () => spotlight.show(),
    toggleLive: () => toggleLive(),
    isLiveActive: () => live?.active || false,
    openSettings: () => settingsWindow.show(),
    openInBrowser: () => shell.openExternal(config.url),
    selectInstance: (url) => switchInstance(url),
    detectInstances: async () => {
        const found = await detectInstances(config.advanced?.scanPorts);
        const ui = found.filter(f => f.kind === 'open-webui');
        if (ui.length) {
            config.instances = mergeInstances(config.instances, ui.map(f => ({ name: f.name, url: f.url, lastUsed: Date.now() })));
            await saveConfig(config);
        }
        tray.rebuild();
    },
    setAlwaysOnTop: (on) => {
        config.window.alwaysOnTop = on;
        saveConfig(config);
        windowManager.applyConfigLive(config);
    },
    quit: () => { isQuitting = true; app.quit(); }
};

function mergeInstances(existing, incoming) {
    const map = new Map(existing.map(i => [i.url, i]));
    for (const i of incoming) {
        if (map.has(i.url)) Object.assign(map.get(i.url), { name: i.name, lastUsed: i.lastUsed });
        else map.set(i.url, i);
    }
    return [...map.values()];
}

async function switchInstance(url) {
    config.url = url;
    await saveConfig(config);
    windowManager.navigate(url);
    tray.rebuild();
    updateAlive();
}

/* ───────────────────────── IPC ────────────────── */
function setupIpc() {
    // config
    ipcMain.handle('config:get', () => ({ ...config, configPath: getConfigPath() }));
    ipcMain.handle('config:set', async (_e, patch) => {
        // re-register shortcuts if needed
        const shortcutsChanged = JSON.stringify(patch?.shortcuts) !== JSON.stringify(config.shortcuts);
        config = deepMerge(config, patch);
        await saveConfig(config);
        if (shortcutsChanged) registerShortcuts();
        applyLoginItem();
        windowManager?.applyConfigLive(config);
        windowManager?.setCloseToTray(config.behavior?.closeToTray !== false);
        broadcaster('config:changed', config);
        tray?.rebuild();
        return true;
    });
    ipcMain.handle('config:reset', async () => {
        const keepUrl = config.url;
        const keepInstances = config.instances;
        config = structuredClone(DEFAULT_CONFIG);
        config.url = keepUrl;
        config.instances = keepInstances;
        await saveConfig(config);
        registerShortcuts();
        applyLoginItem();
        return config;
    });
    ipcMain.handle('config:openFile', () => shell.openPath(getConfigPath()));

    // spotlight
    ipcMain.handle('spotlight:hide', () => { spotlight.hide(); return true; });
    ipcMain.handle('spotlight:resize', (_e, { height }) => { spotlight.setHeight(height); return true; });
    ipcMain.handle('spotlight:query', async (_e, { text }) => {
        const q = (text || '').trim();
        try {
            const code = buildChatQueryJs(q, config.advanced?.spotlightResults || 6);
            const rows = await windowManager.executeJs(code);
            return Array.isArray(rows) ? rows : [];
        } catch (_) {
            return [];
        }
    });
    ipcMain.handle('spotlight:run', (_e, { id, arg }) => {
        console.log('[Spotlight] run:', id, arg || '');
        switch (id) {
            case 'openChat': windowManager?.navigateToChat(arg.id); windowManager?.win?.show?.(); break;
            case 'goto': {
                const u = normalizeUrl(arg.url);
                if (u) switchInstance(u);
                break;
            }
            case 'livetoggle': toggleLive(); break;
            case 'newchat': windowManager?.newChat(); break;
            case 'settings': settingsWindow.show(); break;
            case 'reload': windowManager?.reload(); break;
            case 'aot': trayActions.setAlwaysOnTop(!config.window?.alwaysOnTop); break;
            case 'browser': trayActions.openInBrowser(); break;
            case 'devtools': {
                const wc = windowManager?.win?.webContents;
                if (wc) wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' });
                break;
            }
            case 'detect': trayActions.detectInstances(); break;
            case 'quit': trayActions.quit(); break;
        }
        return true;
    });

    // actions (settings ui)
    ipcMain.handle('actions:newChat', () => windowManager?.newChat());
    ipcMain.handle('actions:reload', () => windowManager?.reload());
    ipcMain.handle('actions:openSettings', () => settingsWindow.show());
    ipcMain.handle('actions:openInBrowser', (_e, { url } = {}) => shell.openExternal(url || config.url));
    ipcMain.handle('actions:toggleAlwaysOnTop', (_e, on) => trayActions.setAlwaysOnTop(!!on));
    ipcMain.handle('actions:openDevTools', () => {
        const wc = windowManager?.win?.webContents;
        if (wc) wc.openDevTools({ mode: 'detach' });
    });
    ipcMain.handle('actions:toggleLive', () => toggleLive());
    ipcMain.handle('actions:liveState', () => live?.active || false);
    ipcMain.handle('actions:main', () => windowManager.toggleVisible());

    // instances
    ipcMain.handle('instances:detect', () => detectInstances(config.advanced?.scanPorts));
    ipcMain.handle('instances:save', async (_e, { instances, select }) => {
        config.instances = instances || [];
        if (select) config.url = select;
        await saveConfig(config);
        if (select) windowManager.navigate(select);
        tray?.rebuild();
        updateAlive();
        return config;
    });
    ipcMain.handle('instances:select', async (_e, { url }) => { await switchInstance(url); return true; });
    ipcMain.handle('instances:remove', async (_e, { url }) => {
        config.instances = (config.instances || []).filter(i => i.url !== url);
        await saveConfig(config);
        return config;
    });
    ipcMain.handle('instances:list', () => config.instances || []);
}

/**
 * Builds JS executed inside the main window (same origin + session cookies)
 * to search or list chats from the real Open WebUI API.
 */
function buildChatQueryJs(q, limit) {
    const list = q
        ? `/api/v1/chats/search?q=${encodeURIComponent(q)}`
        : '/api/v1/chats/?limit=' + limit;
    return `(async () => {
        try {
            const res = await fetch('${list}', { credentials: 'include' });
            if (!res.ok) return [];
            let data = await res.json();
            if (!Array.isArray(data)) return [];
            data = data.slice(0, ${limit});
            return data.map(c => ({ id: c.id, title: c.title || 'Untitled' }));
        } catch (e) { return []; }
    })()`;
}

function applyLoginItem() {
    try {
        app.setLoginItemSettings({
            openAtLogin: !!config.behavior?.launchAtLogin,
            args: ['--hidden']
        });
    } catch (_) {}
}

// --quit → allow windows to actually die
app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('quit', () => { spotlight?.destroy(); settingsWindow?.destroy(); });

/* ───────────────────── smoke test ─────────────── */
async function runSmokeTest() {
    const fs = require('fs');
    try { fs.mkdirSync(path.join(__dirname, '.snapshots'), { recursive: true }); } catch (_) {}
    setTimeout(async () => {
        try {
            const logWc = (wc, name) => {
                wc.on('console-message', (_e, level, message, line, source) => {
                    console.log(`[${name}] console(${level}): ${message} @${source}:${line}`);
                });
                wc.on('did-fail-load', (_e, code, desc, url) => console.log(`[${name}] did-fail-load ${code} ${desc} ${url}`));
            };
            if (spotlight.win) logWc(spotlight.win.webContents, 'spotlight');
            if (windowManager.win) logWc(windowManager.win.webContents, 'main');
            const shot = async (wc, file) => {
                let img = null;
                for (let attempt = 0; attempt < 4; attempt++) {
                    img = await wc.capturePage();
                    if (img && !img.isEmpty() && img.toPNG().length > 0) break;
                    await new Promise(r => setTimeout(r, 600));
                }
                fs.writeFileSync(path.join(__dirname, '.snapshots', file), img ? img.toPNG() : Buffer.alloc(0));
                console.log('[Smoke] saved', file);
            };
            if (windowManager.win && !windowManager.win.isDestroyed()) {
                windowManager.win.show();
                await new Promise(r => setTimeout(r, 3500));
                await shot(windowManager.win.webContents, 'main.png');
            }
            spotlight.show();
            await new Promise(r => setTimeout(r, 1600));
            await shot(spotlight.win.webContents, 'spotlight.png');
            settingsWindow.show();
            await new Promise(r => setTimeout(r, 1200));
            await shot(settingsWindow.win.webContents, 'settings.png');
        } catch (e) {
            console.error('[Smoke] failed', e);
        } finally {
            console.log('[Smoke] quitting');
            isQuitting = true;
            app.quit();
            setTimeout(() => app.exit(0), 1500);
        }
    }, 1500);
}
