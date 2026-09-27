// Entry point of the standalone package (scripts/package-standalone.js), run by
// the bundled node from the launcher next to it.
const { mkdirSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

// Not next to the program: on Windows that is Program Files, which isn't
// writable, and an event file should be somewhere a marshal can find and copy.
if (!process.env.DB_PATH) {
  const dir = join(homedir(), 'Documents', 'Rally Gate');
  mkdirSync(dir, { recursive: true });
  process.env.DB_PATH = join(dir, 'rally-gate.sqlite');
}
process.env.OPEN_BROWSER ??= '1';
process.env.LOG_LEVEL ??= 'warn';
console.log(`Event file: ${process.env.DB_PATH}`);

require('./rally-server/dist/main.js');
