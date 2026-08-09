#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: qualify-runtime.sh --main-pid PID --app-dir DIR [--helper FILE]

Read-only checks for the host-native main process and at least one effective
Chromium renderer sandbox. Run while the app is open and stable.
EOF
}

main_pid=""
app_dir=""
helper="/usr/local/lib/codex-desktop-linux/chrome-sandbox"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --main-pid) main_pid="${2:?missing PID}"; shift 2 ;;
        --app-dir) app_dir="${2:?missing app dir}"; shift 2 ;;
        --helper) helper="${2:?missing helper}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
    esac
done

[[ "$main_pid" =~ ^[0-9]+$ ]] && [ -r "/proc/$main_pid/status" ] || { echo "Invalid or dead main PID" >&2; exit 66; }
app_dir="$(cd -- "$app_dir" && pwd -P)"
[ -f "$app_dir/electron" ] || { echo "Missing $app_dir/electron" >&2; exit 66; }

status_value() { awk -v key="$2" '$1 == key ":" {print $2; exit}' "/proc/$1/status"; }

[ "$(status_value "$main_pid" Uid)" = "$(id -u)" ] || { echo "FAIL main UID is not the logged-in user" >&2; exit 1; }
[ "$(status_value "$main_pid" NoNewPrivs)" = 0 ] || { echo "FAIL main NoNewPrivs is not 0" >&2; exit 1; }
[ "$(readlink "/proc/$main_pid/ns/user")" = "$(readlink /proc/self/ns/user)" ] || { echo "FAIL main user namespace differs from host" >&2; exit 1; }
[ "$(readlink "/proc/$main_pid/ns/net")" = "$(readlink /proc/self/ns/net)" ] || { echo "FAIL main network namespace differs from host" >&2; exit 1; }
[ "$(stat -Lc '%d:%i' "/proc/$main_pid/exe")" = "$(stat -Lc '%d:%i' "$app_dir/electron")" ] || {
    echo "FAIL main executable is not the generated Electron inode" >&2; exit 1;
}

renderer_pid="$({ python3 - "$main_pid" <<'PY'
import pathlib, sys

root = int(sys.argv[1])
parents = {}
cmdlines = {}
for item in pathlib.Path('/proc').iterdir():
    if not item.name.isdigit():
        continue
    pid = int(item.name)
    try:
        parts = (item / 'stat').read_text().split()
        parents[pid] = int(parts[3])
        cmdlines[pid] = (item / 'cmdline').read_bytes().replace(b'\0', b' ')
    except (OSError, ValueError, IndexError):
        pass

def descends(pid):
    seen = set()
    while pid in parents and pid not in seen:
        if pid == root:
            return True
        seen.add(pid)
        pid = parents[pid]
    return False

for pid in sorted(cmdlines):
    if descends(pid) and b'--type=renderer' in cmdlines[pid]:
        print(pid)
        break
PY
} 2>/dev/null)"

[[ "$renderer_pid" =~ ^[0-9]+$ ]] && [ -r "/proc/$renderer_pid/status" ] || {
    echo "FAIL no renderer descendant found" >&2; exit 1;
}
[ "$(status_value "$renderer_pid" NoNewPrivs)" = 1 ] || { echo "FAIL renderer NoNewPrivs is not 1" >&2; exit 1; }
[ "$(status_value "$renderer_pid" Seccomp)" = 2 ] || { echo "FAIL renderer Seccomp is not filter mode 2" >&2; exit 1; }
renderer_args="$(tr '\0' '\n' < "/proc/$renderer_pid/cmdline")"
grep -Fxq -- '--enable-sandbox' <<< "$renderer_args" || { echo "FAIL renderer lacks --enable-sandbox" >&2; exit 1; }
if grep -Eq -- '^--(no-sandbox|disable-gpu-sandbox)$' <<< "$renderer_args"; then
    echo "FAIL renderer contains a sandbox-disable argument" >&2
    exit 1
fi

[ ! -L "$helper" ] && [ -f "$helper" ] || { echo "FAIL helper missing or symlinked" >&2; exit 1; }
[ "$(stat -Lc '%u:%g:%a' "$helper")" = "0:0:4755" ] || { echo "FAIL helper is not root:root mode 4755" >&2; exit 1; }
reference="$app_dir/.codex-linux/features/chromium-sandbox/generated-chrome-sandbox"
[ ! -L "$reference" ] && [ -f "$reference" ] || { echo "FAIL generated helper reference missing or symlinked" >&2; exit 1; }
[ ! -e "$app_dir/chrome-sandbox" ] && [ ! -L "$app_dir/chrome-sandbox" ] || { echo "FAIL generated sibling helper is present" >&2; exit 1; }
cmp -s -- "$helper" "$reference" || { echo "FAIL helper bytes differ from generated app reference" >&2; exit 1; }

printf 'PASS main_pid=%s renderer_pid=%s uid=%s main_nnp=0 renderer_nnp=1 renderer_seccomp=2\n' \
    "$main_pid" "$renderer_pid" "$(id -u)"
