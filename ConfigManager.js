const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { app } = require('electron');

let configPath = null;

function resolveConfigPath() {
    if (configPath) return configPath;
    const userData = (app && app.getPath) ? app.getPath('userData') : path.join(__dirname, 'data');
    try {
        fsSync.mkdirSync(userData, { recursive: true });
    } catch (_) {}
    configPath = path.join(userData, 'config.json');
    return configPath;
}

/**
 * Default configuration. Everything the shell supports lives here.
 */
const DEFAULT_CONFIG = {
    version: 2,
    // Active instance URL
    url: 'http://localhost:8080',
    // Saved instances: [{ name, url, lastUsed }]
    instances: [],

    // Global shortcuts
    shortcuts: {
        spotlight: 'Alt+Space',
        toggleWindow: 'Control+Shift+Space',
        liveMode: 'Control+Alt+M',
        devTools: 'Control+Alt+D'
    },

    // Main window
    window: {
        width: 1400,
        height: 1000,
        minZoom: -0.5,
        backdrop: 'acrylic', // 'acrylic' | 'mica' | 'none'
        alwaysOnTop: false,
        rememberSize: true
    },

    // Behavior
    behavior: {
        closeToTray: true,
        launchAtLogin: false,
        backgroundThrottling: true,
        spotlightOnStartup: false,
        showStatus: true
    },

    // Appearance
    appearance: {
        hideScrollbar: true,
        titleBarOverlayHeight: 40,
        customCSS: ''
    },

    // Advanced
    advanced: {
        chatUrlFormat: '/c/{id}',   // Open WebUI chat route style
        scanPorts: [8080, 8000, 3000, 5000, 5173, 7860, 11434],
        spotlightResults: 6
    }
};

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const key of Object.keys(patch || {})) {
        const val = patch[key];
        if (isPlainObject(val) && isPlainObject(out[key])) {
            out[key] = deepMerge(out[key], val);
        } else if (val !== undefined) {
            out[key] = val;
        }
    }
    return out;
}

/**
 * Loads config from disk with deep-merge onto defaults (so new fields appear).
 * @returns {Promise<object>}
 */
async function loadConfig() {
    const file = resolveConfigPath();
    try {
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!isPlainObject(data)) return structuredClone(DEFAULT_CONFIG);
        // migrate older configs that only saved { url }
        return deepMerge(DEFAULT_CONFIG, data);
    } catch (e) {
        if (e.code !== 'ENOENT') console.error('[Config] Load failed:', e.message);
        return structuredClone(DEFAULT_CONFIG);
    }
}

/**
 * Saves the full config atomically.
 * @param {object} config
 * @returns {Promise<boolean>}
 */
async function saveConfig(config) {
    const file = resolveConfigPath();
    const tmp = file + '.tmp';
    try {
        await fs.writeFile(tmp, JSON.stringify(config, null, 4), 'utf8');
        await fs.rename(tmp, file);
        return true;
    } catch (e) {
        console.error('[Config] Save failed:', e.message);
        try { await fs.unlink(tmp); } catch (_) {}
        return false;
    }
}

/**
 * Sanitizes a URL: adds scheme, trims, no trailing slash.
 */
function normalizeUrl(raw) {
    let url = String(raw || '').trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    try {
        const u = new URL(url);
        u.pathname = u.pathname.replace(/\/+$/, '');
        if (u.pathname === '/') u.pathname = '';
        return u.origin + (u.pathname || '');
    } catch (_) {
        return null;
    }
}

function registerMigration() {
    if (process.app) process.app = null; // legacy stub safety
}

module.exports = { DEFAULT_CONFIG, loadConfig, saveConfig, deepMerge, normalizeUrl, getConfigPath: resolveConfigPath };
