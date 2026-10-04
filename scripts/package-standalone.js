// Packages rally-server + the built dashboard + the node binary running this
// script into dist-standalone/, for the OS/arch it runs on (no cross-builds:
// better-sqlite3 is native). Needs `npm run build:shared` and the server and
// web builds first. See docs/deployment-modes.md.
const { chmodSync, cpSync, existsSync, rmSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = join(__dirname, '..');
const { version } = require(join(root, 'package.json'));
const windows = process.platform === 'win32';
const platform =
  { win32: 'windows', darwin: 'macos' }[process.platform] ?? process.platform;
const name = `rally-gate-${version}-${platform}-${process.arch}`;
const outDir = join(root, 'dist-standalone');
const pkg = join(outDir, name);
const app = join(pkg, 'app');

async function main() {
  for (const dir of [
    'packages/shared/dist',
    'apps/rally-server/dist',
    'apps/web/dist',
  ]) {
    if (!existsSync(join(root, dir))) {
      throw new Error(`${dir} is missing — build it first`);
    }
  }
  rmSync(pkg, { recursive: true, force: true });

  // One file instead of ~17k in node_modules. Bundles the tsc output, not the
  // TS source, so Nest's decorator metadata is already emitted.
  const { build } = await import('rolldown');
  await build({
    input: join(root, 'apps/rally-server/dist/main.js'),
    platform: 'node',
    external: ['better-sqlite3'],
    // Nest and TypeORM require their optional packages (microservices,
    // other DB drivers) inside try/catch; left unresolved they stay plain
    // requires that are never reached.
    onLog(level, log, handler) {
      if (log.code !== 'UNRESOLVED_IMPORT') handler(level, log);
    },
    output: {
      format: 'cjs',
      // main.ts finds the dashboard at ../../web/dist, as in the repo.
      file: join(app, 'rally-server/dist/main.js'),
      // TypeORM names tables after entity classes; a bundler renaming one to
      // dodge a collision would silently point it at a new, empty table.
      // Never minify for the same reason.
      keepNames: true,
    },
  });

  // Only the runtime part of better-sqlite3: where npm compiled it from
  // source, the package also holds ~60MB of sources and objects.
  const sqlite = dirname(
    require.resolve('better-sqlite3/package.json', {
      paths: [join(root, 'apps/rally-server')],
    }),
  );
  const target = join(app, 'node_modules/better-sqlite3');
  for (const file of [
    'package.json',
    'lib',
    'build/Release/better_sqlite3.node',
  ]) {
    cpSync(join(sqlite, file), join(target, file), { recursive: true });
  }
  for (const dep of ['bindings', 'file-uri-to-path']) {
    const dir = dirname(
      require.resolve(`${dep}/package.json`, { paths: [sqlite] }),
    );
    cpSync(dir, join(app, 'node_modules', dep), { recursive: true });
  }

  cpSync(join(root, 'apps/web/dist'), join(app, 'web/dist'), {
    recursive: true,
  });
  cpSync(join(root, 'deploy/standalone/start.js'), join(app, 'start.js'));

  cpSync(process.execPath, join(pkg, windows ? 'node.exe' : 'node'));
  cpSync(join(root, 'LICENSE'), join(pkg, 'LICENSE'));
  cpSync(
    join(root, 'THIRD_PARTY_NOTICES.md'),
    join(pkg, 'THIRD_PARTY_NOTICES.md'),
  );

  if (windows) {
    cpSync(
      join(root, 'deploy/standalone/Rally Gate.cmd'),
      join(pkg, 'Rally Gate.cmd'),
    );
  } else {
    const launcher = join(
      pkg,
      platform === 'macos' ? 'Rally Gate.command' : 'rally-gate.sh',
    );
    cpSync(join(root, 'deploy/standalone/start.sh'), launcher);
    chmodSync(launcher, 0o755);
  }
  // ditto keeps the exec bits a Finder double-click needs; Windows' own tar
  // (not Git's) writes zip with -a.
  if (platform === 'macos') {
    execFileSync('ditto', ['-c', '-k', '--keepParent', pkg, `${pkg}.zip`]);
  } else if (windows) {
    execFileSync(join(process.env.SystemRoot, 'System32', 'tar.exe'), [
      '-a',
      '-cf',
      `${pkg}.zip`,
      '-C',
      outDir,
      name,
    ]);
  } else {
    execFileSync('tar', ['-czf', `${pkg}.tar.gz`, '-C', outDir, name]);
  }
  console.log(`Packaged ${pkg}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
