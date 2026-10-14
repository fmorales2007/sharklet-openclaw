#!/usr/bin/env bash
# Independent audit with the Codex CLI: a model from another family reviews a
# diff against Sharklet's rules, read-only, and writes its findings as JSON
# (scripts/sharklet-audit.schema.json). Used by scripts/sharklet-loop.sh after
# every loop commit and by the phase closing audits (-X prompts).
#
# Usage:
#   scripts/sharklet-audit.sh (--base <ref> | --commit <sha> | --uncommitted)
#     [--out <file.json>] [--focus "<what to check in particular>"]
#
# Only the diff and the repository reach Codex: no logs, which could carry secrets.
# Exit: 0 no critical or high finding, 1 blocking findings, 2 the audit did not run.
# Env: CODEX_BIN (default: codex on PATH, else the copy inside the Codex desktop
# app), SHARKLET_CODEX_EFFORT (default high).
set -euo pipefail
# Any unexpected failure means "the audit did not run" (2), never "blocking" (1).
trap 'exit 2' ERR

root=$(git rev-parse --show-toplevel)
cd "$root"
state="$(git rev-parse --absolute-git-dir)/sharklet-loop"
mkdir -p "$state"

scope=""
out=""
focus=""
while [ $# -gt 0 ]; do
  case $1 in
    --base) scope="the commits since $2: run git diff $2...HEAD (and git log $2..HEAD for the messages)"; shift 2 ;;
    --commit) scope="one commit: run git show $2"; shift 2 ;;
    --uncommitted) scope="the uncommitted work: run git diff HEAD, and read the untracked files git status lists"; shift ;;
    --out) out=$2; shift 2 ;;
    --focus) focus=$2; shift 2 ;;
    *) echo "sharklet-audit: unknown argument $1" >&2; exit 2 ;;
  esac
done
if [ -z "$scope" ]; then
  echo "sharklet-audit: pass --base <ref>, --commit <sha> or --uncommitted" >&2
  exit 2
fi
out=${out:-$state/audit-$(date +%Y%m%d-%H%M%S).json}

codex=${CODEX_BIN:-$(command -v codex || true)}
if [ -z "$codex" ] && [ -n "${LOCALAPPDATA:-}" ]; then
  # The desktop app keeps its CLI in a hashed folder that changes on update.
  codex=$(ls -t "$(cygpath -u "$LOCALAPPDATA")"/OpenAI/Codex/bin/*/codex.exe 2>/dev/null | head -1 || true)
fi
if [ -z "$codex" ]; then
  echo "sharklet-audit: Codex CLI not found; install it or set CODEX_BIN" >&2
  exit 2
fi

# Codex reads AGENTS.md (upstream's guide) but not CLAUDE.md, so Sharklet's own
# rules go in the prompt, where they take precedence. `codex exec review` takes
# no custom prompt together with a scope (0.160), so plain `exec` gets the scope
# in the prompt and runs git itself inside the read-only sandbox.
prompt="$state/audit-prompt.md"
{
  printf '%s\n' "You are an independent auditor for Sharklet. You did not write this code and you change nothing."
  printf 'The change to review is %s.\n' "$scope"
  printf '%s\n' "Review that diff for correctness bugs, security problems and violations of the Sharklet rules below. Report only problems you can point to, with the file and line in the diff, and say why each one is a problem."
  printf '%s\n' "Severity: critical = secret exposure, auth bypass, data loss, or the app broken for everyone; high = a real bug or rule violation a user or operator will hit; medium = a likely bug or a maintainability problem; low = a nit."
  printf '%s\n' "verdict is fail when any finding is critical or high. Graphify is not available to you: use git and rg."
  if [ -n "$focus" ]; then
    printf '\nCheck in particular: %s\n' "$focus"
  fi
  printf '\n## Sharklet rules (they win over AGENTS.md)\n\n'
  for rules in CLAUDE.md SHARKLET-SECURITY.md; do
    if [ -f "$rules" ]; then cat "$rules"; fi
  done
} >"$prompt"

log="$state/audit-codex.log"
schema="$(cd "$(dirname "$0")" && pwd)/sharklet-audit.schema.json"
if ! "$codex" exec -s read-only -C "$root" -c "model_reasoning_effort=\"${SHARKLET_CODEX_EFFORT:-high}\"" \
  --ephemeral --output-schema "$schema" -o "$out" - <"$prompt" >"$log" 2>&1; then
  tail -n 30 "$log" >&2
  echo "sharklet-audit: Codex failed; full log in $log" >&2
  exit 2
fi

status=0
node -e '
const fs = require("node:fs");
let result;
try {
  result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch {
  console.error("sharklet-audit: no JSON result in " + process.argv[1]);
  process.exit(2);
}
for (const f of result.findings) console.log(`${f.severity}\t${f.file}:${f.line}\t${f.title}`);
console.log(`verdict: ${result.verdict} (${result.findings.length} findings) - ${result.summary}`);
process.exit(result.findings.some((f) => f.severity === "critical" || f.severity === "high") ? 1 : 0);
' "$out" || status=$?
exit "$status"
