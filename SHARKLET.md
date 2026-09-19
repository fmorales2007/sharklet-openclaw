# Sharklet fork of OpenClaw

This repository is a private copy of [openclaw/openclaw](https://github.com/openclaw/openclaw) (MIT, see `LICENSE`). Sharklet builds both the gateway and the Control UI from it. Plans and decisions live in the Sharklet repository: `docs/plan-ui-fases.md` and ADR-003, "Gateway y Control UI construidos desde el fork".

## Branches

| Branch    | Holds                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `main`    | One snapshot commit per upstream release, with no upstream history. Each commit message records the upstream tag and commit SHA. |
| `custom`  | Sharklet's work on top of the latest snapshot. It is the default branch, and phase branches open pull requests against it.       |
| `phase-*` | One branch per phase of the plan.                                                                                                |

The upstream history is not copied: GitHub rejects pushes from shallow clones, and the full history is over 2.5 GB. The `upstream` remote only tracks `main`: `git config remote.upstream.fetch "+refs/heads/main:refs/remotes/upstream/main"`. Upstream has thousands of branches and pull-request refs, so never clone it with `--mirror`.

## Updating to a new upstream release

```bash
# 1. Fetch the release tag without history (upstream sometimes re-cuts tags, so record the SHA).
#    --no-tags matters: auto-followed tags would keep the shallow upstream commit alive.
git fetch --no-tags --depth 1 upstream refs/tags/vX.Y.Z:refs/tags/upstream-vX.Y.Z
UP=$(git rev-parse "upstream-vX.Y.Z^{commit}")

# 2. Add it to main as a snapshot commit on top of the previous one.
S=$(git commit-tree "upstream-vX.Y.Z^{tree}" -p main -m "OpenClaw vX.Y.Z upstream snapshot

Tree of openclaw/openclaw at tag vX.Y.Z, commit $UP.")
git branch -f main "$S"

# 3. Drop the shallow upstream commit (the snapshot keeps its tree and files).
#    gc never prunes a commit listed in .git/shallow, so remove that file first.
git tag -d upstream-vX.Y.Z
rm -f .git/FETCH_HEAD .git/shallow
git reflog expire --expire=now --all && git gc --prune=now -q
git rev-parse --is-shallow-repository   # must print false
git fsck --connectivity-only            # must print nothing but "Checking ..."

# 4. Pause Actions while the snapshot lands: a workflow file that is new upstream
#    is enabled by default and would react to this very push.
gh api -X PUT repos/fmorales2007/sharklet-openclaw/actions/permissions -F enabled=false
git push origin main

# 5. Rebase Sharklet's work and push it.
git rebase main custom
git push --force-with-lease origin custom

# 6. Turn Actions back on with the same policy, then disable every upstream workflow.
gh api -X PUT repos/fmorales2007/sharklet-openclaw/actions/permissions -F enabled=true -f allowed_actions=selected
gh api -X PUT repos/fmorales2007/sharklet-openclaw/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false
bash scripts/disable-upstream-workflows.sh
```

Then build and deploy (below). Never use `openclaw update` or Settings → Updates on the gateway: they install the official npm package over this build.

## Building and deploying

| What                         | How                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway + Control UI package | `.github/workflows/sharklet-gateway-package.yml`, on Ubuntu with upstream's packager. Run it by hand or push a `sharklet-gateway-<version>-<n>` tag. |
| Install the gateway package  | `bash scripts/deploy-gateway.sh`, which picks the latest successful build (or takes `--run <id>`); `--rollback` goes back to the previous package.   |
| Control UI only              | `bash scripts/deploy-ui.sh` builds locally and switches `/srv/sharklet-ui` atomically; `--rollback` goes back to the previous release.               |
| Control UI tests             | `.github/workflows/sharklet-ui-tests.yml`, three shards on Linux, on every pull request into `custom`.                                               |

Run the scripts from Git Bash. On Windows, corepack's bare `pnpm` shim breaks under Git Bash, so bash scripts call `corepack pnpm`.

## GitHub Actions policy

Actions only runs `sharklet-*.yml` workflows. The upstream workflows (105 in `v2026.9.4`) stay disabled: many run on push, pull request or cron, and some use macOS runners, which bill private repositories at 10×. The only allowed actions are GitHub's own `actions/*`, pinned by commit SHA.
