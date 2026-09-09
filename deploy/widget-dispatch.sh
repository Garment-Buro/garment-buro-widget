#!/usr/bin/env bash
set -euo pipefail
# Installed root-owned; used as the only command for the widget CI SSH key.
read -r command revision actor extra <<<"${SSH_ORIGINAL_COMMAND:-}"
[[ "$command" == deploy && "$revision" =~ ^[a-f0-9]{40}$ && "$actor" =~ ^[A-Za-z0-9_-]+$ && -z "$extra" ]] || exit 64
exec sudo -n /usr/local/sbin/garment-widget-deploy "$revision" "$actor"
