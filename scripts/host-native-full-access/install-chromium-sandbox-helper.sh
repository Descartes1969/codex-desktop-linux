#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: install-chromium-sandbox-helper.sh [--app-dir DIR] [--destination FILE] [--verify-only|--remove]

Installs the preserved chrome-sandbox helper from an app generated with the
chromium-sandbox Linux Feature enabled. The normal upstream build must create
the app first; this script downloads or redistributes no binary.
EOF
}

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
app_dir="$repo_root/codex-app"
destination="/usr/local/lib/codex-desktop-linux/chrome-sandbox"
verify_only=0
remove=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --app-dir) app_dir="${2:?missing value for --app-dir}"; shift 2 ;;
        --destination) destination="${2:?missing value for --destination}"; shift 2 ;;
        --verify-only) verify_only=1; shift ;;
        --remove) remove=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
    esac
done

app_dir="$(cd -- "$app_dir" && pwd -P)"
source_helper="$app_dir/.codex-linux/features/chromium-sandbox/generated-chrome-sandbox"

case "$destination" in
    /*) ;;
    *) echo "Destination must be an absolute path" >&2; exit 64 ;;
esac

[ -f "$app_dir/electron" ] || { echo "Missing generated Electron executable: $app_dir/electron" >&2; exit 66; }
[ -f "$source_helper" ] || { echo "Missing matching helper: $source_helper" >&2; exit 66; }
[ ! -e "$app_dir/chrome-sandbox" ] && [ ! -L "$app_dir/chrome-sandbox" ] || {
    echo "Generated sibling helper must be absent; rebuild with chromium-sandbox enabled" >&2
    exit 66
}

verify_installed() {
    local metadata
    [ ! -L "$destination" ] && [ -f "$destination" ] && [ -x "$destination" ] || {
        echo "Installed helper is missing, non-executable, or a symlink: $destination" >&2
        return 1
    }
    metadata="$(stat -Lc '%u:%g:%a' -- "$destination")"
    [ "$metadata" = "0:0:4755" ] || {
        echo "Installed helper metadata is $metadata, expected 0:0:4755" >&2
        return 1
    }
    cmp -s -- "$source_helper" "$destination" || {
        echo "Installed helper bytes do not match this Electron build" >&2
        return 1
    }
    printf 'PASS helper=%s sha256=%s metadata=%s\n' \
        "$destination" "$(sha256sum "$destination" | awk '{print $1}')" "$metadata"
}

if [ "$verify_only" -eq 1 ]; then
    verify_installed
    exit
fi

if [ "$remove" -eq 1 ]; then
    verify_installed >/dev/null
    sudo rm -f -- "$destination"
    sudo rmdir --ignore-fail-on-non-empty -- "$(dirname -- "$destination")" 2>/dev/null || true
    echo "Removed verified matching helper: $destination"
    exit
fi

if [ -e "$destination" ] || [ -L "$destination" ]; then
    [ ! -L "$destination" ] && [ -f "$destination" ] || {
        echo "Refusing to replace a non-regular or symlink destination: $destination" >&2
        exit 1
    }
    cmp -s -- "$source_helper" "$destination" || {
        echo "Refusing to overwrite a different existing helper: $destination" >&2
        echo "Remove it using its matching prior generated app, or choose a new --destination." >&2
        exit 1
    }
fi

sudo install -d -o root -g root -m 0755 -- "$(dirname -- "$destination")"
sudo install -o root -g root -m 4755 -- "$source_helper" "$destination"
verify_installed
