'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, nativeImage, globalShortcut, clipboard, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const { FightTracker } = require('./src/parser');
const { tailLines } = require('./src/tail');
const { loadPortraits } = require('./src/portraits');
const { CLASSES } = require('./src/classes');

const LOG_PATH =
  process.env.WAKFU_CHAT_LOG ||
  path.join(app.getPath('appData'), 'zaap', 'gamesLogs', 'wakfu', 'logs', 'wakfu_chat.log');
// The game's technical log, next to it: lists the fighters (and their class) of each fight.
const TECH_LOG_PATH = path.join(path.dirname(LOG_PATH), 'wakfu.log');
const GUI_JAR = path.join(app.getPath('home'), 'AppData', 'Local', 'Ankama', 'Wakfu', 'contents', 'gui_jar', 'gui.jar');

// Global shortcuts (work while the game has focus) -> command sent to the page.
const SHORTCUTS = {
  'Control+Alt+W': 'toggle-visible',
  'Control+Alt+C': 'click-through',
  'Control+Alt+T': 'next-tab',
  'Control+Alt+R': 'reset',
};

let win;
let status = null;
let portraits = {};
const tracker = new FightTracker();

// Everything the overlay shows: current fight and the cumul.
function view() {
  return { fight: tracker.snapshot(), cumul: tracker.cumulSnapshot() };
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// Class portraits as data URLs, read from the local game install.
function loadPortraitUrls() {
  try {
    const urls = {};
    for (const [key, { width, height, bgra }] of Object.entries(loadPortraits(GUI_JAR))) {
      urls[key] = nativeImage.createFromBitmap(bgra, { width, height }).toDataURL();
    }
    return urls;
  } catch (err) {
    console.warn(`Portraits indisponibles (${GUI_JAR}) : ${err.message}`);
    return {};
  }
}

// Window position, remembered between launches.
const POSITION_FILE = path.join(app.getPath('userData'), 'position.json');

function savedPosition() {
  try {
    const { x, y } = JSON.parse(fs.readFileSync(POSITION_FILE, 'utf8'));
    // Ignore it if that spot is no longer on a screen (e.g. monitor unplugged).
    const area = screen.getDisplayMatching({ x, y, width: 50, height: 20 }).workArea;
    const visible = x >= area.x - 40 && y >= area.y - 10 && x < area.x + area.width - 40 && y < area.y + area.height - 20;
    return visible ? { x, y } : {};
  } catch {
    return {};
  }
}

function rememberPosition() {
  let timer = null;
  win.on('moved', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const [x, y] = win.getPosition();
      try { fs.writeFileSync(POSITION_FILE, JSON.stringify({ x, y })); } catch {}
    }, 500);
  });
}

function createWindow() {
  win = new BrowserWindow({
    ...savedPosition(),
    width: 260,
    height: 74,
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
    send('classes', { classes: CLASSES, portraits, version: app.getVersion() });
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

// One overlay at a time: launching it again just shows the running one.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => win?.showInactive());

app.whenReady().then(() => {
  portraits = loadPortraitUrls();
  createWindow();
  registerShortcuts();
  // Installed app: look for a newer release on GitHub; it downloads in the
  // background and installs when the app quits (with a Windows notification).
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.warn(`Mise à jour impossible : ${err.message}`));
  }

  let firstBatch = true;
  tailLines(
    LOG_PATH,
    (lines) => {
      let changed = false;
      for (const line of lines) changed = tracker.feed(line) || changed;
      // The cumul starts at launch, not with the old fights already in the log.
      if (firstBatch) {
        tracker.resetCumul();
        firstBatch = false;
      }
      if (changed) send('fight', view());
    },
    (s) => {
      status = s;
      send('status', s);
    }
  );
  // Optional: without it, players and classes are inferred from the chat log alone.
  tailLines(
    TECH_LOG_PATH,
    (lines) => {
      let changed = false;
      for (const line of lines) changed = tracker.feedTech(line) || changed;
      if (changed) send('fight', view());
    },
    () => {}
  );

  ipcMain.on('reset', () => {
    tracker.reset();
    send('fight', view());
  });
  ipcMain.on('reset-cumul', () => {
    tracker.resetCumul();
    send('fight', view());
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
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
