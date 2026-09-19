#!/usr/bin/env bash
# Disable every upstream GitHub Actions workflow in this repository and keep
# only Sharklet's own (.github/workflows/sharklet-*.yml) enabled.
#
#   bash scripts/disable-upstream-workflows.sh            # apply
#   bash scripts/disable-upstream-workflows.sh --dry-run  # only report
#
# Upstream snapshots bring ~100 workflows; many run on push, pull_request or
# cron without a repository guard, and some use macOS runners. Run this after
# every new upstream snapshot lands on `main`, before those workflows can fire.
# Requires an authenticated `gh`.
set -euo pipefail

REPO="${SHARKLET_REPO:-fmorales2007/sharklet-openclaw}"
OWN_PREFIX=".github/workflows/sharklet-"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

disabled=0 enabled=0 kept=0
while IFS=$'\t' read -r id state path; do
  if [[ "$path" == "$OWN_PREFIX"* ]]; then
    if [[ "$state" != "active" ]]; then
      [[ "$DRY_RUN" -eq 1 ]] || gh api -X PUT "repos/$REPO/actions/workflows/$id/enable" >/dev/null
      echo "enable   $path"
      enabled=$((enabled + 1))
    fi
    kept=$((kept + 1))
  elif [[ "$state" == "active" ]]; then
    [[ "$DRY_RUN" -eq 1 ]] || gh api -X PUT "repos/$REPO/actions/workflows/$id/disable" >/dev/null
    echo "disable  $path"
    disabled=$((disabled + 1))
  fi
done < <(gh api "repos/$REPO/actions/workflows" --paginate --jq '.workflows[] | [.id, .state, .path] | @tsv')

echo
echo "Upstream workflows disabled: $disabled. Own workflows: $kept ($enabled enabled now)."
[[ "$DRY_RUN" -eq 1 ]] && echo "(dry run: nothing changed)"
exit 0
