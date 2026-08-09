const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const launcher = fs.readFileSync(path.join(root, "launcher/start.sh.template"), "utf8");
const featureDir = path.join(root, "linux-features/chromium-sandbox");
const scripts = path.join(root, "scripts/host-native-full-access");
const tests = path.join(root, "tests/host-native-full-access");

test("portable Chromium policy is disabled by default and feature-owned", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(featureDir, "feature.json"), "utf8"));
  assert.equal(manifest.id, "chromium-sandbox");
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.runtimeHooks.launcher.name, "chromium-sandbox.sh");

  assert.doesNotMatch(launcher, /CHROME_DEVEL_SANDBOX|chrome-sandbox|chromium.sandbox/i);
  const hook = fs.readFileSync(path.join(featureDir, "launcher-hook.sh"), "utf8");
  assert.match(hook, /CODEX_LINUX_RESIDENT_PROCESS_ACTIVE/);
  assert.match(hook, /launch-error Chromium sandbox:/);
  assert.match(hook, /electron-default-arg-remove --no-sandbox/);
  assert.match(hook, /electron-arg-deny --disable-\*-sandbox/);
  assert.match(hook, /generated-chrome-sandbox/);
});

test("generic launch preparation precedes both resident handoff paths", () => {
  const prepare = launcher.lastIndexOf('prepare_electron_launch "${LAUNCHER_ARGS[@]}"');
  const ipc = launcher.lastIndexOf('if send_warm_start_launch_action "${LAUNCHER_ARGS[@]}"; then');
  const secondInstance = launcher.indexOf('using_second_instance_handoff', launcher.indexOf("launch_electron()"));
  assert.ok(prepare > 0, "missing pre-handoff launch preparation");
  assert.ok(ipc > prepare, "warm-start IPC must follow launch preparation");
  assert.ok(secondInstance > 0, "missing Electron second-instance path");
});

test("feature's complete unit suite passes", () => {
  const result = spawnSync(process.execPath, ["--test", path.join(featureDir, "test.js")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("corrected wrapper selects only the staged feature and external helper", () => {
  const wrapperPath = path.join(scripts, "launch-host-native-sandboxed.sh");
  const wrapper = fs.readFileSync(wrapperPath, "utf8");
  assert.match(wrapper, /\.codex-linux\/launcher\.d\/chromium-sandbox-chromium-sandbox\.sh/);
  assert.match(wrapper, /generated-chrome-sandbox/);
  assert.match(wrapper, /export CHROME_DEVEL_SANDBOX=/);
  assert.doesNotMatch(wrapper, /CODEX_LINUX_ENABLE_CHROMIUM_SANDBOX/);
  assert.doesNotMatch(wrapper, /CODEX_ELECTRON_EXECUTABLE|facade_dir|--facade-dir/);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex wrapper test "));
  const app = path.join(temp, "app");
  const launcherDir = path.join(app, ".codex-linux/launcher.d");
  const referenceDir = path.join(app, ".codex-linux/features/chromium-sandbox");
  const capture = path.join(temp, "capture.txt");
  fs.mkdirSync(launcherDir, { recursive: true });
  fs.mkdirSync(referenceDir, { recursive: true });
  fs.writeFileSync(path.join(launcherDir, "chromium-sandbox-chromium-sandbox.sh"), "#!/bin/sh\n", { mode: 0o755 });
  fs.writeFileSync(path.join(referenceDir, "generated-chrome-sandbox"), "helper\n", { mode: 0o755 });
  fs.writeFileSync(path.join(app, "start.sh"), '#!/bin/sh\nprintf "%s\\n%s\\n" "$CHROME_DEVEL_SANDBOX" "$*" > "$CAPTURE"\n', { mode: 0o755 });
  const result = spawnSync(wrapperPath, ["--app-dir", app, "--helper", "/qualified/helper", "--", "--show"], {
    encoding: "utf8",
    env: { ...process.env, CAPTURE: capture },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(capture, "utf8").trim().split("\n"), ["/qualified/helper", "--show"]);
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

test("historical no-space facade remains bounded and is not auto-selected", () => {
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
  assert.notEqual(refused.status, 0);
  assert.equal(fs.readFileSync(path.join(facade, "unrelated-user-file"), "utf8"), "must survive\n");
  fs.rmSync(temp, { recursive: true, force: true });
});

test("helper and desktop installers refuse unrelated existing targets", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex installer refusal "));
  const app = path.join(temp, "app");
  const referenceDir = path.join(app, ".codex-linux/features/chromium-sandbox");
  fs.mkdirSync(referenceDir, { recursive: true });
  fs.writeFileSync(path.join(app, "electron"), "electron fixture\n", { mode: 0o755 });
  fs.writeFileSync(path.join(referenceDir, "generated-chrome-sandbox"), "matching helper fixture\n", { mode: 0o755 });
  const destination = path.join(temp, "existing-helper");
  fs.writeFileSync(destination, "unrelated helper\n", { mode: 0o755 });
  const helper = spawnSync(path.join(scripts, "install-chromium-sandbox-helper.sh"), ["--app-dir", app, "--destination", destination], { encoding: "utf8" });
  assert.notEqual(helper.status, 0);
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
  assert.notEqual(desktop.status, 0);
  assert.equal(fs.readFileSync(desktopFile, "utf8"), "[Desktop Entry]\nName=Unmanaged\n");
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
