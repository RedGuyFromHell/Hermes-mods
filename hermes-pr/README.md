# hermes-pr

A pane for the branch's pull request: the PR as a link, five status lines with a green check or a red cross, and the buttons to merge it, fix it or close it from the chat. Built for Hermes, where `/ship` has the Clean Historian open the PR with `gh pr create` and the app has no PR pane of its own.

**Built 2026-10-11** from the plan below, which Andrei approved in chat (a pane, not a band card). Colours are hermes-band's. Commands: `/pr` opens or refreshes the pane, `/pr hide` keeps it from opening by itself this session. Install from the marketplace: `/plugin install hermes-pr --marketplace RedGuyFromHell/Hermes-mods`; on Andrei's machine it loads through `CLAUDE_CODE_PLUGIN_DIRS`.

Checked with the app's engine (2.1.295): `claude plugin validate`, `tsc -p` (with `--max-old-space-size=12288`, the engine's types are large), and `claude plugin test` (7 tests: the helpers, the pane on both surfaces, merge and close with their confirm step, fix PR, a green PR, no PR, main, the refresh after a push).

## What it shows

```
 #344 feat(ship): the Clean Historian opens the PR ...          open on GitHub ↗
 main ← ship-via-gh · open · refreshed 12s ago · ↻

 ✓ CI green                                                      [ merge ]
 ✗ CI: The job was not started because recent account payments   [ fix PR ]
   have failed or your spending limit needs to be increased       [ close PR ]
 ✓ no conflicts with main
 ✓ up to date with main
 ✓ clear of the other open PRs
 ✓ review: none required
 merged · release with: node release/release.mjs
```

- **Top row:** the number and title on the left; on the right a `Link` to the PR (`href` the PR's URL, the desktop draws an anchor, the terminal an OSC 8 span).
- **Second row:** base ← head, the PR's state (`open`, `draft`, `merged`, `closed`), when the pane last refreshed, and the reload button `↻`.
- **Five status lines**, each `✓` (green) or `✗` (red), a `…` (dim) while unknown:
  1. **CI.** From `gh pr view --json statusCheckRollup`: green when every check concluded `SUCCESS` (or `SKIPPED`/`NEUTRAL`), pending while one runs, red otherwise. When red, the line carries the reason: the failing check's name, and for a job that never started, the annotation text (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`, the id from the rollup's `detailsUrl`). The billing refusal of 2026-10-11 is exactly the case the reason exists for.
  2. **No conflicts with main.** `mergeable` from `gh pr view`: `MERGEABLE` green, `CONFLICTING` red, `UNKNOWN` dim (GitHub is still computing).
  3. **Up to date with main.** `git rev-list --count HEAD..origin/main`; zero is green, else red with the count. `git fetch origin main` runs only on the reload button, so the timer does no network work of its own beyond `gh`.
  4. **Clear of the other open PRs.** `node release/pr-conflicts.mjs` (exit 0 green, 2 red with the pairs it printed, 1 red "conflicts with main"). Only when the file exists in the repo; otherwise the line is not drawn. This is the one line GitHub cannot show.
  5. **Review.** `reviewDecision`: `APPROVED` green, `CHANGES_REQUESTED` red, `REVIEW_REQUIRED` red "a review is required", empty green "none required" (the repo requires no reviewer today).
- **Note line** at the bottom: the last action's result (`merged #344`, or `gh`'s refusal, one line), and after a merge the release reminder, because merging deploys nothing in Hermes.
- **Buttons**, a column anchored right:
  - `merge`: two-step (`merge #344 into main? [yes] [no]`, like the band's stop-orphans). Runs `gh pr merge <n> --merge` (a merge commit, as every PR so far; no `--delete-branch`, the release script deletes the branch after `prod` moves). `variant="primary"` when every line is green; with a red line it still works (the person's call), the confirm text says what is red.
  - `fix PR`: drawn only while a line is red or the PR is behind. Queues one prompt to this session (`$.prompt.submit`): the PR number and URL, the red lines verbatim, and the ask: merge `origin/main` in if behind or conflicting, run `node checks/check.mjs`, push, say what changed. The session does the work in a turn of its own; the pane refreshes after its `git push`.
  - `close PR`: two-step. `gh pr close <n>`. The one button that throws work away, so its confirm names the PR title.
- The pane shows "no pull request on `<branch>`" when `gh pr view` finds none, and nothing at all on `main`/`prod`.

## How it works

- **Data** comes from `$.process.run` in `$.session.cwd()` (a worktree has its own branch, so the pane follows the session's tree): `git rev-parse --abbrev-ref HEAD`; `gh pr view --json number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup`; `gh repo view --json nameWithOwner` once; the two git and node commands above. `gh` is on PATH (winget, user scope) and logged in. No `$.mcp` call: the app's `ccd_pr` tools exist only in the desktop app, and `gh` works on every surface.
- **State** lives in `$.state` under the contract in `types/index.d.ts` (a hot reload keeps it): `pr: PrView | null`, `confirm: 'merge' | 'close' | null`, `busy: string | null` (the action running, so a button is not pressed twice), `note: string | null`, `refreshedAt: number`. `PrView` is a plain record: the fields above plus `ci: { state, failing: string[], reason: string | null }`, `behind: number | null`, `siblings: { state, detail } | null`, `branch`.
- **Refresh** runs: at `session.start`; every 60 s from `$.clock.every` (skipped while `busy` or while the pane is not placed); on `↻` (with the fetch); and after any Bash/PowerShell `tool.call` whose command matches `gh pr (create|merge|close|ready)` or `git push` (so the pane is current the moment `/ship`'s Historian opened the PR).
- **Opening**: `$.ui.open({ id: 'hermes-pr', title: 'PR' })` on `/pr`, and by itself once per session when a refresh first finds an open PR (the agents pane's `AUTO_OPENED` pattern). `/pr` reopens or refreshes; `/pr hide` closes nothing (the person closes a pane) but stops the auto-open for the session.
- **Drawing**: one `ui.render` hook on `{ component: 'Pane', requestId: 'hermes-pr' }`; `const { Box, Text, Button, Link } = $.ui.resolve(e)`; a row `Box` with a left column (`flexGrow`) and a right column of `Button`s; sized to `e.props.bodyColumns`; hermes-band's colours (`C.good`, `C.bad`, `C.warn`, `C.dim`). A render hook never writes state: every press goes through `update($, ...)` from its handler.
- **Actions** run `gh` through `$.process.run` with `timeoutMs: 60000`, set `busy` first, write the result to `note`, toast it, and refresh.

## Files

```
hermes-pr/
  .claude-plugin/plugin.json      name, version 0.1.0, description, "types": "./types/index.d.ts"
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              the module: refresh, the actions, /pr, the pane
  hooks/pr.test.tsx               the tests (claude plugin test)
  types/index.d.ts                PrView and the PluginState contract under 'hermes-pr'
  tsconfig.json                   extends the engine's, like hermes-band's
  README.md                       this file
```

Pure, exported and tested on their own: `parsePr(json: string): PrView | null` (the `gh pr view` JSON to the record), `ciOf(rollup)` (the five-way CI state and the failing names), `jobIdOf(detailsUrl)`, `siblingsOf(exitCode, stdout)`, `statusLines(view)` (the five lines as `{ ok, text }`), `fixPrompt(view)` (the text `fix PR` submits).

## Slices, in order

1. **The pane reads.** Manifests, contract, `/pr`, the refresh with `gh pr view`, the title row with the `Link`, the reload button, the CI / conflicts / review lines, "no PR on this branch". `claude plugin validate`, `tsc -p hermes-pr`, the first tests (parsePr, ciOf, a render with a fake `process.run` answering canned JSON; assert on the drawn text, `✓`/`✗` per line).
2. **The two git lines.** Behind-main and the sibling check through `pr-conflicts.mjs`, each drawn only where it applies; the 60 s timer; the refresh after `gh pr` / `git push` tool calls; the auto-open.
3. **The buttons.** merge and close with their two-step confirm and `busy`; `fix PR` with `$.prompt.submit`; the note line and the release reminder. Tests: press merge → confirm → yes → the fake recorded `gh pr merge 344 --merge`; press fix → the fake `prompt.submit` got the red lines; a second press while busy does nothing.
4. **Wire-up.** `marketplace.json` entry; the folder added to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (an interactive session watches and hot-reloads it); the repo README's mod list; a memory note. In the Hermes repo, one line in `.claude/commands/ship.md` step 7: the pane opens by itself after the Historian's `gh pr create`, and `bind_pr` stays for the app's CI bar.

Slice 1 and 2 are one PR of the mods repo if they land the same day; 3 can follow on its own.

## Verification

- `claude plugin validate D:\Projects\hermes-mods\hermes-pr`, `tsc -p D:\Projects\hermes-mods\hermes-pr`, `claude plugin test D:\Projects\hermes-mods\hermes-pr`, each with the app's newest `claude.exe` (under `%AppData%\Claude\claude-code\`; the `claude` on PATH is older).
- Live: a new session on a branch with an open PR (`ship-via-gh`, #344) shows the pane with the billing refusal on the CI line and `fix PR` drawn; `↻` refreshes; a branch with no PR shows the one-line message; on `main` nothing opens.
- The merge button is tried first on a throwaway PR (a one-line docs branch), never on a real one.

## Risks and open points

- **Branch protection may refuse `gh pr merge` while CI never runs** (Actions is off for billing, Andrei's call of 2026-10-11, "not worth the money"). The pane then shows `gh`'s refusal on the note line. What to do about the required check (drop it from `main`'s protection, or pay) is Andrei's decision, outside this mod. GitHub's protection API is Pro-only on a private repo, so the pane cannot read the rule; it learns it from the refusal.
- **`statusCheckRollup` can be empty** for a minute after a push; the CI line is dim "no checks yet", never green by default.
- **Two mods poll git**: hermes-band every 15 s, this one every 60 s; both read-only. The fetch stays behind the reload button.
- **The pane follows `$.session.cwd()`**: a session that `cd`s between worktrees (it should not) sees the branch of the tree it stands in.
- **Not in scope:** a release button (a `prod` deploy stays a typed command, by the house rule), a CI re-run button (CI is off), review comments, auto-merge, squash.
