#!/usr/bin/env bash
# Run both deploy gates. Development only; not part of the build and not
# shipped (see AGENTS.md, "What does not [ship]").
#
#   tools/run-checks.sh
#
# Starts the HTTP server itself if 8123 is not already answering, so the one
# command gives the same result as the two commands in AGENTS.md.
set -uo pipefail
cd "$(dirname "$0")/.."

started=""
if ! curl -sf -o /dev/null http://127.0.0.1:8123/; then
    python3 -m http.server 8123 --bind 127.0.0.1 >/tmp/nova-http.log 2>&1 &
    started=$!
    for _ in $(seq 1 40); do
        curl -sf -o /dev/null http://127.0.0.1:8123/ && break
        sleep 0.25
    done
fi

fail=0

echo "--- node: unit tests"
node --test tests/*.test.mjs 2>&1 | tail -8 || fail=1
node --test tests/*.test.mjs >/dev/null 2>&1 || fail=1

echo "--- browser: integration"
# A throwaway profile every time: the page writes to localStorage, so a warm
# one starts from the previous run's drills and fails unrelated checks.
# --no-sandbox / --disable-dev-shm-usage are for unprivileged containers; they
# do not change what the page does.
profile=$(mktemp -d)
title=$(google-chrome --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --disable-crash-reporter --disable-breakpad --no-first-run \
    --window-size=430,932 --user-data-dir="$profile" \
    --virtual-time-budget=20000 --dump-dom \
    http://127.0.0.1:8123/tests/integration.html 2>/dev/null \
    | grep -o '<title>[^<]*')
rm -rf "$profile"
echo "$title"
case "$title" in
    *PASS*) ;;
    *) fail=1 ;;
esac

[ -n "$started" ] && kill "$started" 2>/dev/null
exit "$fail"
