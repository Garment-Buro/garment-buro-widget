#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "${1:-}" =~ ^[a-f0-9]{40}$ && "${2:-}" =~ ^[A-Za-z0-9_-]+$ && $# == 2 ]] || exit 64
revision="$1"
actor="$2"
export WIDGET_IMAGE="ghcr.io/garment-buro/garment-buro-widget:$revision"
cd /home/garment-widget
exec 9>/run/lock/garment-widget-deploy.lock
flock -w 600 9
registry_dir="$(mktemp -d /run/garment-widget-registry.XXXXXX)"
cleanup() { rm -f "$registry_dir/config.json"; rmdir "$registry_dir"; }
trap cleanup EXIT
docker --config "$registry_dir" login ghcr.io -u "$actor" --password-stdin
docker --config "$registry_dir" pull "$WIDGET_IMAGE"
compose=(docker compose --project-name garment-widget -f docker-compose.registry.yml)
"${compose[@]}" config --quiet
previous_image="$(docker inspect garment-widget --format '{{.Config.Image}}')"
backup_dir="/home/garment-widget/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
printf '%s\n' "$previous_image" >"$backup_dir/previous-image"
docker exec garment-widget tar -C /app/.data -czf - . >"$backup_dir/dashboard-snapshot.tar.gz"
gzip -t "$backup_dir/dashboard-snapshot.tar.gz"
switched=false
rollback() {
  local code=$?
  trap - ERR
  if [[ "$switched" == true ]]; then
    export WIDGET_IMAGE="$previous_image"
    "${compose[@]}" up -d --no-deps --pull never garment-widget || true
  fi
  exit "$code"
}
trap rollback ERR
switched=true
"${compose[@]}" up -d --no-deps --pull never --wait --wait-timeout 180 garment-widget
curl --fail --silent --show-error --retry 3 --max-time 20 https://widget.garment-buro.ru/ -o /dev/null
release_tmp="$(mktemp .release.XXXXXX)"
printf 'SOURCE_REVISION=%s\nWIDGET_IMAGE=%s\n' "$revision" "$WIDGET_IMAGE" >"$release_tmp"
mv "$release_tmp" .release
echo "Widget deployed: $revision"
