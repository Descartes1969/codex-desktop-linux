# Host-native Full-access qualification tests

Run the source-level tests before obtaining the proprietary application payload:

```bash
node --test tests/host-native-full-access/source-policy.test.js
```

The suite executes the launcher's real executable-selection and final-argument
guard functions in fixtures. It proves that a space-path app invokes the
same-inode facade and that sandbox-disable arguments fail closed.

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
