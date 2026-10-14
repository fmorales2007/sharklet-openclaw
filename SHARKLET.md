# Sharklet fork of OpenClaw

This repository is a private copy of [openclaw/openclaw](https://github.com/openclaw/openclaw) (MIT, see `LICENSE`). Sharklet builds both the gateway and the Control UI from it. Plans and decisions live in the Sharklet repository: `docs/plan-ui-fases.md` and ADR-003, "Gateway y Control UI construidos desde el fork", and ADR-007, "Sharklet es una app propia construida desde OpenClaw".

## Project premise (mandatory)

Decision: ADR-007, "Sharklet es una app propia construida desde OpenClaw" (Sharklet repository, `docs/adr/`, 2026-09-26). It replaces the earlier "thin fork" rule (an allowlist of eight upstream files, pages as a feature plugin, logic as a gateway plugin).

- **Sharklet is its own app.** OpenClaw is the starting point, not a limit. Any file in this repository can change: gateway, UI, protocol, configuration, scripts and tests. There is no allowlist.
- **Nothing in Sharklet is built as an OpenClaw plugin**, neither a feature plugin nor a gateway plugin. Everything is integrated into the source. OpenClaw's plugin system stays as a user-facing feature (Connections), not as a way to build Sharklet.
- **Pick the best design for Sharklet, not the smallest diff against upstream.** If a change breaks an upstream test, update the test. When the file can be edited, do not route around upstream code with CSS specificity, `!important`, custom elements registered ahead of the original, `Object.assign` on shared objects, or strings overwritten at runtime.
- **Upstream keeps coming in while it is worth it.** Sharklet wins every conflict. The startup budget (`pnpm ui:check-performance`) stays as Sharklet's own guard; its limit can be adjusted with the reason written down.
- **Phase 1 workarounds are debt**, paid when each file is next touched, not now: `bridge.css` (specificity and `!important`), `custom/mascot.ts` (registered before the original mascot), `Object.assign` on `icons.claw`, the 22 strings in `custom/shell.ts`, and the wrapped render of the theme toggle.
- **From ADR-003, unchanged:** the gateway and the UI ship from the same `custom` commit, built in Actions, deployed with `deploy-gateway.sh` and `deploy-ui.sh` (both with rollback). The official package is never installed over this build.

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

# 5. Rebase Sharklet's work and push it. The tag is the way back if the rebase
#    goes wrong: the push below rewrites the default branch.
git tag "backup/custom-$(date -u +%Y%m%d)" custom
git rebase main custom
git push --force-with-lease origin custom

# 6. Turn Actions back on with the same policy, then disable every upstream workflow.
gh api -X PUT repos/fmorales2007/sharklet-openclaw/actions/permissions -F enabled=true -f allowed_actions=selected
gh api -X PUT repos/fmorales2007/sharklet-openclaw/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false
bash scripts/disable-upstream-workflows.sh

# 7. Check the policy came back the way it should: three active workflows, the rest disabled.
gh api repos/fmorales2007/sharklet-openclaw/actions/workflows --paginate   --jq '.workflows[] | .state' | sort | uniq -c

# 8. Run the tests on the rebased commit: the test workflow only fires on pull
#    requests, so a push straight to custom is never tested by itself.
gh workflow run sharklet-ui-tests.yml -R fmorales2007/sharklet-openclaw --ref custom

# 9. Refresh the Graphify mirrors: the push in step 5 landed while Actions was paused.
gh workflow run sharklet-graphify-mirror.yml -R fmorales2007/sharklet-openclaw --ref custom
```

Then build and deploy (below). Never use `openclaw update` or Settings -> Updates on the gateway: they install the official npm package over this build.

## Release checklist

The gateway is a single machine with one operator, so each release runs in this order:

- [ ] Snapshot and rebase, steps 1 to 8 above; tests green on the commit being shipped.
- [ ] Tag the build: `git tag sharklet-gateway-<version>-<n> && git push origin sharklet-gateway-<version>-<n>` (this starts the package workflow).
- [ ] `bash scripts/deploy-gateway.sh` — it backs up gateway state, verifies provenance, installs, restarts, and refuses to report success unless the running gateway reports the expected commit.
- [ ] `bash scripts/deploy-ui.sh` — **always after the gateway**, so the served Control UI comes from the same commit. The gateway package carries its own UI, but `gateway.controlUi.root` is what gets served.
- [ ] If the rebase changed `scripts/docker/sandbox/Dockerfile`: copy it into `infra/server/ensure-sandbox-image.sh` (docs repo) and run `FORCE=1 bash ensure-sandbox-image.sh` on the server as `claw`. Otherwise nothing: the `openclaw-sandbox:bookworm-slim` image survives deploys, and without it every non-main session fails with "Sandbox image not found".
- [ ] `openclaw doctor` on the server, and open the app from the phone and the PC.
- [ ] If anything looks wrong: `bash scripts/deploy-gateway.sh --rollback` and `bash scripts/deploy-ui.sh --rollback`.

## Upstream security

Decision: ADR-003, action item 11 (2026-10-01). `openclaw update` is off, so upstream security fixes only arrive through this fork.

- **Source:** upstream's published GitHub Security Advisories (`openclaw/openclaw`), plus its release list. Advisories come in batches and never name the fix commit. They lag the release that fixes them by a few days to about two months (the 2026-09-11 batch included 20 fixes shipped in v2026.7.1 on 2026-07-13), so releases are the earlier signal, and the monthly rebase is what keeps us from running publicly fixed bugs for long. The global GitHub Advisory Database lags months behind; do not use it.
- **When:** every Monday, about 10 minutes. The owner also watches `openclaw/openclaw` on GitHub (Watch → Custom → Releases), so an `extended-stable` release announcing a security rollup shows up by email before the advisories do.
- **Does it affect us:** only if our snapshot version is inside the advisory's vulnerable range **and** the component is in use (a channel Sharklet does not configure does not count). Same method as `.agents/skills/security-triage/SKILL.md`: the shipped tag decides, not `main`.
- **Deadline, from the Monday check that finds it** (or the release email, if that comes first): critical 48 hours, high 7 days, medium and low wait for the monthly rebase. A weekly check means a critical advisory can stay open for up to about 9 days; that is accepted (ADR-003, item 11).
- **Skipping or deferring** one that affects us is the owner's call; Claude triages and proposes. Record it below.

Every command uses the `gh` login you already have; the advisory endpoints are public.

```bash
# Version of the current snapshot (main's last commit message names the tag).
export V=$(git log -1 --format=%s main | sed -E 's/^OpenClaw v([^ ]+) upstream snapshot$/\1/')

# 1. Advisories published in the last 8 days (one day of overlap with the previous check).
SINCE=$(date -u -d "8 days ago" +%F) gh api "repos/openclaw/openclaw/security-advisories?state=published&per_page=100" --paginate \
  --jq '.[] | select(.published_at > env.SINCE) | [.published_at[:10], .severity, .ghsa_id, (.vulnerabilities[0].vulnerable_version_range // "-"), .summary] | @tsv'

# 2. Advisories whose vulnerable range includes our snapshot version (openclaw and @openclaw/* packages only).
gh api "repos/openclaw/openclaw/security-advisories?state=published&per_page=100" --paginate --jq '
  def ver: ltrimstr("v") | split("-")[0] | split(".") | map(tonumber? // 0);
  def ok(op; a; b): if op == "<" then a < b elif op == "<=" then a <= b elif op == ">" then a > b elif op == ">=" then a >= b else a == b end;
  def affects(v): split("||") | any(.[]; [scan("([<>]=?|=)? *v?([0-9][0-9A-Za-z.-]*)")] | all(.[]; ok(.[0] // "="; v | ver; .[1] | ver)));
  .[] | select(any(.vulnerabilities[]; ((.package.name // "") | test("^(@openclaw/|openclaw)"; "i")) and ((.vulnerable_version_range // "") | affects(env.V))))
  | [.published_at[:10], .severity, .ghsa_id, (.vulnerabilities[0].patched_versions // "-"), .summary] | @tsv'

# 3. Recent releases; read the notes of any extended-stable one.
gh release list -R openclaw/openclaw -L 10
```

To ship one fix ahead of the monthly rebase:

```bash
# Find the pull request that fixed it (the advisory does not say): search by the
# advisory's wording, or take the number from an extended-stable release note.
gh search prs --repo openclaw/openclaw --merged -- <two or three keywords from the summary>
SHA=$(gh pr view <number> -R openclaw/openclaw --json mergeCommit --jq .mergeCommit.oid)

# Fetch only that commit and its parent, and apply it on custom.
git switch custom && git pull --ff-only
git fetch --no-tags --depth 2 upstream "$SHA"
git cherry-pick -x "$SHA"

# Drop the shallow upstream objects, as in step 3 of the update procedure.
rm -f .git/FETCH_HEAD .git/shallow
git reflog expire --expire=now --all && git gc --prune=now -q
git rev-parse --is-shallow-repository   # must print false
git push origin custom
gh workflow run sharklet-ui-tests.yml -R fmorales2007/sharklet-openclaw --ref custom
```

Then the release checklist from "Tag the build" on. If the pull request cannot be found or the cherry-pick does not apply cleanly, abort it (`git cherry-pick --abort`) and run the full update procedure up to the patched release instead.

Skipped or deferred (date, advisory, reason, who decided):

- None yet.

## Building and deploying

| What                         | How                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway + Control UI package | `.github/workflows/sharklet-gateway-package.yml`, on Ubuntu with upstream's packager. Run it by hand or push a `sharklet-gateway-<version>-<n>` tag. |
| Install the gateway package  | `bash scripts/deploy-gateway.sh`, which picks the latest successful build (or takes `--run <id>`); `--rollback` goes back to the previous package.   |
| Control UI only              | `bash scripts/deploy-ui.sh` builds locally and switches `/srv/sharklet-ui` atomically; `--rollback` goes back to the previous release.               |
| Control UI tests             | `.github/workflows/sharklet-ui-tests.yml`, three shards on Linux, on every pull request into `custom` and on demand.                                 |

Run the scripts from Git Bash. On Windows, corepack's bare `pnpm` shim breaks under Git Bash, so bash scripts call `corepack pnpm`.

Both deploy scripts only ship commits that are on `origin/custom`, and `deploy-ui.sh` also refuses a dirty working tree, so every release can be traced back to a commit (`sharklet-build-info.txt` inside each UI release, `build-info.txt` in each package artifact).

GitHub's provenance attestation is not available for user-owned private repositories, so `deploy-gateway.sh` checks the package against two channels outside the artifact instead: the API says which commit the artifact belongs to, and the build log carries the digest the package had when it was built.

Every default is overridable by environment variable, which is how to point the scripts at another host or another checkout:

| Variable                                                  | Default                      | What it changes                                         |
| --------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `SHARKLET_GATEWAY_HOST`                                   | `openclaw.tail438e44.ts.net` | Gateway host, reached over the tailnet                  |
| `SHARKLET_GATEWAY_USER` / `SHARKLET_SERVICE_USER`         | `ubuntu` / `claw`            | SSH user and the user the gateway runs as               |
| `SHARKLET_SSH_KEY`                                        | `~/.ssh/openclaw_oracle`     | SSH key                                                 |
| `SHARKLET_KEEP_RELEASES`                                  | `5`                          | Releases kept for rollback (must be a positive integer) |
| `SHARKLET_ALLOW_ANY_SOURCE` / `SHARKLET_ALLOW_ANY_COMMIT` | `0`                          | Deploy something that is not on `origin/custom`         |

## GitHub Actions policy

Actions only runs `sharklet-*.yml` workflows. The upstream workflows (105 in `v2026.9.4`) stay disabled: many run on push, pull request or cron, and some use macOS runners, which bill private repositories at 10x. The only allowed actions are GitHub's own `actions/*`, pinned by commit SHA.

Step 6 restores this by hand, and there is a window of a few seconds between enabling Actions and disabling upstream's workflows in which a `schedule:` trigger could fire. That is accepted: the disable API needs Actions enabled. Step 7 is what catches a policy that did not come back.

Checks that run:

- `sharklet-ui-tests.yml`: the Control UI suite, in 3 shards, on every pull request to `custom`.
- `sharklet-checks.yml`: `scripts/sharklet-scan.sh` first, then `pnpm lint:sharklet` (UI copy baseline and oxlint on `ui/`; whole-repo `pnpm lint` takes over 30 minutes on a hosted 2-vCPU runner, and stylelint waits on `ui/src/custom/theme/*.css`), `pnpm tsgo:ui` and `pnpm tsgo:core`, on every pull request to `custom` (or by hand with `gh workflow run`).
- `sharklet-gateway-package.yml`: the same scan, before the build.

The scan has three parts: production dependency advisories (`scripts/pre-commit/pnpm-audit-prod.mjs`, high and critical), committed private keys, and the OpenGrep rules in `security/opengrep/` (severity ERROR, `ui/` included). Limits: it does not cover dev dependencies, and the rules mostly describe gateway-side weaknesses, so they say little about client code. The opengrep binary is downloaded at a fixed version and checked against its SHA256, not installed through an action. Agent-facing rules live in `SHARKLET-SECURITY.md`.

Budget: 2,000 Actions minutes a month. Every push to an open pull request runs the UI tests and the checks, so measured minutes per run are recorded in the F1-08 task evidence.

## Loops

Since 2026-10-13 the roadmap tasks run unattended, after Karpathy's autoresearch: a fresh session per attempt, machine gates, an independent Codex audit, and git as a ratchet. The sessions are Claude Desktop scheduled routines ("Sharklet · Loop A", "Loop B", "Planes"); the method, the autonomy levels (L0 to L3), the task fields and daily use live in the docs repo, `docs/loops/README.md`.

- `scripts/sharklet-loop.mjs`: the runner. It picks the work, prepares the worktree and judges the result; the routine's session does the work in between. Loop A is `next` → work → `check`, which keeps, asks for a fix (twice at most) or discards. Loop B is `metric-next` → one experiment → `metric-check`, then `metric-deliver`. L1 plans are `plan-next` → plan → `plan-save`. `status`, `approve` and `retry` manage tasks, and `wait` waits for a backgrounded command. Every command ends with `[loop] result: …`. Worktrees go to `C:/dev/sharklet-loops` (outside OneDrive). `SHARKLET_LOOP_DRY=1` rehearses without pushing, opening PRs, running CI or committing docs.
- `scripts/sharklet-audit.sh`: Codex CLI in a read-only sandbox reviews a diff (`--base`, `--commit` or `--uncommitted`) and writes findings shaped by `scripts/sharklet-audit.schema.json`. Exit 1 means critical or high findings, 2 that it did not run. Codex reads `AGENTS.md` but not `CLAUDE.md`, so the script passes `CLAUDE.md` and `SHARKLET-SECURITY.md` in the prompt. The phase closing audits (`-X`) use it too. Its quota is the operator's ChatGPT plan; `docs/loops/settings.json` (`audit`: `codex`, `when-available` or `off`) decides what a loop does without it.
- `scripts/sharklet-metric.mjs`: the numbers the metric programs lower (`startup-bytes`, `openclaw-residual`).

What the runner enforces:

- `next`, `plan-next` and `metric-next` refuse to start work while the server key logs in unattended (`ssh -o BatchMode=yes … true` succeeds): give it a passphrase and empty ssh-agent before a loop.
- A commit touching `.github/`, `scripts/sharklet-*`, `CLAUDE.md`, `SHARKLET-SECURITY.md`, `AGENTS.md`, `.claude/`, `.mcp.json` or `.agents/` never reaches CI: it stays in a local `loop-review/<branch>` and the task is blocked for a person.
- `check` judges with the task settings `next` snapshotted, and keeps only the session's report fields of its own task in `tasks.json`.
- Gate and metric commands must be repo scripts (`node scripts/…` or `corepack pnpm <script>`, joined with `&&`). Prompts, templates, programs and settings are read as committed in the docs repo.
- The runner pushes only after the gates, to the task's branch or to `loop-candidate/*`, never to `custom`. It merges without a person only a metric PR into a `phase-*` branch, which the phase's `-X` audits again.
- CI runs once per kept task, against the 2,000-minute budget above; `ci: off` in `docs/loops/settings.json` stops that.

Accepted residual risk: a Desktop session runs as the operator, with the operator's git and `gh` credentials, so a session that ignored its routine could push around the gates. Auto permission mode and the routine's rules stand in the way; a separate Windows user or a VM is the hard boundary if that ever matters. The server stays out of reach while its key needs a passphrase.

## Graphify mirrors

Graphify Cloud's Free plan caps a graph at 25,000 nodes per repository, and this fork is several times that. Graphify indexes slim private mirrors instead, one commit each with no history, rebuilt by `sharklet-graphify-mirror.yml` on every push to `custom` or a `phase-*` branch. The last push wins: a phase branch carries `custom` merged in, and holds the work in progress until it lands. A branch only triggers it once it has the workflow file, that is, once it has merged a `custom` that includes it.

| Mirror                                   | Paths                       |
| ---------------------------------------- | --------------------------- |
| `fmorales2007/sharklet-openclaw-ui`      | `ui`                        |
| `fmorales2007/sharklet-openclaw-gateway` | `src/gateway`, `src/shared` |

A mirror keeps this repository's paths and holds production code only: tests and their helpers (`*.test-support.ts`, `test-helpers.*.ts`…), fixtures, snapshots, `.d.ts` files, images and fonts are left out. `MIRROR_SOURCE` at its root records the commit and branch it came from. Keep each mirror under about 20,000 nodes (`ui` was 17,193 at the first build); a new area goes to a new mirror, not into an existing one.

The workflow needs the `GRAPHIFY_MIRROR_TOKEN` secret: a fine-grained token with Contents read and write on the mirror repositories only. To rebuild a mirror by hand, from the repository root: `bash scripts/sharklet-graphify-mirror.sh ui ui` (`DRY_RUN=1` builds the tree and only prints its size). On Windows, set `TMPDIR` to a short path first: a long one breaks `git add`.

## Workarounds still in the fork

Phase 1 was built under the old thin-fork rule (ADR-007), so some Sharklet code works around upstream instead of editing it. Pay each one when you touch the upstream file in the right-hand column: edit that file, delete the workaround, and move its row to "Paid". Checked at `364532876b` (`phase-1-identity`), updated by the F1-X fixes; line numbers drift, so re-check them with `git grep` before editing. The graph does not see calls made for their side effect (`replaceClawGlyph` shows no callers), so a rename in upstream fails without notice for the "silent" rows. Check every row against the upstream diff at each rebase.

Pending (11):

| #   | Workaround                                                                                                    | In the fork                                               | Upstream file to edit instead                                                                                                                                                                                     | If upstream renames it                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Our `<openclaw-mascot>` is defined first so upstream's is never registered                                    | `ui/src/custom/mascot.ts:6,139-142`, `custom/index.ts:23` | `ui/src/components/openclaw-mascot.ts:233` (class and guard), `mascot-pose.ts`                                                                                                                                    | Loud: without the guard the second `define` throws                                                                                     |
| E2  | `Object.assign(icons, { claw })` swaps the animated claw for the shark                                        | `custom/mascot.ts:132-135`, `custom/index.ts:24`          | `ui/src/components/icons-tools.ts:155`; readers `settings-save-indicator.ts:59`, `pages/chat/components/chat-background-tasks-status.ts:143`, `chat-subagent-activity.ts:102`, `chat-working-indicator.ts:85,146` | Silent: the claw comes back                                                                                                            |
| E4  | `i18n.getSystemLocale` reassigned so "system" means English                                                   | `custom/shell.ts:41`                                      | `ui/src/i18n/lib/translate.ts:130`                                                                                                                                                                                | Silent: an es-CL browser opens in Spanish                                                                                              |
| E5  | `openclaw.i18n.locale` seeded with "en" before i18n reads it                                                  | `custom/locale.ts:13-19`                                  | `translate.ts:71` (initial read); same edit as E4                                                                                                                                                                 | Silent: first paint in Spanish                                                                                                         |
| E7  | Discord card and lobster pet hidden by CSS                                                                    | `custom/theme/shell.css:68`                               | `ui/src/components/app-sidebar.ts:652-665` (the div and `openclaw-lobster-pet`), `:79` (idle import)                                                                                                              | Silent: the card reappears. Hidden, still loaded                                                                                       |
| E8  | User chat bubble neutral by specificity (0,6,1)                                                               | `custom/theme/chat.css:16,20`                             | `ui/src/styles/chat/grouped.css:1043`                                                                                                                                                                             | Silent: the sienna tint returns                                                                                                        |
| E9  | Icon stroke 1.5 by a selector that matches upstream's icon shell                                              | `custom/theme/icons.css:16`                               | `ui/src/components/icons-tools.ts:8` (`strokeIcon`, `stroke-width="2"`)                                                                                                                                           | Silent: two stroke weights                                                                                                             |
| E10 | The token bridge rewrites 351 upstream tokens and wins a specificity tie by import order                      | `custom/theme/bridge.css:11-20,28-29,226-227,233,268`     | `ui/src/styles/base.css` (token values), `ui/src/app/theme.ts`                                                                                                                                                    | Silent, and the widest: a new token or a more specific block upstream is simply not themed                                             |
| E11 | Pre-paint colors kept at upstream's values because a test pins them                                           | `ui/index.html:65-70`                                     | `ui/src/styles/base-theme-tokens.node.test.ts` (ADR-007 item 5: change the test)                                                                                                                                  | A flash before the stylesheet in light mode                                                                                            |
| E12 | The "?" button is mounted on `body` and hidden with `:has()`                                                  | `custom/shell.ts:21-33`, `custom/theme/shell.css:50-63`   | `ui/src/app/app-shell-view.ts`                                                                                                                                                                                    | Silent. Not paid in F1-X: it hides while a docked panel is open, a state each panel keeps to itself; paying needs the shell to know it |
| E13 | Fonts load as `preload` and become a stylesheet on arrival, to keep upstream's watcher from reloading the app | `custom/fonts.ts:23-33`                                   | `ui/src/app/stale-chunk-reload.ts:317` (`installMissingStylesheetRecovery`), or `@font-face` in CSS                                                                                                               | Loud: a failed font link reloads the app                                                                                               |

Paid:

| Workaround                                                                                                    | Paid in                                                    |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 15 `!important` and the extra specificity in `bridge.css` (theme sheets, tweakcn, inline accent and typeface) | F1-10: `ac1a67f2`, `7843d9e8`, `36453287`                  |
| 22 brand strings overwritten from `shell.ts`                                                                  | F1-05: `0ed034b6` (merge `ad26b189`); they live in `en.ts` |
| One-tap Help row on phones; accent and typography pickers                                                     | F1-09: `0895640e`                                          |
| E3: `Object.assign(icons, { lobster })`; the Help readers draw `circleQuestionMark` themselves                | F1-X: `4d3d81f7`                                           |
| E6: the density switch wrapped `openclaw-theme-mode-toggle`'s render; it is now its own element in the menu   | F1-X: `4d3d81f7`                                           |
| E14: one `!important` against inline skeleton heights; the heights are in `board.css`                         | F1-X: `4d3d81f7`                                           |
| CSS hiding upstream's welcome in Home's composer (found by F1-X); `composerOnly` on the new-session page      | F1-X: `4d3d81f7`                                           |
| The `pluginId === "sharklet"` case in the board's plugin gate (found by F1-X); `builtIn` on the widget entry  | F1-X: `4d3d81f7`                                           |

## Change history

- 2026-10-06 (F1-X fixes): E3, E6 and E14 paid, plus two workarounds the audit found; E12 noted as not paid.
- 2026-10-04 (F1-11): added "Workarounds still in the fork".
- 2026-10-03 (F1-08): `sharklet-checks.yml` (lint, typecheck, scan), the scan before the gateway package build, and `SHARKLET-SECURITY.md`.
- 2026-10-01 (PRE-X audit): "Upstream security" corrected: advisories can lag the fix by two months, deadlines count from detection, the advisory window is computed, and the range check skips other packages.
- 2026-10-01: added "Upstream security" (ADR-003, item 11): source, weekly check, deadlines by severity, and how to ship one fix ahead of the rebase.
- 2026-09-26: added the project premise (ADR-007). It replaces the thin-fork rule; the snapshot, rebase, build and deploy procedure is unchanged.
