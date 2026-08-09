#!/usr/bin/env bash
set -euo pipefail

usage() {
    echo "Usage: install-user-desktop-entry.sh [--remove]" >&2
}

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
wrapper="$repo_root/scripts/host-native-full-access/launch-host-native-sandboxed.sh"
icon="$repo_root/assets/codex.png"
desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
desktop_file="$desktop_dir/codex-host-native-sandboxed.desktop"

desktop_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
}

render_desktop_entry() {
    echo '[Desktop Entry]'
    echo 'Type=Application'
    echo 'Name=ChatGPT Desktop (host-native sandboxed variant)'
    echo 'Comment=Unofficial qualified host-native launcher variant'
    printf 'Exec=%s\n' "$(desktop_quote "$wrapper")"
    printf 'Icon=%s\n' "$icon"
    echo 'Terminal=false'
    echo 'Categories=Development;'
    echo 'StartupNotify=true'
    echo 'X-Codex-Host-Native-Managed=true'
}

desktop_entry_matches_expected() {
    [ ! -L "$desktop_file" ] && [ -f "$desktop_file" ] \
        && cmp -s -- "$desktop_file" <(render_desktop_entry)
}

case "${1:-}" in
    "") ;;
    --remove)
        [ -e "$desktop_file" ] || [ -L "$desktop_file" ] || { echo "Desktop entry is absent: $desktop_file" >&2; exit 66; }
        desktop_entry_matches_expected || {
            echo "Refusing removal: desktop entry differs from the exact file managed by this checkout" >&2
            exit 1
        }
        rm -f -- "$desktop_file"
        command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
        echo "Removed $desktop_file"
        exit 0
        ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 64 ;;
esac

[ -x "$wrapper" ] || { echo "Missing executable wrapper: $wrapper" >&2; exit 66; }
[ -f "$icon" ] || { echo "Missing icon: $icon" >&2; exit 66; }
if [ -e "$desktop_file" ] || [ -L "$desktop_file" ]; then
    desktop_entry_matches_expected || {
        echo "Refusing to replace an unmanaged or modified desktop entry: $desktop_file" >&2
        exit 1
    }
fi

mkdir -p -- "$desktop_dir"
render_desktop_entry | install -m 0644 /dev/stdin "$desktop_file"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
echo "Installed $desktop_file"
