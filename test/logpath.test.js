'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findWakfuFiles } = require('../src/logpath');

function file(root, rel, ageSeconds) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');
  const t = Date.now() / 1000 - ageSeconds;
  fs.utimesSync(p, t, t);
  return p;
}

test('finds the most recently written chat log among Wakfu installs', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-appdata-'));
  const steam = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-steam-'));
  try {
    file(appData, 'zaap/gamesLogs/wakfu/logs/wakfu_chat.log', 3600); // old launcher, no longer used
    const steamLog = file(steam, 'Wakfu/preferences/logs/wakfu_chat.log', 10);
    file(appData, 'SomeOtherApp/logs/wakfu_chat.log', 0); // not an Ankama / Wakfu folder
    const jar = file(steam, 'Wakfu/contents/gui_jar/gui.jar', 100);
    file(steam, 'Wakfu/contents/other/gui.jar', 0); // not in gui_jar

    assert.deepStrictEqual(await findWakfuFiles([appData, steam]), { chatLog: steamLog, guiJar: jar });

    // The new Ankama launcher (beta), in %LOCALAPPDATA%.
    const launcher2 = file(appData, 'Ankama Launcher 2/logs/wakfu_chat.log', 1);
    assert.strictEqual((await findWakfuFiles([appData, steam])).chatLog, launcher2);
    assert.deepStrictEqual(await findWakfuFiles([path.join(appData, 'missing')]), { chatLog: null, guiJar: null });
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
    fs.rmSync(steam, { recursive: true, force: true });
  }
});
