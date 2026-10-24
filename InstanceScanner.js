const net = require('net');
const http = require('http');

/**
 * Detects locally-running Open WebUI (and Ollama) instances by scanning ports.
 * @param {number[]} ports
 * @param {object} [opts]
 * @returns {Promise<Array<{url:string, kind:'open-webui'|'ollama'|'http', name:string, alive:boolean}>>}
 */
async function detectInstances(ports, opts = {}) {
    const list = ports || [8080, 8000, 3000, 5000, 5173, 7860, 11434];
    const timeout = opts.timeout || 350;
    const results = await Promise.allSettled(list.map((p) => probePort(p, timeout)));
    const found = [];
    for (const r of results) {
        if (r.status === 'fulfilled' && r.value) found.push(r.value);
    }
    return found;
}

function httpGet(url, timeoutMs) {
    return new Promise((resolve) => {
        try {
            const req = http.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'OpenWebUI-Shell/2' } }, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (c) => { if (data.length < 4096) data += c; });
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch (_) {
            resolve(null);
        }
    });
}

function portOpen(port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => { done = true; socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.on('error', () => resolve(false));
        socket.connect(port, '127.0.0.1');
        setTimeout(() => { if (!done) { socket.destroy(); resolve(false); } }, timeoutMs + 50);
    });
}

async function probePort(port, timeoutMs) {
    const ok = await portOpen(port, timeoutMs);
    if (!ok) return null;

    // classify
    const probe = async (path) => await httpGet(`http://127.0.0.1:${port}${path}`, timeoutMs);

    let res = await probe('/api/version');
    if (res && res.status === 200 && /"version"|open.webui/i.test(res.body)) {
        return { url: `http://127.0.0.1:${port}`, kind: 'open-webui', name: `Open WebUI :${port}`, alive: true };
    }

    res = await probe('/api/tags');
    if (res && res.status === 200 && /"models"/i.test(res.body)) {
        return { url: `http://127.0.0.1:${port}`, kind: 'ollama', name: `Ollama :${port}`, alive: true };
    }

    res = await probe('/health');
    if (res && res.status === 200) {
        return { url: `http://127.0.0.1:${port}`, kind: 'http', name: `Service :${port}`, alive: true };
    }

    res = await probe('/');
    if (res && (res.status === 200 || res.status === 302 || res.status === 401)) {
        if (/open.?webui/i.test(res.body) || res.headers && null) {}
        return { url: `http://127.0.0.1:${port}`, kind: 'http', name: `Service :${port}`, alive: true };
    }
    return null;
}

/** Quick single-instance health check. */
async function checkAlive(url, timeoutMs = 700) {
    try {
        // force IPv4 for 'localhost' (many local servers bind 127.0.0.1 only)
        let target = url.replace(/\/+$/, '');
        target = target.replace(/^(http:\/\/)localhost(?=:)/i, '$1127.0.0.1');
        const res = await httpGet(target + '/api/version', timeoutMs);
        return !!(res && res.status === 200 && /version/i.test(res.body));
    } catch (_) {
        return false;
    }
}

module.exports = { detectInstances, checkAlive };
