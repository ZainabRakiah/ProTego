#!/usr/bin/env node
/**
 * `npm run dev` entry point.
 *
 * Brings up the whole app with one command, and self-heals a fresh clone:
 *   1. creates ProTego_venv and installs requirements.txt if they're missing
 *   2. installs web/node_modules if missing
 *   3. starts Flask (API, port 5001) and Vite (UI, port 5173) together
 *
 * Ctrl+C stops both.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const VENV = path.join(ROOT, "ProTego_venv");
const isWin = process.platform === "win32";

const venvPython = isWin
  ? path.join(VENV, "Scripts", "python.exe")
  : path.join(VENV, "bin", "python");

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  violet: (s) => `\x1b[38;5;141m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function log(msg) {
  console.log(`${C.violet("protego")} ${msg}`);
}

function die(msg) {
  console.error(`${C.red("protego")} ${msg}`);
  process.exit(1);
}

/** Run a command to completion, streaming its output. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: isWin, ...opts });
  return res.status === 0;
}

/** First python on PATH that actually answers. */
function findSystemPython() {
  for (const candidate of isWin ? ["py", "python"] : ["python3", "python"]) {
    const res = spawnSync(candidate, ["--version"], { stdio: "ignore", shell: isWin });
    if (res.status === 0) return candidate;
  }
  return null;
}

// --------------------------------------------------------- stop stray servers
/**
 * Free a TCP port before binding it.
 *
 * Windows lets a second socket bind a port another process already holds, so a
 * leftover server keeps answering while the new one looks like it started fine.
 * This also has to run *before* touching the venv: a live python.exe holds its
 * files open, and Windows refuses to delete those.
 */
function freePort(port) {
  if (isWin) {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |` +
          " Select-Object -ExpandProperty OwningProcess -Unique |" +
          " ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: "ignore" },
    );
  } else {
    spawnSync("sh", ["-c", `lsof -ti tcp:${port} | xargs -r kill -9`], { stdio: "ignore" });
  }
}

/** Kill any python still running this project's server, whatever port it took. */
function stopStrayServers() {
  for (const port of [5001, 5173]) freePort(port);
  if (isWin) {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" |" +
          " Where-Object { $_.CommandLine -like '*backend/app.py*' -or $_.CommandLine -like '*backend\\app.py*' } |" +
          " ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: "ignore" },
    );
  }
}

stopStrayServers();

// ---------------------------------------------------------------- python env
const REQUIRED_IMPORTS = "import flask, flask_cors, sklearn, pandas";

/** Can the interpreter itself start? */
function venvRuns() {
  if (!existsSync(venvPython) || !existsSync(path.join(VENV, "pyvenv.cfg"))) return false;
  return spawnSync(venvPython, ["--version"], { stdio: "ignore" }).status === 0;
}

/** Are the packages the server needs actually importable? */
function venvHasDeps() {
  return spawnSync(venvPython, ["-c", REQUIRED_IMPORTS], { stdio: "ignore" }).status === 0;
}

function installRequirements(force) {
  const args = ["-m", "pip", "install", "--disable-pip-version-check"];
  if (force) args.push("--force-reinstall", "--no-cache-dir");
  args.push("-r", "requirements.txt");
  return run(venvPython, args, { cwd: ROOT });
}

function createVenv() {
  const sysPython = findSystemPython();
  if (!sysPython) {
    die("Python 3 was not found on your PATH. Install it from https://python.org and retry.");
  }
  log(C.dim("Creating ProTego_venv…"));
  if (!run(sysPython, ["-m", "venv", "ProTego_venv"], { cwd: ROOT })) {
    die("Could not create the virtual environment.");
  }
  log(C.dim("Installing Python dependencies (this takes a minute)…"));
  run(venvPython, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"], { cwd: ROOT });
  if (!installRequirements(false)) die("Installing requirements.txt failed.");
}

if (!venvRuns()) {
  /*
   * Only a venv whose interpreter cannot start is worth deleting, and even then
   * carefully: an earlier version of this script deleted on any problem and
   * without catching errors, so a single locked file left a half-erased venv
   * and a stack trace. Repair is always tried first below.
   */
  if (existsSync(VENV)) {
    log(C.yellow("The virtual environment is broken — rebuilding it."));
    try {
      rmSync(VENV, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      die(
        [
          `Could not remove ${VENV}`,
          `  ${err.code ?? err.message}. Something still has files open in it.`,
          '  Close any terminal or editor using it, then run npm run dev again.',
          '  If it persists, delete the ProTego_venv folder by hand and retry.',
        ].join('\n'),
      );
    }
  }
  createVenv();
} else if (!venvHasDeps()) {
  // The interpreter works, so never delete: reinstalling over the top repairs
  // packages that are missing or half-written, without risking the EPERM above.
  log(C.yellow("Python packages are missing or damaged — reinstalling them."));
  if (!installRequirements(true)) {
    die("Could not repair the Python environment. Delete ProTego_venv and run npm run dev again.");
  }
}

if (!venvHasDeps()) {
  die("The Python environment is still incomplete after repair. Check the pip output above.");
}
log(C.green("Python environment ready."));

// ------------------------------------------------------------- node packages
if (!existsSync(path.join(WEB, "node_modules"))) {
  log(C.dim("First run: installing web dependencies…"));
  if (!run("npm", ["install"], { cwd: WEB })) {
    die("npm install failed inside web/.");
  }
  log(C.green("Web dependencies ready."));
}

// -------------------------------------------------------------------- launch
const children = [];
let shuttingDown = false;

function start(name, color, cmd, args, cwd, env) {
  const child = spawn(cmd, args, {
    cwd,
    shell: isWin,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tag = color(`[${name}]`);
  const pipe = (stream, sink) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) sink.write(`${tag} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stdout);

  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.log(`${tag} ${C.yellow(`exited with code ${code}`)}`);
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) {
      // On Windows a plain kill leaves the grandchild (python/node) running.
      if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    }
  }
  // taskkill /T misses grandchildren that re-parented, so sweep the ports too.
  for (const port of [5001, 5173]) freePort(port);
  process.exit(code);
}

async function waitForApi(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Keep retrying until the Flask API is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API at ${url} did not become ready within ${timeoutMs}ms.`);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log();
log(C.bold("Starting ProTego"));
log(`${C.dim("API")}  http://127.0.0.1:5001`);
log(`${C.dim("App")}  ${C.bold("http://localhost:5173")} ${C.dim("(opens automatically)")}`);
console.log();

start("api", C.green, venvPython, ["backend/app.py"], ROOT, {
  NO_BROWSER: "1", // dev.mjs lets Vite own the browser tab
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
  PYTHONUNBUFFERED: "1",
});

await waitForApi("http://127.0.0.1:5001/api/health").catch((err) => {
  console.error(`${C.red("protego")} ${err.message}`);
  shutdown(1);
});

start("web", C.violet, "npm", ["run", "dev"], WEB, {});
