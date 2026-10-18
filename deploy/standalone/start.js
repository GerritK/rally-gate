// Entry point of the standalone package (scripts/package-standalone.js): on
// Windows built into "Rally Gate.exe" as a Node single executable, elsewhere run
// by the bundled node from the launcher script. Runs rally-server as a child
// and starts it again when it exits to switch events.
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { createRequire } = require('node:module');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { isSea } = require('node:sea');

// Keep in step with RESTART_EXIT_CODE in rally-server's event-files.ts.
const RESTART_EXIT_CODE = 75;

// Inside the exe, __dirname is the exe's folder, and the exe ignores a script
// argument: it always runs this file, so the child is told by env to be the server.
const serverMain = join(
  isSea() ? join(__dirname, 'app') : __dirname,
  'rally-server/dist/main.js',
);
if (process.env.RALLY_GATE_SERVER) {
  // The exe's own require only knows builtins.
  createRequire(process.execPath)(serverMain);
} else {
  supervise();
}

// The logo's orange and cyan, where the console can show them.
function printBanner() {
  const rgb = (r, g, b) =>
    process.stdout.hasColors?.(2 ** 24)
      ? (s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`
      : (s) => s;
  const orange = rgb(255, 107, 0);
  const cyan = rgb(0, 211, 242);
  const rally = [
    '██████╗  █████╗ ██╗     ██╗     ██╗   ██╗',
    '██╔══██╗██╔══██╗██║     ██║     ╚██╗ ██╔╝',
    '██████╔╝███████║██║     ██║      ╚████╔╝ ',
    '██╔══██╗██╔══██║██║     ██║       ╚██╔╝  ',
    '██║  ██║██║  ██║███████╗███████╗   ██║   ',
    '╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ',
  ];
  const gate = [
    ' ██████╗  █████╗ ████████╗███████╗',
    '██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝',
    '██║  ███╗███████║   ██║   █████╗',
    '██║   ██║██╔══██║   ██║   ██╔══╝',
    '╚██████╔╝██║  ██║   ██║   ███████╗',
    ' ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝',
  ];
  console.log();
  rally.forEach((row, i) => console.log(`${orange(row)}  ${cyan(gate[i])}`));
  console.log(
    '\nTiming for RC rallies. Close this window to stop the server.\n',
  );
}

function supervise() {
  process.title = 'Rally Gate - close this window to stop the server';
  printBanner();
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
  const start = (env) => {
    server = spawn(process.execPath, isSea() ? [] : [serverMain], {
      env: { ...env, RALLY_GATE_SERVER: '1' },
      stdio: 'inherit',
    });
    server.on('exit', (code, signal) => {
      if (code === RESTART_EXIT_CODE) {
        // The open dashboard reloads itself; no second browser tab.
        start({ ...process.env, OPEN_BROWSER: '0' });
      } else if (code && process.stdin.isTTY) {
        // A double-clicked console would vanish with a startup error (port in use, ...).
        console.error(
          '\nRally Gate stopped with an error. Press Enter to close.',
        );
        process.stdin.once('data', () => process.exit(code));
      } else {
        process.exit(code ?? (signal ? 1 : 0));
      }
    });
  };
  start(process.env);

  // Ctrl+C in the console reaches the server as well; exit after it, with its code.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => server.kill('SIGTERM'));
}
