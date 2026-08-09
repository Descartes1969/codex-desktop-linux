#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: qualify-lifecycle.sh --action x|quit --main-pid PID [--lock-file FILE ...]

Interactive, read-only lifecycle test. For action=x, click the ACTUAL visible
title-bar X; do not use xdotool, wmctrl, WM_DELETE_WINDOW, or another synthetic
ICCCM substitute. The script checks teardown, then asks for the ordinary
following launch PID and a literal usability confirmation.
EOF
}

action=""
main_pid=""
lock_files=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --action) action="${2:?missing action}"; shift 2 ;;
        --main-pid) main_pid="${2:?missing PID}"; shift 2 ;;
        --lock-file) lock_files+=("${2:?missing lock file}"); shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
    esac
done

case "$action" in x|quit) ;; *) usage >&2; exit 64 ;; esac
[[ "$main_pid" =~ ^[0-9]+$ ]] && [ -e "/proc/$main_pid/exe" ] || { echo "Invalid or dead main PID" >&2; exit 66; }
exe_identity="$(stat -Lc '%d:%i' "/proc/$main_pid/exe")"

if [ "$action" = x ]; then
    echo "Click the ACTUAL client-side title-bar X now. Do not send a synthetic close."
else
    echo "Choose File -> Quit ChatGPT now."
fi
read -r -p "Press Enter only after performing that visible action. " _

for _ in $(seq 1 150); do
    [ ! -e "/proc/$main_pid/status" ] && break
    sleep 0.1
done
[ ! -e "/proc/$main_pid/status" ] || { echo "FAIL original main PID remains alive" >&2; exit 1; }

same_exe=0
for exe in /proc/[0-9]*/exe; do
    [ -e "$exe" ] || continue
    identity="$(stat -Lc '%d:%i' "$exe" 2>/dev/null || true)"
    [ "$identity" = "$exe_identity" ] && same_exe=$((same_exe + 1))
done
[ "$same_exe" -eq 0 ] || { echo "FAIL $same_exe process(es) still use the Electron inode" >&2; exit 1; }

if command -v fuser >/dev/null 2>&1; then
    for lock_file in "${lock_files[@]}"; do
        if fuser "$lock_file" >/dev/null 2>&1; then
            echo "FAIL lock still has a holder: $lock_file" >&2
            exit 1
        fi
    done
fi

read -r -p "Launch normally again, then enter the new Electron main PID: " next_pid
[[ "$next_pid" =~ ^[0-9]+$ ]] && [ -e "/proc/$next_pid/exe" ] || { echo "FAIL invalid following PID" >&2; exit 1; }
[ "$next_pid" != "$main_pid" ] || { echo "FAIL following PID is not distinct" >&2; exit 1; }
[ "$(stat -Lc '%d:%i' "/proc/$next_pid/exe")" = "$exe_identity" ] || { echo "FAIL following launch uses another executable" >&2; exit 1; }

read -r -p "After visually confirming authentication and a usable composer, type AUTHENTICATED_USABLE: " confirmation
[ "$confirmation" = AUTHENTICATED_USABLE ] || { echo "FAIL usability confirmation not supplied" >&2; exit 1; }

printf 'PASS action=%s old_pid=%s following_pid=%s stale_processes=0 locks_checked=%s authenticated_usable=yes\n' \
    "$action" "$main_pid" "$next_pid" "${#lock_files[@]}"
