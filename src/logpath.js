'use strict';

// Finds Wakfu's files on this PC. Where they are depends on how the game was
// installed (Ankama launcher and its newer versions, Steam...), so instead of
// fixed paths the likely folders are searched, and the most recently written
// file wins: it belongs to the install actually played.
//   Ankama launcher:   %APPDATA%\zaap\gamesLogs\wakfu\logs\wakfu_chat.log
//   Ankama launcher 2: %LOCALAPPDATA%\Ankama Launcher 2\logs\
//   Steam:             <library>\steamapps\common\Wakfu\preferences\logs\wakfu_chat.log

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const HINT = /ankama|zaap|wakfu/i; // folders worth searching, at the top of each root
const MAX_DEPTH = 6;

async function walk(dir, depth, found) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && (depth > 0 || HINT.test(e.name))) await walk(p, depth + 1, found);
        return;
      }
      const name = e.name.toLowerCase();
      const key = name === 'wakfu_chat.log' ? 'chatLog' : name === 'gui.jar' && path.basename(dir) === 'gui_jar' ? 'guiJar' : null;
      if (!key) return;
      try {
        const { mtimeMs } = await fs.promises.stat(p);
        if (!found[key] || mtimeMs > found[key].mtimeMs) found[key] = { path: p, mtimeMs };
      } catch {}
    })
  );
}

// Searches the Ankama / Zaap / Wakfu folders directly under each root.
// Returns { chatLog, guiJar }: the newest of each, or null.
async function findWakfuFiles(roots) {
  const found = {};
  await Promise.all(roots.map((root) => walk(root, 0, found)));
  return { chatLog: found.chatLog?.path || null, guiJar: found.guiJar?.path || null };
}

// "steamapps\common" of every Steam library (they can be on other drives).
function steamLibraries() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
      const m = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
      if (!m) return resolve([]);
      const steam = path.normalize(m[1].trim());
      const libs = [steam];
      try {
        const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const [, p] of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(path.normalize(p.replace(/\\\\/g, '\\')));
      } catch {}
      const common = libs.map((l) => path.join(l, 'steamapps', 'common'));
      resolve([...new Map(common.map((c) => [c.toLowerCase(), c])).values()]);
    });
  });
}

async function searchRoots(env = process.env) {
  const bases = [env.APPDATA, env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  return [...bases, ...(await steamLibraries())];
}

module.exports = { findWakfuFiles, searchRoots };
