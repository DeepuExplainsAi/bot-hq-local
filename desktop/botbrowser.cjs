// One bot's browser: a window (Electron's Chromium) with its own profile folder and DevTools port.
// Started by the server (server/src/botbrowser.ts) with BOTHQ_BROWSER_PROFILE and BOTHQ_CDP_PORT.
// The window is never shown to the user: the app's viewer shows it (DevTools screencast) and the agent drives it.
const { app, BrowserWindow } = require('electron');

const W = 1280, H = 800;
const HOME = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Home</title><body style="margin:0;background:#f6f6f4">');

app.setPath('userData', process.env.BOTHQ_BROWSER_PROFILE);
app.commandLine.appendSwitch('remote-debugging-port', process.env.BOTHQ_CDP_PORT);
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-allow-origins', '*');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion'); // a hidden window must keep painting

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false, frame: false, resizable: false,
    webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true },
  });
  // Links that want a new window open in this one: the viewer shows a single surface.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) win.loadURL(url); return { action: 'deny' }; });
  win.loadURL(HOME);
});
app.on('window-all-closed', () => app.quit());
// An external protocol link must not launch other programs on the user's machine.
app.on('web-contents-created', (_e, contents) => contents.on('will-navigate', (e, url) => { if (!/^(https?|data|about|file|blob):/.test(url)) { e.preventDefault(); } }));
