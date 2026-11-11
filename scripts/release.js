'use strict';

// Publishes the current version on GitHub Releases.
// The release is created first: otherwise electron-builder's parallel uploads
// race to create it and one of them fails (HTTP 422), leaving latest.yml out,
// which the installed apps need to see the update.

const { execSync } = require('child_process');
const { version, build } = require('../package.json');

const { owner, repo } = build.publish;
const token = process.env.GH_TOKEN;
if (!token) {
  console.error('GH_TOKEN manquant : définis la variable avec ton jeton GitHub.');
  process.exit(1);
}

async function createRelease() {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wakfu-meter-release',
    },
    body: JSON.stringify({ tag_name: `v${version}`, name: version }),
  });
  if (res.status === 201) console.log(`Release v${version} créée.`);
  else if (res.status === 422) console.log(`Release v${version} déjà existante, envoi des fichiers.`);
  else throw new Error(`GitHub a répondu ${res.status} : ${await res.text()}`);
}

createRelease()
  .then(() => execSync('npx electron-builder --win --publish always', { stdio: 'inherit' }))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
