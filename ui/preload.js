const { contextBridge, ipcRenderer } = require('electron');

// Allowlisted IPC surface — everything the renderer windows may call.
const INVOKE_CHANNELS = new Set([
    'config:get', 'config:set', 'config:reset', 'config:openFile',
    'spotlight:hide', 'spotlight:query', 'spotlight:run', 'spotlight:resize',
    'actions:main', 'actions:newChat', 'actions:reload', 'actions:openSettings',
    'actions:openInBrowser', 'actions:toggleAlwaysOnTop', 'actions:openDevTools',
    'actions:toggleLive', 'actions:liveState',
    'instances:list', 'instances:detect', 'instances:save', 'instances:select', 'instances:remove',
    'window:close', 'window:minimize', 'window:setBackdrop'
]);

const ON_CHANNELS = new Set([
    'spotlight:show', 'spotlight:requestHide', 'spotlight:state', 'spotlight:queryResult',
    'config:changed', 'settings:refresh', 'instances:update'
]);

contextBridge.exposeInMainWorld('shellAPI', {
    invoke: (channel, payload) => {
        if (!INVOKE_CHANNELS.has(channel)) return Promise.reject(new Error('Blocked channel: ' + channel));
        return ipcRenderer.invoke(channel, payload);
    },
    on: (channel, callback) => {
        if (!ON_CHANNELS.has(channel)) return () => {};
        const handler = (_e, data) => callback(data);
        ipcRenderer.on(channel, handler);
        return () => ipcRenderer.removeListener(channel, handler);
    }
});
