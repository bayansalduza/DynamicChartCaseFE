#!/usr/bin/env bash
set -euo pipefail
container="dynamicchart-fe-smoke-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --name "$container" "${1:?Pass the built image}" >/dev/null
for attempt in $(seq 1 30); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
    [[ "$status" == healthy ]] && break
    [[ "$status" != unhealthy ]]
    sleep 2
done
[[ "$status" == healthy ]]
docker exec "$container" wget -q -O - http://127.0.0.1:8080/healthz | grep -q ok
docker exec "$container" wget -q -O - http://127.0.0.1:8080/ \
    | grep -q 'name="api-base-url" content="https://dynamic-chart-api.bakibayansalduz.com"'
echo 'Production health and API URL smoke checks passed.'
