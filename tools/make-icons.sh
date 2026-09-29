#!/usr/bin/env bash
# Regenerate the PWA icon PNGs from the SVG sources in icons/.
#
# This is NOT part of the build. The app has no build step and the PNGs are
# committed, exactly like every other asset. Run this only after editing an SVG:
#
#     tools/make-icons.sh
#
# Needs ImageMagick with the librsvg delegate, which is what gives the gradients
# and blur-free scaling; ImageMagick's built-in MSVG renderer would flatten them.

set -euo pipefail

cd "$(dirname "$0")/.."
cd v2   # the icons ship inside the app directory

command -v convert >/dev/null || {
    echo "convert not found - install ImageMagick" >&2; exit 1; }

# render <source.svg> <output.png> <width> [height]
render() {
    local src=$1 out=$2 w=$3 h=${4:-$3}
    convert -background none -density 384 -resize "${w}x${h}" "$src" "$out"
    printf '  %-34s %s\n' "$out" "$(identify -format '%wx%h %[channels]' "$out")"
}

echo "Rendering icons into v2/icons/"

# "any" purpose icons. Full-bleed square: the platform applies its own mask.
render icons/icon.svg icons/icon-192.png 192
render icons/icon.svg icons/icon-512.png 512

# maskable purpose - artwork already shrunk into the safe zone by the source.
render icons/icon-maskable.svg icons/maskable-512.png 512

# iOS home screen icon. iOS applies its own squircle and never rounds it for
# you, and it ignores the manifest, so it needs its own file.
render icons/icon.svg icons/apple-touch-icon.png 180

# Legacy tab icon for anything that will not take the SVG.
render icons/icon.svg icons/favicon-32.png 32

echo "Done."
