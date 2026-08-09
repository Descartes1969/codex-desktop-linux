# Host-native Full-access qualification guide

This guide accompanies [From Isolation to Host-Native Full Access](./host-native-full-access-article.md). It describes an experimental, source-built variant of the unofficial `ilysenko/codex-desktop-linux` community project. It is not an OpenAI-supported Linux release.

The publication branch is based on upstream commit `de575d0cc6e2789cf9e53c02e7d68485cc5c2e93`, inspected on 2026-08-08. Recheck the source changes and tests before rebasing onto another upstream revision.

## Scope and warning

“Host-native” means the generated desktop app runs as the logged-in user with the real HOME, XDG configuration, Git/Codex state, host namespaces and ordinary network. It does not place a second Bubblewrap/AppArmor/private-network boundary around Codex. This is what makes user-selected Full access real—and what gives the application the authority of that user.

The branch adds an **opt-in** Chromium renderer-sandbox path. It validates a matching helper before omitting upstream's sandbox-disable arguments. The helper comes from the Electron runtime produced by the normal upstream build; this repository contains no helper binary, DMG, `app.asar`, authenticated profile or other proprietary payload.

Use the ordinary Codex approval and sandbox settings appropriate for your threat model. The exact no-approval Full-access policy shown later is evidence of the qualified workstation, not a recommended default.

Test boundary: the retained qualification used Ubuntu, GNOME and X11 on one workstation. The scripts are generalized, but that does not establish universal behavior on other distributions, compositors or Electron versions.

## What this branch changes

- `launcher/start.sh.template` recognizes `CODEX_LINUX_ENABLE_CHROMIUM_SANDBOX=1`. In that mode it requires an absolute, non-symlink helper that is root-owned, mode 4755 and byte-identical to the generated app's matching `chrome-sandbox`. Validation failure stops launch.
- `scripts/host-native-full-access/` installs/verifies the matching helper, creates the optional no-space facade, launches the host-native variant and installs a user desktop entry.
- `tests/host-native-full-access/` tests source policy and scripts, inspects effective runtime sandboxing, and captures actual-user-action lifecycle outcomes.

Current upstream already supplies host-native execution, Linux Computer Use, identity-aware stale-process recovery and explicit-Quit cleanup. This branch does not duplicate those mechanisms. It also does not publish the locally qualified five-second X-close heuristic; that implementation remains `NEEDS_REBASE_OR_RESEARCH`.

## Prerequisites

Start with a Linux development system supported by upstream. The upstream build requires `git`, Bash, `make`, Python 3, `curl`, `unzip`, `tar`, `7z`/`7zz`, a C++ toolchain and Rust/Cargo for native components. On supported distributions, let upstream install the exact dependency set:

```bash
bash scripts/install-deps.sh
```

You also need:

- sudo for the narrow root-owned Chromium helper installation;
- a normal graphical session;
- `node` only for the source tests (the full build manages its own Node runtime);
- optional `fuser` for lock-holder checks;
- an existing ChatGPT account and, if GitHub operations are needed, normal GitHub CLI authentication.

Never automate passwords, MFA, OAuth/device codes or browser cookies.

## Clone and select the reviewed branch

```bash
git clone https://github.com/Descartes1969/codex-desktop-linux.git
cd codex-desktop-linux
git switch host-native-full-access-qualification
git rev-parse HEAD
```

Compare the resulting publication commit to the commit recorded on the branch's GitHub page. The upstream base is:

```text
de575d0cc6e2789cf9e53c02e7d68485cc5c2e93
```

Run all source-level checks before downloading the application payload:

```bash
node --test tests/host-native-full-access/source-policy.test.js
node --test scripts/patch-linux-window-ui.test.js
node --test linux-features/*/test.js
```

## Build through the supported upstream process

Install dependencies, then let upstream obtain and validate the current application DMG and matching Electron runtime:

```bash
bash scripts/install-deps.sh
make build-app-fresh
```

This creates `codex-app/`. The DMG, generated application, Electron binary, `app.asar` and native helper are local build artifacts and must not be committed.

The build is not one-command reproducible in the archival sense: the proprietary application endpoint can change, upstream patch contracts can drift, and authentication is interactive. Preserve the Git commit, build report and local hashes for your own qualification record.

## Set up the Chromium renderer sandbox

Install the helper generated with this exact Electron build:

```bash
scripts/host-native-full-access/install-chromium-sandbox-helper.sh \
  --app-dir "$PWD/codex-app"
```

The script performs the only privileged step in this variant:

1. reads `codex-app/chrome-sandbox`, obtained from upstream's normal matching Electron download;
2. installs it at `/usr/local/lib/codex-desktop-linux/chrome-sandbox` as root:root mode 4755;
3. verifies metadata and byte identity.

It does not download or redistribute a binary, and it refuses to overwrite a different existing helper. Remove an old helper with its matching prior generated app or select a new destination explicitly. Verify again at any time:

```bash
scripts/host-native-full-access/install-chromium-sandbox-helper.sh \
  --app-dir "$PWD/codex-app" \
  --verify-only
```

If helper validation fails, the opt-in launcher exits instead of falling back to an unsandboxed launch. Do not borrow a helper from another browser or Electron version. On Ubuntu configurations that restrict unprivileged user namespaces through AppArmor, use this matching SUID path or design and review a path-specific policy; do not globally disable the restriction merely to make the app start.

## Optional no-space compatibility facade

The qualified local layout had a path containing spaces and direct sandboxed startup failed there. The retained evidence did not isolate Chromium's SUID broker, Electron invocation or packaging as the owner. A same-filesystem, no-space facade made that specific fixture work; this is not a general Electron requirement.

The launch wrapper uses the normal app path when it contains no spaces. If your generated app path contains spaces, create the facade:

```bash
scripts/host-native-full-access/create-no-space-facade.sh \
  --app-dir "$PWD/codex-app" \
  --facade-dir "${XDG_DATA_HOME:-$HOME/.local/share}/codex-desktop-linux-facade"
```

The script hard-links only `electron` and symlinks the other top-level runtime entries. It refuses to replace an existing directory and requires the facade to share the Electron inode. Do not enable it when the direct path already works.

## Launch host-native

```bash
scripts/host-native-full-access/launch-host-native-sandboxed.sh
```

This wrapper sets the renderer-sandbox opt-in and matching helper path, then executes generated `codex-app/start.sh`. The launcher refuses sandbox-disable arguments from persistent flags, feature hooks or pass-through arguments while the opt-in is active. It does not create outer namespaces, substitute HOME/XDG, copy credentials, configure sudo or change Codex policy.

For GNOME/application-menu launch:

```bash
scripts/host-native-full-access/install-user-desktop-entry.sh
```

The installer refuses to replace an unmarked desktop entry. Then launch **ChatGPT Desktop (host-native sandboxed variant)** from the application menu.

## Codex Full-access policy

Recommended reader choice: retain approval prompts and the narrowest sandbox mode that supports your work. Host-native launch and Chromium renderer sandboxing do not require `danger-full-access` or disabled approvals.

### Exact qualified workstation policy

The single qualified workstation used the following host Codex configuration:

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
```

The same reference is in `scripts/host-native-full-access/exact-qualified-config.toml.example`. Use it only when you explicitly intend to grant the agent the logged-in user's host authority and have separately accepted that risk. Do not overwrite unrelated Codex configuration when changing these keys.

## Authentication

Start the app and use its normal ChatGPT sign-in flow. Complete passwords, MFA and any CAPTCHA yourself. Do not place credentials in launch scripts or copy an authenticated profile from another sandbox.

For GitHub, authenticate the real host configuration through the supported CLI flow:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git --hostname github.com
gh auth status --hostname github.com
```

Never print or record `gh auth token` output.

## Computer Use

At the documented upstream base, Linux Computer Use is already bundled and its UI is opt-in. Follow [upstream's Linux Computer Use guide](./linux-computer-use.md). This variant adds no Computer Use backend or wrapper.

The historical isolated qualification covered screenshot, X11 coordinate input, a dedicated native test window and a dedicated browser profile. The later host-native qualification established that the MCP remained available and requested screenshot approval; it did not rerun every earlier action. Qualify only the actions you intend to claim on your current compositor and account rollout.

## Qualification

Record the publication commit, generated-app hashes and exact test output. Do not record account pages or secrets.

### 1. Source and visible launch

```bash
node --test tests/host-native-full-access/source-policy.test.js
scripts/host-native-full-access/launch-host-native-sandboxed.sh
```

Confirm a visible authenticated window and usable composer. Submit a deterministic prompt such as `Reply exactly: HOST_NATIVE_MODEL_OK` and record only the non-secret result.

### 2. Host access, identity, network and renderer sandbox

Create a disposable test directory, then ask the app to read one exact fixture and write another. Verify bytes from the host. Do not use personal directories as fixtures.

Find the Electron main PID from the exact generated/facade executable, then run:

```bash
tests/host-native-full-access/qualify-runtime.sh \
  --main-pid "$ELECTRON_MAIN_PID" \
  --app-dir "$PWD/codex-app"
```

The script requires the logged-in UID, host user/network namespaces, main `NoNewPrivs: 0`, at least one renderer with `NoNewPrivs: 1` and seccomp filter mode 2, `--enable-sandbox`, no sandbox-disable argument, and a byte-matching root-owned mode-4755 helper.

Perform two separate HTTPS requests from app-authorized commands if network persistence is part of your acceptance criteria. Do not assume one successful request proves a durable session.

### 3. Computer Use availability

Enable the current upstream UI as documented, start the bundled MCP, and verify that an action produces the expected approval surface. Do not claim screenshot/input/browser control unless you perform and retain those exact tests in a dedicated non-private fixture.

### 4. File → Quit and actual title-bar X

Run these as separate launches:

```bash
tests/host-native-full-access/qualify-lifecycle.sh \
  --action quit \
  --main-pid "$ELECTRON_MAIN_PID"

tests/host-native-full-access/qualify-lifecycle.sh \
  --action x \
  --main-pid "$ELECTRON_MAIN_PID"
```

For `--action x`, click the **actual client-side title-bar X**. Do not use `xdotool`, `wmctrl`, a `WM_DELETE_WINDOW` message or another synthetic ICCCM substitute. The script waits for teardown, checks that no process uses the old Electron inode, optionally checks supplied locks, and validates a distinct ordinary following launch. Run three X/relaunch cycles if matching the local qualification standard.

This branch publishes the requirement and regression fixture, not the old five-second implementation. Design any future fix against the upstream tray/warm-start/single-instance architecture current at that time.

## Rollback and uninstall

Remove only artifacts created by this variant:

```bash
scripts/host-native-full-access/install-user-desktop-entry.sh --remove

scripts/host-native-full-access/create-no-space-facade.sh \
  --app-dir "$PWD/codex-app" \
  --facade-dir "${XDG_DATA_HOME:-$HOME/.local/share}/codex-desktop-linux-facade" \
  --remove

scripts/host-native-full-access/install-chromium-sandbox-helper.sh \
  --app-dir "$PWD/codex-app" \
  --remove
```

The removal scripts verify the exact facade inode and matching helper bytes before deletion. If you never created the facade, skip that command. Deleting the clone removes its generated app only; it does not remove your normal ChatGPT/Codex state. Do not delete `~/.codex`, browser profiles, Git configuration or unrelated desktop files as part of this rollback.

To return to unmodified upstream source without deleting your checkout:

```bash
git switch main
```
