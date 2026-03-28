#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist', 'server', 'bundle.cjs');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const PACKAGE_NAME = 'iranti-control-plane';

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp() {
  console.log(`iranti-cp v${readPackageVersion()}

Usage:
  iranti-cp
  iranti-cp open [--port <n>]
  iranti-cp start [--port <n>]
  iranti-cp stop [--port <n>]
  iranti-cp status [--port <n>] [--json]
  iranti-cp uninstall
  iranti-cp version
  iranti-cp doctor [iranti doctor args...]
  iranti-cp upgrade [self]
  iranti-cp upgrade iranti [iranti upgrade args...]

Commands:
  open      Open an existing Control Plane if one is running, otherwise start it in the background.
  start     Start the Control Plane in the foreground without auto-opening the browser.
  stop      Stop one or more running local Control Plane servers.
  status    Show the installed Control Plane version and any running local Control Plane servers.
  uninstall Stop running Control Plane servers, then remove the global npm package.
  version   Print the installed iranti-control-plane version.
  doctor    Proxy to "iranti doctor".
  upgrade   Upgrade iranti-control-plane itself, or proxy to "iranti upgrade" for core Iranti.

Options:
  --port <n>  Prefer a specific Control Plane port for open/start/status.
  --json      Emit machine-readable output for status.
  -h, --help  Show this help.
`);
}

function parseArgs(argv) {
  const positionals = [];
  let port = null;
  let json = false;
  let help = false;
  let seenCommand = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--help' || arg === '-h') && !seenCommand) {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--port') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--port requires a value');
      }
      port = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length);
      continue;
    }
    positionals.push(arg);
    seenCommand = true;
  }

  return { help, port, json, positionals };
}

function preferredPorts(explicitPort) {
  const seen = new Set();
  const ordered = [];
  const add = (value) => {
    if (!value) return;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (seen.has(parsed)) return;
    seen.add(parsed);
    ordered.push(parsed);
  };

  add(explicitPort);
  add(process.env.CONTROL_PLANE_PORT);
  for (let port = 3000; port <= 3010; port += 1) add(port);
  add(3002);
  return ordered;
}

async function fetchJson(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function findRunningControlPlanes(explicitPort) {
  const checks = preferredPorts(explicitPort).map(async (port) => {
    try {
      const health = await fetchJson(`http://127.0.0.1:${port}/api/control-plane/health`, 2500);
      let instances = null;
      try {
        const body = await fetchJson(`http://127.0.0.1:${port}/api/control-plane/instances`, 1500);
        instances = Array.isArray(body) ? body.length : null;
      } catch {
        instances = null;
      }
      return {
        port,
        url: `http://localhost:${port}/control-plane`,
        version: typeof health.version === 'string' ? health.version : null,
        instances,
      };
    } catch {
      return null;
    }
  });

  const resolved = await Promise.all(checks);
  return resolved.filter(Boolean);
}

function readLines(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return [];
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findPidsForPort(port) {
  const portText = String(port);

  if (process.platform === 'win32') {
    const lines = readLines('netstat', ['-ano', '-p', 'tcp']);
    const pids = new Set();
    for (const line of lines) {
      if (!/\bLISTENING\b/i.test(line)) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;
      const localAddress = parts[1];
      const state = parts[3];
      const pid = Number.parseInt(parts[4], 10);
      if (!Number.isFinite(pid) || !/\bLISTENING\b/i.test(state)) continue;
      if (localAddress.endsWith(`:${portText}`)) pids.add(pid);
    }
    return [...pids];
  }

  const lsofPids = readLines('lsof', ['-ti', `tcp:${portText}`])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  if (lsofPids.length > 0) return [...new Set(lsofPids)];

  const ssLines = readLines('ss', ['-ltnp']);
  const pids = new Set();
  for (const line of ssLines) {
    if (!line.includes(`:${portText}`)) continue;
    const pidMatch = line.match(/pid=(\d+)/);
    if (!pidMatch) continue;
    const pid = Number.parseInt(pidMatch[1], 10);
    if (Number.isFinite(pid)) pids.add(pid);
  }
  return [...pids];
}

function openUrl(url) {
  if (process.platform === 'win32') {
    return spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
  }
  if (process.platform === 'darwin') {
    return spawn('open', [url], { detached: true, stdio: 'ignore' });
  }
  return spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
}

function spawnControlPlane({ port, openBrowser, detached }) {
  const env = { ...process.env };
  if (port) env.CONTROL_PLANE_PORT = String(port);
  if (!openBrowser) env.IRANTI_CP_NO_OPEN = '1';

  const child = spawn(process.execPath, [BUNDLE], {
    env,
    stdio: detached ? 'ignore' : 'inherit',
    detached: Boolean(detached),
    windowsHide: true,
  });

  if (detached) child.unref();
  return child;
}

async function terminatePid(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`invalid pid "${pid}"`);
  }

  if (process.platform === 'win32') {
    const code = await runChild('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    if (code !== 0) {
      throw new Error(`taskkill exited with status ${code}`);
    }
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error && error.code === 'ESRCH') return;
    throw error;
  }

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if (error && error.code === 'ESRCH') return;
      throw error;
    }
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error && error.code === 'ESRCH') return;
    throw error;
  }
}

function resolveIrantiCommand() {
  const explicit = process.env.IRANTI_CLI_PATH || process.env.IRANTI_CP_IRANTI_CLI;
  if (explicit && explicit.trim()) {
    return normalizeExecutable(explicit.trim());
  }

  const locator = process.platform === 'win32' ? 'where' : 'which';
  const located = spawnSync(locator, ['iranti'], { encoding: 'utf8', windowsHide: true });
  if (located.status === 0) {
    const first = String(located.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) return normalizeExecutable(first);
  }

  const repoLocal = [
    path.resolve(process.cwd(), '..', 'iranti', 'bin', 'iranti.js'),
    path.resolve(process.cwd(), '..', '..', 'iranti', 'bin', 'iranti.js'),
    path.resolve(process.cwd(), 'node_modules', 'iranti', 'bin', 'iranti.js'),
  ].find((candidate) => fs.existsSync(candidate));
  if (repoLocal) return { command: process.execPath, args: [repoLocal] };
  return null;
}

function normalizeExecutable(candidate) {
  let normalized = path.resolve(candidate);
  let lower = normalized.toLowerCase();

  if (process.platform === 'win32' && !path.extname(lower)) {
    for (const suffix of ['.cmd', '.exe', '.bat', '.ps1']) {
      const sibling = `${normalized}${suffix}`;
      if (fs.existsSync(sibling)) {
        normalized = sibling;
        lower = normalized.toLowerCase();
        break;
      }
    }
  }

  if (lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) {
    return { command: process.execPath, args: [normalized] };
  }
  if (process.platform === 'win32' && lower.endsWith('.cmd')) {
    const cliEntry = path.join(path.dirname(normalized), 'node_modules', 'iranti', 'bin', 'iranti.js');
    if (fs.existsSync(cliEntry)) {
      return { command: process.execPath, args: [cliEntry] };
    }
  }
  return { command: normalized, args: [] };
}

function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

async function runIrantiProxy(args) {
  const resolved = resolveIrantiCommand();
  if (!resolved) {
    console.error('iranti-cp: could not resolve the core iranti CLI from PATH or IRANTI_CLI_PATH.');
    return 1;
  }
  return runChild(resolved.command, [...resolved.args, ...args]);
}

async function handleStatus(port, asJson) {
  const running = await findRunningControlPlanes(port);
  const payload = {
    package: 'iranti-control-plane',
    version: readPackageVersion(),
    running,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  console.log(`iranti-control-plane v${payload.version}`);
  if (running.length === 0) {
    console.log('No local Control Plane server detected on the default port range.');
    return 0;
  }

  console.log(`Detected ${running.length} running Control Plane server${running.length === 1 ? '' : 's'}:`);
  for (const server of running) {
    const instanceText = server.instances === null ? 'instances unavailable' : `${server.instances} instance${server.instances === 1 ? '' : 's'}`;
    console.log(`- ${server.url} (server v${server.version ?? 'unknown'}, ${instanceText})`);
  }
  return 0;
}

async function handleOpen(port) {
  const running = await findRunningControlPlanes(port);
  if (running.length > 0) {
    openUrl(running[0].url);
    console.log(`Opened existing Control Plane at ${running[0].url}`);
    return 0;
  }

  spawnControlPlane({ port, openBrowser: true, detached: true });
  console.log('Started Control Plane in the background and asked it to open the browser.');
  return 0;
}

async function handleStart(port) {
  const running = await findRunningControlPlanes(port);
  if (running.length > 0) {
    console.log(`Control Plane is already running at ${running[0].url}`);
    return 0;
  }

  const child = spawnControlPlane({ port, openBrowser: false, detached: false });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

async function handleStop(port) {
  const running = await findRunningControlPlanes(port);
  if (running.length === 0) {
    console.log(port
      ? `No local Control Plane server detected on port ${port}.`
      : 'No local Control Plane server is running.');
    return 0;
  }

  let failures = 0;
  for (const server of running) {
    const pids = findPidsForPort(server.port);
    if (pids.length === 0) {
      console.error(`Could not resolve a process ID for Control Plane on port ${server.port}.`);
      failures += 1;
      continue;
    }

    let stopped = false;
    for (const pid of pids) {
      try {
        await terminatePid(pid);
        console.log(`Stopped Control Plane on port ${server.port} (PID ${pid}).`);
        stopped = true;
      } catch (error) {
        console.error(`Failed to stop Control Plane on port ${server.port} (PID ${pid}): ${error.message}`);
      }
    }

    if (!stopped) failures += 1;
  }

  return failures === 0 ? 0 : 1;
}

function launchDetachedUninstall() {
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/d', '/s', '/c', `ping 127.0.0.1 -n 2 >nul && npm.cmd uninstall -g ${PACKAGE_NAME}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  const child = spawn('sh', ['-lc', `sleep 1 && npm uninstall -g ${PACKAGE_NAME}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function handleUninstall() {
  const stopCode = await handleStop(null);
  if (stopCode !== 0) {
    console.error('Continuing with uninstall even though one or more Control Plane processes could not be stopped cleanly.');
  }

  launchDetachedUninstall();
  console.log(`Started global uninstall for ${PACKAGE_NAME}.`);
  console.log('If your shell still sees the old command for a moment, open a new terminal after uninstall finishes.');
  return 0;
}

async function handleUpgrade(target, trailingArgs) {
  if (!target || target === 'self') {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return runChild(npmCommand, ['install', '-g', `${PACKAGE_NAME}@latest`]);
  }

  if (target === 'iranti') {
    return runIrantiProxy(['upgrade', ...trailingArgs]);
  }

  console.error(`iranti-cp: unknown upgrade target "${target}". Use "self" or "iranti".`);
  return 1;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`iranti-cp: ${error.message}`);
    printHelp();
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  const [command = 'open', ...rest] = parsed.positionals;

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(readPackageVersion());
    return;
  }

  if (command === 'help') {
    printHelp();
    return;
  }

  let exitCode = 0;
  if (command === 'open') {
    exitCode = await handleOpen(parsed.port);
  } else if (command === 'start') {
    exitCode = await handleStart(parsed.port);
  } else if (command === 'stop') {
    exitCode = await handleStop(parsed.port);
  } else if (command === 'status') {
    exitCode = await handleStatus(parsed.port, parsed.json);
  } else if (command === 'uninstall') {
    exitCode = await handleUninstall();
  } else if (command === 'doctor') {
    exitCode = await runIrantiProxy(['doctor', ...rest]);
  } else if (command === 'upgrade') {
    exitCode = await handleUpgrade(rest[0] || 'self', rest.slice(1));
  } else {
    console.error(`iranti-cp: unknown command "${command}".`);
    printHelp();
    exitCode = 1;
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`iranti-cp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
