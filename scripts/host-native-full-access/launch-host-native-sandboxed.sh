#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: launch-host-native-sandboxed.sh [--app-dir DIR] [--helper FILE] [-- APP_ARGS...]

Runs an app generated with the chromium-sandbox Linux Feature enabled as the
logged-in host user. This script
does not change Codex approval or workspace-sandbox policy.
EOF
}

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
app_dir="$repo_root/codex-app"
helper="/usr/local/lib/codex-desktop-linux/chrome-sandbox"
app_args=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --app-dir) app_dir="${2:?missing value for --app-dir}"; shift 2 ;;
        --helper) helper="${2:?missing value for --helper}"; shift 2 ;;
        --) shift; app_args=("$@"); break ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument before --: $1" >&2; usage >&2; exit 64 ;;
    esac
done

app_dir="$(cd -- "$app_dir" && pwd -P)"
[ -x "$app_dir/start.sh" ] || { echo "Build the app first; missing $app_dir/start.sh" >&2; exit 66; }
[ -x "$app_dir/.codex-linux/launcher.d/chromium-sandbox-chromium-sandbox.sh" ] || {
    echo "Build the app with the chromium-sandbox Linux Feature enabled" >&2
    exit 66
}
[ -f "$app_dir/.codex-linux/features/chromium-sandbox/generated-chrome-sandbox" ] || {
    echo "Missing preserved generated helper reference in $app_dir" >&2
    exit 66
}
[ ! -e "$app_dir/chrome-sandbox" ] && [ ! -L "$app_dir/chrome-sandbox" ] || {
    echo "Generated sibling helper must be absent; rebuild with chromium-sandbox enabled" >&2
    exit 66
}

export CHROME_DEVEL_SANDBOX="$helper"

exec "$app_dir/start.sh" "${app_args[@]}"
