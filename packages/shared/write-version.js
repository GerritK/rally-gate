// Stamps the build's version into dist/version.js, replacing tsc's output of
// src/version.ts. Docker builds have no .git, so RALLY_GATE_VERSION wins.
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

function fromGit() {
  try {
    return execFileSync('git', ['describe', '--tags', '--always', '--dirty'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

const version = process.env.RALLY_GATE_VERSION || fromGit();
writeFileSync(
  join(__dirname, 'dist', 'version.js'),
  `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.VERSION = ${JSON.stringify(version)};\n`,
);
console.log(`[shared] version ${version}`);
