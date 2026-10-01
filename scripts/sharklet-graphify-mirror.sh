#!/usr/bin/env bash
# Publishes a slim, production-code-only copy of some paths to fmorales2007/sharklet-openclaw-<name>
# so Graphify Cloud can index it under the Free plan cap (25k nodes per repo).
# Paths are kept as in this repo. Each run force-pushes one orphan commit: the mirror has no history.
#
# Usage (from the repo root): scripts/sharklet-graphify-mirror.sh <name> <path>...
#   GRAPHIFY_MIRROR_TOKEN  token with contents:write on the mirror (CI); without it, git's own credentials are used
#   DRY_RUN=1              build the tree and print its size, without pushing
set -euo pipefail

name=$1; shift
repo="fmorales2007/sharklet-openclaw-$name"
src_sha=$(git rev-parse HEAD)
src_ref=${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}
exclude='[/.-](test|spec)[.-]|/(test|tests|__tests__|e2e|test-helpers|fixtures)/|\.snap$|\.d\.ts$|\.(png|webp|jpe?g|gif|ico|svg|woff2?|ttf|otf|mp3|wav)$'

out=$(mktemp -d)
git ls-files -z -- "$@" | { grep -zvE "$exclude" || true; } | tar --null -T - -cf - | tar -xf - -C "$out"
printf '%s %s\n' "$src_sha" "$src_ref" > "$out/MIRROR_SOURCE"
echo "$repo: $(find "$out" -type f | wc -l) files from $src_ref@${src_sha:0:9}"

if [ -n "${DRY_RUN:-}" ]; then echo "$out"; exit 0; fi

if [ -n "${GRAPHIFY_MIRROR_TOKEN:-}" ]; then
  url="https://x-access-token:$GRAPHIFY_MIRROR_TOKEN@github.com/$repo.git"
else
  url="https://github.com/$repo.git"
fi
cd "$out"
git init -q -b main
git config core.autocrlf false
git config core.longpaths true
git add -A
git -c user.name="Sharklet mirror" -c user.email="sharklet-mirror@users.noreply.github.com" \
  commit -qm "Mirror of $src_ref@$src_sha"
git push -q --force "$url" main
