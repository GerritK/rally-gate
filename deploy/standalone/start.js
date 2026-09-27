// Entry point of the standalone package (scripts/package-standalone.js), run by
// the bundled node from the launcher next to it. Runs rally-server as a child
// and starts it again when it exits to switch events.
const { fork } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

// Keep in step with RESTART_EXIT_CODE in rally-server's event-files.ts.
const RESTART_EXIT_CODE = 75;

// Not next to the program: on Windows that is Program Files, which isn't
// writable, and event files should be somewhere a marshal can find and copy.
// An explicit DB_PATH pins one file and turns switching off.
if (!process.env.DB_PATH) {
  process.env.EVENTS_DIR ??= join(homedir(), 'Documents', 'Rally Gate');
  mkdirSync(process.env.EVENTS_DIR, { recursive: true });
}
process.env.OPEN_BROWSER ??= '1';
process.env.LOG_LEVEL ??= 'warn';

let server;
function start(env) {
  server = fork(join(__dirname, 'rally-server/dist/main.js'), { env });
  server.on('exit', (code, signal) => {
    if (code === RESTART_EXIT_CODE) {
      // The open dashboard reloads itself; no second browser tab.
      start({ ...process.env, OPEN_BROWSER: '0' });
    } else {
      process.exit(code ?? (signal ? 1 : 0));
    }
  });
}
start(process.env);

// Ctrl+C in the console reaches the server as well; exit after it, with its code.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => server.kill('SIGTERM'));
