#!/usr/bin/env bash
# Assemble the publishable site into _site/.
#
# TWO consumers, one script, on purpose:
#   * Cloudflare Pages  - build command, output directory _site/
#   * .github/workflows/ci.yml - so CI checks the artifact that would ship,
#     not just the checkout
#
# It is a COPY, not a build. The app is plain static files with no build step
# and must stay that way - see AGENTS.md. Running this locally and serving
# _site/ is the closest thing to production you can get.
#
# The checks at the bottom are why this is a script and not a cp line: the two
# failure modes below both produce a site that looks fine in a browser and
# breaks later, and both are invisible until someone hits them.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
SITE="$ROOT/_site"

# Deliberately NOT published, and extend this list rather than reverting to
# "copy the whole repo":
#
#   tests/   - development only, and it stubs the page chrome the app expects
#   1.3/     - a frozen older release with its own index.html; publishing it
#              would serve a second, stale app at /1.3/
#   tools/   - this script and the icon regeneration (needs ImageMagick, not a
#              browser); the PNGs it writes are committed
#   AGENTS.md - instructions for coding agents, not for users
#
# No .nojekyll needed: Cloudflare Pages serves the output directory verbatim
# and never runs it through Jekyll.

rm -rf "$SITE"
mkdir -p "$SITE"

# Everything the browser actually loads, plus the standalone converter tool.
cp -a index.html converter.html "$SITE/"
for dir in css js images icons fonts; do
  [ -d "$dir" ] || { echo "::error::missing directory: $dir" >&2; exit 1; }
  cp -a "$dir" "$SITE/"
done
cp -a manifest.webmanifest sw.js nova_drills_v2_example.csv README.md "$SITE/"

# sw.js and manifest.webmanifest are not optional extras: without them the site
# still works in a tab, but it can never be installed and never opens offline.
# icons/ is precached by the worker, and so is fonts/ - a self-hosted webfont
# that is not precached falls back to the system stack the first time the
# phone is out of signal. A shipped-but-empty fonts/ is the silent version of
# the same bug, so the check is on the FILE, not the directory.
for required in sw.js manifest.webmanifest fonts/dm-sans-latin.woff2 \
                icons/icon-192.png icons/icon-512.png; do
  [ -f "$SITE/$required" ] || { echo "::error::not published: $required" >&2; exit 1; }
done

# --- check 1: every local src=/href= in index.html was actually copied -------
# This is the check that catches "added a new module and forgot the directory".
python3 - "$SITE" <<'PY'
import re, pathlib, sys
site = pathlib.Path(sys.argv[1])
missing = []
for ref in re.findall(r'(?:src|href)="([^"]+)"', (site / 'index.html').read_text()):
    if ref.startswith(('http://', 'https://', '//', '#', 'data:', 'mailto:')):
        continue
    ref = ref.split('#')[0].split('?')[0]
    if not ref or ref.startswith('/'):
        continue
    if not (site / ref).exists():
        missing.append(ref)
if missing:
    sys.exit('::error::index.html references files that were not published: ' + ', '.join(missing))
print('index.html: every local asset is present')
PY

# --- check 2: the service worker can reach everything it precaches ----------
# The browser suite walks the real import graph, but against the checkout.
# This asks the same question of the ARTIFACT: a site that ships a worker
# pointing at a file nobody copied opens fine online and dies the first time
# it is offline, which is most of what it is for.
python3 - "$SITE" <<'PY'
import re, pathlib, sys
site = pathlib.Path(sys.argv[1])
source = (site / 'sw.js').read_text()
body = re.search(r'const PRECACHE = \[(.*?)\];', source, re.S)
if not body:
    sys.exit('::error::could not find the PRECACHE list in sw.js')
entries = re.findall(r"'([^']+)'", body.group(1))
missing = [e for e in entries if e != 'SHELL' and not (site / e).exists()]
if missing:
    sys.exit('::error::sw.js precaches files that were not published: ' + ', '.join(missing))
print(f'sw.js: all {len(entries) - 1} precached files are present')
PY

echo "_site/ is ready ($(find "$SITE" -type f | wc -l) files). Point a server at it, or let Cloudflare publish it."
