#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: create-no-space-facade.sh --app-dir DIR [--facade-dir DIR] [--force|--remove]

Creates a same-filesystem facade containing a hard link to Electron and
symlinks to the generated app's other top-level runtime files. This is optional
compatibility logic for an observed sandboxed-launch failure involving a path
with spaces; it is not a general Electron requirement.
EOF
}

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
app_dir="$repo_root/codex-app"
facade_dir="${XDG_DATA_HOME:-$HOME/.local/share}/codex-desktop-linux-facade"
force=0
remove=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --app-dir) app_dir="${2:?missing value for --app-dir}"; shift 2 ;;
        --facade-dir) facade_dir="${2:?missing value for --facade-dir}"; shift 2 ;;
        --force) force=1; shift ;;
        --remove) remove=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
    esac
done

app_dir="$(cd -- "$app_dir" && pwd -P)"
case "$facade_dir" in
    /*) ;;
    *) echo "Facade directory must be absolute" >&2; exit 64 ;;
esac
[ -f "$app_dir/electron" ] || { echo "Missing generated Electron executable: $app_dir/electron" >&2; exit 66; }

if [ "$remove" -eq 1 ]; then
    [ -d "$facade_dir" ] && [ ! -L "$facade_dir" ] || { echo "Facade is absent or not a directory: $facade_dir" >&2; exit 66; }
    [ -f "$facade_dir/electron" ] || { echo "Facade Electron is absent" >&2; exit 66; }
    electron_identity="$(stat -Lc '%d:%i' "$app_dir/electron")"
    [ "$electron_identity" = "$(stat -Lc '%d:%i' "$facade_dir/electron")" ] || {
        echo "Refusing removal: facade Electron does not match the generated app inode" >&2
        exit 1
    }
    marker="$facade_dir/.codex-host-native-facade"
    [ -f "$marker" ] && [ ! -L "$marker" ] || { echo "Refusing removal: managed-facade marker is absent" >&2; exit 1; }
    [ "$(cat -- "$marker")" = "electron_identity=$electron_identity" ] || {
        echo "Refusing removal: managed-facade marker does not match the generated app" >&2
        exit 1
    }
    shopt -s dotglob nullglob
    for entry in "$facade_dir"/*; do
        name="${entry##*/}"
        case "$name" in
            electron|.codex-host-native-facade) continue ;;
        esac
        [ -L "$entry" ] && [ "$(readlink -- "$entry")" = "$app_dir/$name" ] || {
            echo "Refusing removal: unexpected or modified facade entry: $entry" >&2
            exit 1
        }
    done
    rm -rf -- "$facade_dir"
    echo "Removed verified facade: $facade_dir"
    exit 0
fi

if [[ "$app_dir" != *' '* ]] && [ "$force" -ne 1 ]; then
    echo "No facade created: app path contains no spaces. Use --force only for a demonstrated compatibility need."
    exit 0
fi
[ ! -e "$facade_dir" ] || { echo "Refusing to replace existing facade: $facade_dir" >&2; exit 73; }

parent="$(dirname -- "$facade_dir")"
mkdir -p -- "$parent"
tmp_dir="$(mktemp -d -- "$parent/.codex-facade.XXXXXX")"
cleanup() { rm -rf -- "$tmp_dir"; }
trap cleanup EXIT

ln -- "$app_dir/electron" "$tmp_dir/electron" || {
    echo "Could not hard-link Electron; choose a facade on the same filesystem" >&2
    exit 74
}
printf 'electron_identity=%s\n' "$(stat -Lc '%d:%i' "$app_dir/electron")" > "$tmp_dir/.codex-host-native-facade"
shopt -s dotglob nullglob
for source in "$app_dir"/*; do
    [ "${source##*/}" = electron ] && continue
    ln -s -- "$source" "$tmp_dir/${source##*/}"
done

mv -- "$tmp_dir" "$facade_dir"
trap - EXIT

[ "$(stat -Lc '%d:%i' "$app_dir/electron")" = "$(stat -Lc '%d:%i' "$facade_dir/electron")" ] || {
    echo "Facade Electron does not share the production inode" >&2
    exit 1
}
printf 'PASS facade=%s electron_sha256=%s\n' \
    "$facade_dir" "$(sha256sum "$facade_dir/electron" | awk '{print $1}')"
