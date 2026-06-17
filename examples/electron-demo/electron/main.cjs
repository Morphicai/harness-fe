// Electron main process. Creates one BrowserWindow and points it at the vite dev
// server (dev) or the built file (prod). The renderer is an ordinary Chromium
// context, so the harness-fe runtime + rrweb recorder injected by the vite plugin
// run there unchanged — that's exactly what this demo verifies (harness-fe#159).
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const RENDERER_URL = process.env.RENDERER_URL || 'http://127.0.0.1:47816';
const isDev = !app.isPackaged;

function createWindow() {
    const win = new BrowserWindow({
        width: 900,
        height: 720,
        webPreferences: {
            // Standard hardened renderer. rrweb records the DOM regardless of
            // these — it needs no Node access. contextIsolation does NOT affect
            // the harness runtime: the plugin injects into the page's own world.
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });

    if (isDev) {
        // MUST load over HTTP (the vite dev server) so the plugin's HTML
        // injection (`window.__HARNESS_FE__` + runtime entry) is present.
        win.loadURL(RENDERER_URL);
        if (process.env.OPEN_DEVTOOLS && process.env.OPEN_DEVTOOLS !== '0') {
            win.webContents.openDevTools({ mode: 'detach' });
        }
    } else {
        win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
