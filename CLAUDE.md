# Sharklet fork: rules for every session

## Premise (mandatory)

Sharklet is **its own app built from OpenClaw**, not a lightly modified OpenClaw (ADR-007, `../Open Claw Wrapper/docs/adr/ADR-007-sharklet-app-propia.md`).

- Any file in this repo can change: gateway, UI, protocol, configuration, scripts and tests. There is no allowlist.
- **Nothing in Sharklet is built as an OpenClaw plugin.** Everything is integrated into the source. OpenClaw's plugin system stays only as a user-facing feature (Connections).
- Pick the best design for Sharklet, not the smallest diff against upstream. If a change breaks an upstream test, update the test.
- Do not route around upstream code (CSS specificity, `!important`, elements registered ahead of the original, `Object.assign` on shared objects, strings overwritten at runtime) when the file can be edited.
- `AGENTS.md` is upstream's contribution guide, imported below. **When it conflicts with these rules, Sharklet's rules win.**
- Snapshot, rebase, build and deploy procedure: `SHARKLET.md`.

@AGENTS.md

## Pace and method

- Roadmap and pace rules: "Hoja de ruta acelerada" in `../Open Claw Wrapper/docs/plan-ui-fases.md`. **Scope is frozen:** a new idea goes to `../Open Claw Wrapper/docs/ideas.md`, not to the plan or an ADR.
- Working method, models and habits: `../Open Claw Wrapper/docs/metodo-de-trabajo.md`.

## Graphify (mandatory)

Graphify indexes this repo (`fmorales2007/sharklet-openclaw`). Use it in **every** session and for any question about the code or structure.

- Before `grep`, `Glob` or blind file reads, query Graphify (`mcp__…__graphify_*`, `query_graph`, `impact_and_risk`). If its tools are deferred, load them with ToolSearch.
- Definition: `graphify_find`. How it works: `query_graph`. Callers/callees: `graphify_callers` / `graphify_callees`. What a change breaks: `graphify_impact` / `impact_and_risk`. Tests: `graphify_tests_for`. File dependencies: `graphify_file_neighbors`.
- Use `grep`/`Read` only for what the graph does not model: literal strings, comments, unindexed files, or reading an already-located file.
- The index follows the `custom` branch and excludes uncommitted changes. Compare `commitSha` from `graph_stats` with `git rev-parse HEAD`; if they differ, verify in the real file before asserting anything.
- If Graphify does not respond, tell the user and continue with normal tools; never skip it silently.

## Not visible in config

- In Git Bash use `corepack pnpm`, not bare `pnpm`.
- On Windows run UI tests with `test/vitest/vitest.ui.config.ts`; `ui/vitest.config.ts` hangs.
- The fork's skills are read by path: `.agents/skills/<skill>/SKILL.md`.
- No secrets in files or commits.
