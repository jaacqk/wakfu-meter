'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app, BrowserWindow, ipcMain, nativeImage, globalShortcut, clipboard, screen, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { FightTracker } = require('./src/parser');
const { SessionStats } = require('./src/session');
const { tailLines } = require('./src/tail');
const { loadPortraits } = require('./src/portraits');
const { CLASSES } = require('./src/classes');
const { findWakfuFiles, searchRoots } = require('./src/logpath');

// Default locations (Ankama launcher), used when nothing better is found.
const DEFAULT_LOG = path.join(app.getPath('appData'), 'zaap', 'gamesLogs', 'wakfu', 'logs', 'wakfu_chat.log');
const DEFAULT_GUI_JAR = path.join(app.getPath('home'), 'AppData', 'Local', 'Ankama', 'Wakfu', 'contents', 'gui_jar', 'gui.jar');

// Global shortcuts (work while the game has focus) -> command sent to the page.
const SHORTCUTS = {
  'Control+Alt+W': 'toggle-visible',
  'Control+Alt+C': 'click-through',
  'Control+Alt+T': 'next-tab',
  'Control+Alt+R': 'reset',
};

// Small JSON files in the app's data folder.
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), name), 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(name, value) {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), name), JSON.stringify(value));
  } catch {}
}

let win;
let status = null;
let portraits = {};
let live = false; // false while the logs already on disk are being read at launch
const settings = { launchWithWakfu: false, ...readJson('settings.json', {}) };
// name -> { won, lost, by: { player: failures } }, kept across sessions
const challenges = readJson('challenges.json', {});
const tracker = new FightTracker();
const session = new SessionStats();
tracker.onChallenge = (name, won, culprit) => {
  if (!live) return; // old log lines must not be counted again at each launch
  const c = (challenges[name] ||= { won: 0, lost: 0 });
  c[won ? 'won' : 'lost']++;
  if (!won) {
    c.by ||= {};
    const who = culprit || '?';
    c.by[who] = (c.by[who] || 0) + 1;
  }
  writeJson('challenges.json', challenges);
};

// Everything the overlay shows.
function view() {
  return { fight: tracker.snapshot(), cumul: tracker.cumulSnapshot(), session: session.snapshot(), challenges };
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// Class portraits as data URLs, read from the local game install.
function loadPortraitUrls(guiJar) {
  try {
    const urls = {};
    for (const [key, { width, height, bgra }] of Object.entries(loadPortraits(guiJar))) {
      urls[key] = nativeImage.createFromBitmap(bgra, { width, height }).toDataURL();
    }
    return urls;
  } catch (err) {
    console.warn(`Portraits indisponibles (${guiJar}) : ${err.message}`);
    return {};
  }
}

function sendClasses() {
  send('classes', { classes: CLASSES, portraits, version: app.getVersion() });
}

// Where the game writes its logs depends on how it was installed: a file
// chosen by hand wins, else the newest one found on this PC. Without any,
// the search is retried until the game has written one.
async function locateWakfu() {
  const found = await findWakfuFiles(await searchRoots());
  const exists = (p) => p && fs.existsSync(p);
  const chosen = process.env.WAKFU_CHAT_LOG || (exists(settings.logPath) ? settings.logPath : null);
  return { chatLog: chosen || found.chatLog, guiJar: found.guiJar || DEFAULT_GUI_JAR };
}

// Window position, remembered between launches.
function savedPosition() {
  const pos = readJson('position.json', null);
  if (!pos) return {};
  const { x, y } = pos;
  // Ignore it if that spot is no longer on a screen (e.g. monitor unplugged).
  const area = screen.getDisplayMatching({ x, y, width: 50, height: 20 }).workArea;
  const visible = x >= area.x - 40 && y >= area.y - 10 && x < area.x + area.width - 40 && y < area.y + area.height - 20;
  return visible ? { x, y } : {};
}

function rememberPosition() {
  let timer = null;
  win.on('moved', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const [x, y] = win.getPosition();
      writeJson('position.json', { x, y });
    }, 500);
  });
}

function createWindow(show) {
  win = new BrowserWindow({
    ...savedPosition(),
    width: 260,
    height: 74,
    show,
    transparent: true,
    frame: false,
    resizable: false, // transparent windows can't be edge-resized on Windows; see the grip
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  // 'screen-saver' keeps it above the game in borderless/fullscreen-windowed mode.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  rememberPosition();
  win.webContents.on('did-finish-load', () => {
    sendClasses();
    send('settings', settings);
    send('fight', view());
    if (status) send('status', status);
  });
}

function registerShortcuts() {
  for (const [accelerator, command] of Object.entries(SHORTCUTS)) {
    const ok = globalShortcut.register(accelerator, () => {
      if (command === 'toggle-visible') {
        if (win.isVisible()) win.hide();
        else win.showInactive();
      } else {
        send('command', command);
      }
    });
    if (!ok) console.warn(`Raccourci déjà utilisé par une autre application : ${accelerator}`);
  }
}

// --- "Launch with Wakfu": the app starts with Windows (hidden), shows up when
// the game runs and hides when it closes.
const STARTED_AT_LOGIN = process.argv.includes('--with-wakfu');

function applyLaunchSetting() {
  if (!app.isPackaged) return; // only the installed app can register itself
  app.setLoginItemSettings({ openAtLogin: settings.launchWithWakfu, args: ['--with-wakfu'] });
}

// Wakfu runs as javaw.exe with a window titled "<character> - WAKFU".
function isWakfuRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/V', '/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq javaw.exe'], { windowsHide: true }, (err, out) => {
      resolve(!err && /WAKFU"\s*$/m.test(out));
    });
  });
}

let wakfuWasRunning = null;
async function watchWakfu() {
  if (settings.launchWithWakfu) {
    const running = await isWakfuRunning();
    if (running && wakfuWasRunning !== true) win.showInactive();
    if (!running && wakfuWasRunning === true) win.hide();
    wakfuWasRunning = running;
  } else {
    wakfuWasRunning = null;
  }
  setTimeout(watchWakfu, 5000);
}

// One overlay at a time: launching it again just shows the running one.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => win?.showInactive());

function setStatus(s) {
  status = s;
  send('status', s);
}

// Reads the chat log (and the technical log next to it) as it grows.
function follow(chatLog) {
  tailLines(
    chatLog,
    (lines) => {
      let changed = false;
      for (const line of lines) {
        changed = tracker.feed(line) || changed;
        changed = session.feed(line) || changed;
      }
      // The cumul and the session start at launch, not with the old fights
      // already in the log; only a fight still going on is shown.
      if (!live) {
        const now = new Date();
        tracker.forgetPast(now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());
        tracker.resetCumul();
        session.reset();
        live = true;
      }
      if (changed) send('fight', view());
    },
    setStatus
  );
  // Optional: lists the fighters (and their class) of each fight; without it,
  // players and classes are inferred from the chat log alone.
  tailLines(
    path.join(path.dirname(chatLog), 'wakfu.log'),
    (lines) => {
      let changed = false;
      for (const line of lines) changed = tracker.feedTech(line) || changed;
      if (changed) send('fight', view());
    },
    () => {}
  );
}

function waitForLog(chatLog) {
  if (chatLog) return follow(chatLog);
  setStatus({ ok: false, path: null });
  setTimeout(async () => waitForLog((await locateWakfu()).chatLog), 10000);
}

app.whenReady().then(async () => {
  createWindow(!STARTED_AT_LOGIN); // at login, wait for Wakfu before showing up
  registerShortcuts();
  applyLaunchSetting();
  watchWakfu();
  // Installed app: look for a newer release on GitHub; it downloads in the
  // background and installs when the app quits (with a Windows notification).
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.warn(`Mise à jour impossible : ${err.message}`));
  }

  ipcMain.on('reset', () => {
    tracker.reset();
    send('fight', view());
  });
  ipcMain.on('reset-cumul', () => {
    tracker.resetCumul();
    send('fight', view());
  });
  ipcMain.on('reset-session', () => {
    session.reset();
    send('fight', view());
  });
  ipcMain.on('reset-challenges', () => {
    for (const name of Object.keys(challenges)) delete challenges[name];
    writeJson('challenges.json', challenges);
    send('fight', view());
  });
  ipcMain.on('set-launch-with-wakfu', (_e, on) => {
    settings.launchWithWakfu = !!on;
    writeJson('settings.json', settings);
    applyLaunchSetting();
    send('settings', settings);
  });
  // The log file chosen by hand; the app restarts to read it from scratch.
  ipcMain.on('choose-log', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choisir le log de chat de Wakfu (wakfu_chat.log)',
      defaultPath: status?.path || DEFAULT_LOG,
      filters: [{ name: 'Log de chat Wakfu', extensions: ['log'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return;
    settings.logPath = filePaths[0];
    writeJson('settings.json', settings);
    app.relaunch();
    app.exit(0);
  });
  ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text)));
  // Click-through: the page asks to ignore mouse events except over its
  // interactive parts; 'forward' keeps mouse moves coming to detect those.
  ipcMain.on('ignore-mouse', (_e, ignore) => {
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on('close', () => app.quit());
  // The page scales its content and asks for the matching window size.
  ipcMain.on('fit', (_e, { width, height }) => {
    if (!win || win.isDestroyed()) return;
    const [w, h] = win.getContentSize();
    if (w !== width || h !== height) win.setContentSize(Math.max(40, width), Math.max(20, height));
  });

  const { chatLog, guiJar } = await locateWakfu();
  portraits = loadPortraitUrls(guiJar);
  sendClasses();
  waitForLog(chatLog);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
