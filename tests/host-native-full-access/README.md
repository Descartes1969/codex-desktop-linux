# Host-native Full-access qualification tests

Run the source-level tests before obtaining the proprietary application payload:

```bash
node --test tests/host-native-full-access/source-policy.test.js
```

The suite verifies the corrected disabled-by-default feature boundary, runs
the feature's own unit suite, checks public support-script safety, and confirms
that the historical no-space facade is not selected by the corrected launcher.

With a generated app running, verify host identity and effective renderer
sandboxing:

```bash
tests/host-native-full-access/qualify-runtime.sh \
  --main-pid "$ELECTRON_MAIN_PID" \
  --app-dir "$PWD/codex-app"
```

Run lifecycle checks separately for the real title-bar X and File → Quit. The
script deliberately requires the visible user action and never sends a
synthetic ICCCM close:

```bash
tests/host-native-full-access/qualify-lifecycle.sh --action x --main-pid "$ELECTRON_MAIN_PID"
tests/host-native-full-access/qualify-lifecycle.sh --action quit --main-pid "$ELECTRON_MAIN_PID"
```

For stronger evidence, run three X/ordinary-relaunch cycles and retain the
script output together with the exact source commit and generated-app hashes.
The script verifies teardown and the following executable identity; the user
visually confirms authentication and composer usability.
