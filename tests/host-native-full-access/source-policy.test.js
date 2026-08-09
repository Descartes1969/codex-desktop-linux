const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const launcher = fs.readFileSync(path.join(root, "launcher/start.sh.template"), "utf8");
const scripts = path.join(root, "scripts/host-native-full-access");
const tests = path.join(root, "tests/host-native-full-access");

function extractFunction(name, followingText) {
  const pattern = new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}\\n\\n(?=${followingText})`);
  const match = launcher.match(pattern);
  assert.ok(match, `could not extract ${name} from launcher template`);
  return match[0];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

test("launcher sandbox mode is opt-in and fail-closed", () => {
  assert.match(launcher, /chromium_sandbox_requested\(\)/);
  assert.match(launcher, /validate_chromium_sandbox_helper\(\)/);
  assert.match(launcher, /stat -Lc '%u:%g:%a'/);
  assert.match(launcher, /metadata" != "0:0:4755"/);
  assert.match(launcher, /cmp -s -- "\$helper" "\$bundled_helper"/);
  assert.match(launcher, /if chromium_sandbox_requested; then/);
  assert.match(launcher, /reject_chromium_sandbox_disable_args \|\| exit 1/);
  assert.match(launcher, /select_electron_executable \|\| exit 1/);
  assert.match(launcher, /exec "\$ELECTRON_EXECUTABLE"/);
  assert.doesNotMatch(launcher, /exec "\$SCRIPT_DIR\/electron"/);
  assert.match(launcher, /pid_matches_executable "\$pid" "\$ELECTRON_EXECUTABLE"/);
  assert.match(launcher, /"\$expected_start_time" \\\n        "\$ELECTRON_EXECUTABLE"/);
  assert.match(launcher, /source_feature_env_files\nselect_electron_executable \|\| exit 1/);
  assert.match(launcher, /Ignoring protected Linux launcher security assignment from feature hook/);
  assert.match(launcher, /--no-sandbox/);
  assert.match(launcher, /--disable-gpu-sandbox/);
});

test("space-path facade is the executable actually invoked by the launcher", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex launch fixture "));
  const app = path.join(temp, "generated app");
  const facade = path.join(temp, "facade-no-spaces");
  const capture = path.join(temp, "invoked-path.txt");
  fs.mkdirSync(app);
  fs.mkdirSync(facade);
  const bundledElectron = path.join(app, "electron");
  const facadeElectron = path.join(facade, "electron");
  fs.writeFileSync(bundledElectron, '#!/usr/bin/env bash\nprintf "%s\\n" "$0" > "$CAPTURE_PATH"\n', { mode: 0o755 });
  fs.linkSync(bundledElectron, facadeElectron);

  const selectFunction = extractFunction("select_electron_executable", "reject_chromium_sandbox_disable_args\\(\\)");
  const launchFunction = extractFunction("launch_electron", "hydrate_graphical_session_env");
  const harness = `
set -euo pipefail
${selectFunction}
${launchFunction}
SCRIPT_DIR=${shellQuote(app)}
CODEX_ELECTRON_EXECUTABLE=${shellQuote(facadeElectron)}
CAPTURE_PATH=${shellQuote(capture)}
export CODEX_ELECTRON_EXECUTABLE CAPTURE_PATH
WARM_START=1
RUNNING_APP_PID=fixture
ELECTRON_RENDERING_MODE=default
ELECTRON_WSLG_DETECTED=0
ELECTRON_OZONE_PLATFORM=""
ELECTRON_OZONE_HINT=""
ELECTRON_GPU_ENABLED=1
ELECTRON_GPU_DISABLE_SWITCH_IN_ARGS=0
ELECTRON_GPU_COMPOSITING_DISABLED=0
ELECTRON_DEV_SHM_USAGE_DISABLED=0
ELECTRON_GL_SWITCH_ADDED=0
ELECTRON_RENDERER_ACCESSIBILITY_FORCED=0
ELECTRON_FORCED_SCALE_FACTOR=""
FEATURE_ELECTRON_ARGS=()
USER_ELECTRON_FLAGS=()
ELECTRON_LAUNCH_ARGS=()
ELECTRON_ARGS=()
log_phase() { :; }
ensure_user_electron_flags_file() { :; }
load_feature_electron_args() { FEATURE_ELECTRON_ARGS=(); }
load_user_electron_flags() { USER_ELECTRON_FLAGS=(); }
set_electron_defaults() { ELECTRON_ARGS=("$@"); }
run_feature_launcher_hooks() { :; }
build_electron_launch_args() { ELECTRON_LAUNCH_ARGS=(); }
release_launcher_lock() { :; }
launch_electron
`;
  const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(capture, "utf8").trim(), facadeElectron);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("sandbox opt-in rejects disable switches from every final-argument source", () => {
  const guard = extractFunction("reject_chromium_sandbox_disable_args", "validate_chromium_sandbox_helper\\(\\)");
  const cases = [
    ["pass-through", "--no-sandbox"],
    ["persistent user flags", "--disable-gpu-sandbox"],
    ["feature hook", "--disable-setuid-sandbox=true"],
  ];
  for (const [source, arg] of cases) {
    const harness = `${guard}\nELECTRON_LAUNCH_ARGS=()\nELECTRON_ARGS=(${shellQuote(arg)})\nreject_chromium_sandbox_disable_args`;
    const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
    assert.notEqual(result.status, 0, `${source} argument must fail closed: ${arg}`);
  }
  const allowed = spawnSync("bash", ["-c", `${guard}\nELECTRON_LAUNCH_ARGS=(--class=codex-desktop)\nELECTRON_ARGS=(--disable-gpu)\nreject_chromium_sandbox_disable_args`], { encoding: "utf8" });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test("declarative and executable feature hooks cannot replace launcher security variables", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex protected env "));
  const envDir = path.join(temp, "env.d");
  const resultFile = path.join(temp, "result.txt");
  fs.mkdirSync(envDir);
  fs.writeFileSync(path.join(envDir, "fixture.env"), [
    "CODEX_LINUX_ENABLE_CHROMIUM_SANDBOX=0",
    "CHROME_DEVEL_SANDBOX=/untrusted/helper",
    "CODEX_ELECTRON_EXECUTABLE=/untrusted/electron",
    "UNRELATED_FEATURE_VALUE=loaded",
    "",
  ].join("\n"));
  const protectedFunction = extractFunction("launcher_security_env_name", "source_feature_env_files\\(\\)");
  const sourceFunction = extractFunction("source_feature_env_files", "run_feature_prelaunch_hooks\\(\\)");
  const hookFunction = extractFunction("apply_feature_launcher_hook_env", "# Remove entries from ELECTRON_ARGS");
  const harness = `
set -euo pipefail
${protectedFunction}
${sourceFunction}
${hookFunction}
FEATURE_ENV_DIR=${shellQuote(envDir)}
CODEX_LINUX_ENABLE_CHROMIUM_SANDBOX=1
CHROME_DEVEL_SANDBOX=/trusted/helper
CODEX_ELECTRON_EXECUTABLE=/trusted/electron
source_feature_env_files
apply_feature_launcher_hook_env CODEX_LINUX_ENABLE_CHROMIUM_SANDBOX=0
apply_feature_launcher_hook_env CHROME_DEVEL_SANDBOX=/untrusted/hook-helper
apply_feature_launcher_hook_env CODEX_ELECTRON_EXECUTABLE=/untrusted/hook-electron
printf '%s\\n' "$CODEX_LINUX_ENABLE_CHROMIUM_SANDBOX" "$CHROME_DEVEL_SANDBOX" "$CODEX_ELECTRON_EXECUTABLE" "$UNRELATED_FEATURE_VALUE" > ${shellQuote(resultFile)}
`;
  const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(resultFile, "utf8").trim().split("\n"), [
    "1",
    "/trusted/helper",
    "/trusted/electron",
    "loaded",
  ]);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("all publication shell scripts pass bash syntax", () => {
  const files = [
    ...fs.readdirSync(scripts).filter((name) => name.endsWith(".sh")).map((name) => path.join(scripts, name)),
    ...fs.readdirSync(tests).filter((name) => name.endsWith(".sh")).map((name) => path.join(tests, name)),
    path.join(root, "launcher/start.sh.template"),
  ];
  for (const file of files) {
    const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test("no-space facade is conditional and preserves Electron inode", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex facade test "));
  const app = path.join(temp, "generated app");
  const facade = path.join(temp, "facade-no-spaces");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, "electron"), "electron-fixture\n", { mode: 0o755 });
  fs.writeFileSync(path.join(app, "resources.pak"), "resource-fixture\n");
  const result = spawnSync(path.join(scripts, "create-no-space-facade.sh"), ["--app-dir", app, "--facade-dir", facade], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(path.join(app, "electron")).ino, fs.statSync(path.join(facade, "electron")).ino);
  assert.equal(fs.readlinkSync(path.join(facade, "resources.pak")), path.join(app, "resources.pak"));
  fs.writeFileSync(path.join(facade, "unrelated-user-file"), "must survive\n");
  const refused = spawnSync(path.join(scripts, "create-no-space-facade.sh"), ["--app-dir", app, "--facade-dir", facade, "--remove"], { encoding: "utf8" });
  assert.notEqual(refused.status, 0, "removal must refuse a facade containing an unexpected file");
  assert.equal(fs.readFileSync(path.join(facade, "unrelated-user-file"), "utf8"), "must survive\n");
  fs.rmSync(path.join(facade, "unrelated-user-file"));
  const removed = spawnSync(path.join(scripts, "create-no-space-facade.sh"), ["--app-dir", app, "--facade-dir", facade, "--remove"], { encoding: "utf8" });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(facade), false);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("privileged helper and desktop installers refuse unrelated existing targets", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex installer refusal "));
  const app = path.join(temp, "app");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, "electron"), "electron fixture\n", { mode: 0o755 });
  fs.writeFileSync(path.join(app, "chrome-sandbox"), "matching helper fixture\n", { mode: 0o755 });
  const destination = path.join(temp, "existing-helper");
  fs.writeFileSync(destination, "unrelated helper\n", { mode: 0o755 });
  const helper = spawnSync(path.join(scripts, "install-chromium-sandbox-helper.sh"), ["--app-dir", app, "--destination", destination], { encoding: "utf8" });
  assert.notEqual(helper.status, 0, "a different helper must not be overwritten");
  assert.equal(fs.readFileSync(destination, "utf8"), "unrelated helper\n");

  const dataHome = path.join(temp, "xdg-data");
  const applications = path.join(dataHome, "applications");
  const desktopFile = path.join(applications, "codex-host-native-sandboxed.desktop");
  fs.mkdirSync(applications, { recursive: true });
  fs.writeFileSync(desktopFile, "[Desktop Entry]\nName=Unmanaged\n");
  const desktop = spawnSync(path.join(scripts, "install-user-desktop-entry.sh"), [], {
    encoding: "utf8",
    env: { ...process.env, XDG_DATA_HOME: dataHome },
  });
  assert.notEqual(desktop.status, 0, "an unmanaged desktop entry must not be overwritten");
  assert.equal(fs.readFileSync(desktopFile, "utf8"), "[Desktop Entry]\nName=Unmanaged\n");

  fs.unlinkSync(desktopFile);
  const installed = spawnSync(path.join(scripts, "install-user-desktop-entry.sh"), [], {
    encoding: "utf8",
    env: { ...process.env, XDG_DATA_HOME: dataHome },
  });
  assert.equal(installed.status, 0, installed.stderr);
  const managedBytes = fs.readFileSync(desktopFile, "utf8");
  fs.appendFileSync(desktopFile, "# user modification that retains the marker\n");
  const modifiedBytes = fs.readFileSync(desktopFile, "utf8");
  const replaceModified = spawnSync(path.join(scripts, "install-user-desktop-entry.sh"), [], {
    encoding: "utf8",
    env: { ...process.env, XDG_DATA_HOME: dataHome },
  });
  assert.notEqual(replaceModified.status, 0, "a marked but modified desktop entry must not be overwritten");
  assert.equal(fs.readFileSync(desktopFile, "utf8"), modifiedBytes);
  const removeModified = spawnSync(path.join(scripts, "install-user-desktop-entry.sh"), ["--remove"], {
    encoding: "utf8",
    env: { ...process.env, XDG_DATA_HOME: dataHome },
  });
  assert.notEqual(removeModified.status, 0, "a marked but modified desktop entry must not be deleted");
  assert.equal(fs.readFileSync(desktopFile, "utf8"), modifiedBytes);
  fs.writeFileSync(desktopFile, managedBytes);
  const removeManaged = spawnSync(path.join(scripts, "install-user-desktop-entry.sh"), ["--remove"], {
    encoding: "utf8",
    env: { ...process.env, XDG_DATA_HOME: dataHome },
  });
  assert.equal(removeManaged.status, 0, removeManaged.stderr);
  assert.equal(fs.existsSync(desktopFile), false);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("publication files contain no private-project markers or payloads", () => {
  const roots = [
    path.join(root, "docs/host-native-full-access-article.md"),
    path.join(root, "docs/host-native-full-access-guide.md"),
    scripts,
    tests,
  ];
  const files = [];
  for (const item of roots) {
    if (!fs.existsSync(item)) continue;
    const stat = fs.statSync(item);
    if (stat.isFile()) files.push(item);
    else for (const name of fs.readdirSync(item)) files.push(path.join(item, name));
  }
  const forbiddenContent = [
    new RegExp("/" + "home/"),
    new RegExp("ADVISORY-" + "TANGENT_"),
    new RegExp("v1-" + "sovereign", "i"),
    new RegExp("gho" + "_[A-Za-z0-9]"),
  ];
  for (const file of files.filter((file) => fs.statSync(file).isFile())) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of forbiddenContent) assert.doesNotMatch(content, pattern, `${file}: ${pattern}`);
    assert.doesNotMatch(path.basename(file), /(?:app\.asar|\.dmg)$/i, `forbidden payload file: ${file}`);
  }
});
