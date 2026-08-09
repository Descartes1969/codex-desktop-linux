#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: launch-host-native-sandboxed.sh [--app-dir DIR] [--helper FILE] [--facade-dir DIR] [-- APP_ARGS...]

Runs the generated app as the logged-in host user while opting into the
validated Chromium renderer-sandbox path added by this branch. This script
does not change Codex approval or workspace-sandbox policy.
EOF
}

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
app_dir="$repo_root/codex-app"
helper="/usr/local/lib/codex-desktop-linux/chrome-sandbox"
facade_dir="${XDG_DATA_HOME:-$HOME/.local/share}/codex-desktop-linux-facade"
app_args=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --app-dir) app_dir="${2:?missing value for --app-dir}"; shift 2 ;;
        --helper) helper="${2:?missing value for --helper}"; shift 2 ;;
        --facade-dir) facade_dir="${2:?missing value for --facade-dir}"; shift 2 ;;
        --) shift; app_args=("$@"); break ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument before --: $1" >&2; usage >&2; exit 64 ;;
    esac
done

app_dir="$(cd -- "$app_dir" && pwd -P)"
[ -x "$app_dir/start.sh" ] || { echo "Build the app first; missing $app_dir/start.sh" >&2; exit 66; }
[ -f "$app_dir/chrome-sandbox" ] || { echo "Missing bundled helper in $app_dir" >&2; exit 66; }

electron="$app_dir/electron"
if [[ "$app_dir" == *' '* ]]; then
    [ -x "$facade_dir/electron" ] || {
        echo "This app path contains spaces. Create and qualify the optional facade first:" >&2
        echo "  scripts/host-native-full-access/create-no-space-facade.sh --app-dir \"$app_dir\" --facade-dir \"$facade_dir\"" >&2
        exit 78
    }
    electron="$facade_dir/electron"
fi

export CODEX_LINUX_ENABLE_CHROMIUM_SANDBOX=1
export CHROME_DEVEL_SANDBOX="$helper"
export CODEX_ELECTRON_EXECUTABLE="$electron"

exec "$app_dir/start.sh" "${app_args[@]}"
