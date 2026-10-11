# hermes-pr

A card above hermes-band for the branch's pull request: the PR as a link, five status chips with a green check or a red cross, and the buttons to merge it, fix it or close it from the chat. Built for Hermes, where `/ship` has the Clean Historian open the PR with `gh pr create` and the app has no PR pane of its own.

**Built 2026-10-11.** The first cut was a pane; Andrei looked at it live and asked for a card above the band instead, in the band's colours. It draws only while the branch has a PR, so on `main` or a branch without one nothing changes. Commands: `/pr` reads the PR again, `/pr hide` and `/pr show`. Install from the marketplace: `/plugin install hermes-pr --marketplace RedGuyFromHell/Hermes-mods`; on Andrei's machine it loads through `CLAUDE_CODE_PLUGIN_DIRS`.

Checked with the app's engine (2.1.295): `claude plugin validate`, `tsc -p` (with `node --max-old-space-size=12288`, the engine's types are large), and `claude plugin test` (8 tests: the helpers, the card on both surfaces above what the engine drew, merge and close with their confirm step, fix PR, a green PR, no PR and main, hide and show, the refresh after a push).

## What it shows

```
 ⎇ #344 feat(ship): the Clean Historian opens the PR ... · open · 12s ago   open on GitHub ↗  ↻
 ✗ CI failed: check · ✓ no conflicts with main · ✗ 9 behind main · ✓ clear of the other open PRs · ✓ review: none required     merge
   The job was not started because recent account payments have failed or your spending limit needs to be increased   fix PR
                                                                                                                       close PR
 ⎇ ship-via-gh 9535ff36 · main tree · ...                                   (hermes-band, beneath)
```

- **First row:** the number and title, the PR's state (`open`, `draft`, `merged`, `closed`), when the card last read it; at the right a `Link` to the PR (the desktop draws an anchor, the terminal an OSC 8 span) and the reload button `↻`.
- **Second row, five chips**, each `✓` (green) or `✗` (red), `…` (dim) while unknown:
  1. **CI.** From `gh pr view --json statusCheckRollup`: green when every check concluded `SUCCESS` (or `SKIPPED`/`NEUTRAL`), pending while one runs, red otherwise. When red, the reason goes on the third row: for a job that never started, the annotation text (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`, the id from the rollup's `detailsUrl`). The billing refusal of 2026-10-11 is exactly the case the reason exists for.
  2. **No conflicts with main.** `mergeable` from `gh pr view`: `MERGEABLE` green, `CONFLICTING` red, `UNKNOWN` dim (GitHub is still computing).
  3. **Up to date with main.** `git rev-list --count HEAD..origin/main`; zero is green, else red with the count. `git fetch origin main` runs only on `↻` and `/pr`, so the timer does no network work of its own beyond `gh`.
  4. **Clear of the other open PRs.** `node release/pr-conflicts.mjs --no-fetch` (exit 0 green, 2 red with the pairs it printed, 1 red "conflicts with main"). Only when the repo has the script; otherwise the chip is not drawn. This is the one line GitHub cannot show.
  5. **Review.** `reviewDecision`: `APPROVED` green, `CHANGES_REQUESTED` red, `REVIEW_REQUIRED` red "a review is required", empty green "none required" (the repo requires no reviewer today).
- **Third row** (only when something red has a reason): the reasons, dim, one line.
- **Note row:** the last action's result (`merged #344`, or `gh`'s refusal, one line), and after a merge the release reminder, because merging deploys nothing in Hermes.
- **Buttons**, stacked at the right:
  - `merge`: two-step (`merge #344 into main? [yes] [no]`, like the band's stop-orphans). Runs `gh pr merge <n> --merge` (a merge commit, as every PR so far; no `--delete-branch`, the release script deletes the branch after `prod` moves). `variant="primary"` when every chip is green; with a red one it still works (the person's call), the confirm says how many are red.
  - `fix PR`: drawn only while a chip is red. Queues one prompt to this session (`$.prompt.submit`): the PR number and URL, the red lines verbatim, and the ask: merge `origin/main` in if behind or conflicting, run `node checks/check.mjs`, push, say what changed. The session does the work in a turn of its own; the card refreshes after its `git push`.
  - `close PR`: two-step. `gh pr close <n>`. The one button that throws work away.

## How it works

- **Data** comes from `$.process.run` in `$.session.cwd()` (a worktree has its own branch, so the card follows the session's tree): `git rev-parse --abbrev-ref HEAD`; `gh pr view --json number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup`; `gh repo view --json nameWithOwner` when a check failed; the git and node commands above. `gh` is on PATH (winget, user scope) and logged in. No `$.mcp` call: the app's `ccd_pr` tools exist only in the desktop app, and `gh` works on every surface.
- **State** lives in `$.state` under the contract in `types/index.d.ts` (a hot reload keeps it): `pr: PrView | null`, `branch`, `confirm: 'merge' | 'close' | null`, `busy` (the action running, so a button is not pressed twice), `note`, `refreshedAt`, `hidden`.
- **Refresh** runs: at `session.start`; every 60 s from `$.clock.every` (skipped while `busy`); on `↻` and `/pr` (with the fetch); and after any Bash or PowerShell `tool.call` whose command matches `gh pr (create|merge|close|ready|reopen)` or `git push`, awaited in the hook (a few seconds, after a rare command) so the card is current the moment `/ship`'s Historian opened the PR.
- **Drawing**: one `ui.render` hook on `AbovePrompt`. It calls `next(e)` first, so the mods beneath (hermes-band among them) draw, and puts the card above what they drew; with no PR, hidden, or under a survey it passes the draw on untouched. `const { Box, Text, Button, Link } = $.ui.resolve(e)`; a row `Box` with the rows on the left (`flexGrow`) and the buttons in a column on the right. A render hook never writes state: every press goes through `update($, ...)` from its handler.
- **Actions** run `gh` through `$.process.run` with `timeoutMs: 120000`, set `busy` first, write the result to `note`, toast it, and refresh.

## Files

```
hermes-pr/
  .claude-plugin/plugin.json      name, version 0.1.0, description, "types": "./types/index.d.ts"
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              the module: refresh, the actions, /pr, the card
  hooks/pr.test.tsx               the tests (claude plugin test)
  types/index.d.ts                PrView and the PluginState contract under 'hermes-pr'
  tsconfig.json                   extends the engine's, like hermes-band's
  README.md                       this file
```

Pure, exported and tested on their own: `parsePr(json)` (the `gh pr view` JSON to the record), `ciOf(rollup)` (the CI state and the failing names), `jobIdOf(detailsUrl)`, `siblingsOf(exitCode, stdout, stderr)`, `statusLines(view)` (the five chips as `{ ok, text, detail }`), `isGreen(view)`, `fixPrompt(view)` (the text `fix PR` submits).

## Engine facts learned building it

- A `Button` with `hover` needs a keyed `Box` around it.
- A helper that takes `$` must be a top-level function of the module, not one declared inside `register`.
- `on('tool.call', { tool })` with a union-typed `tool` breaks the matcher types: register Bash and PowerShell separately.
- The test engine has no `$.clock` (`$.clock.after` is refused, not thrown), a fake `prompt.submit` hook must return `{ text }`, and a hook that calls `next(e)` on `AbovePrompt` needs a fake beneath it (`on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['beneath'] }))`).
- `tsc -p` on a mod needs `node --max-old-space-size=12288`.

## Risks and open points

- **Branch protection may refuse `gh pr merge` while CI never runs** (Actions is off for billing, Andrei's call of 2026-10-11). The card then shows `gh`'s refusal on the note row. What to do about the required check (drop it from `main`'s protection, or pay) is Andrei's decision, outside this mod. GitHub's protection API is Pro-only on a private repo, so the card cannot read the rule; it learns it from the refusal.
- **`statusCheckRollup` can be empty** for a minute after a push; the CI chip is dim "no checks yet", never green by default.
- **Where it sits among the mods** follows the load order: a mod loaded later draws above the ones before it. With hermes-pr last in `CLAUDE_CODE_PLUGIN_DIRS` the card is on top of everything above the prompt, the savvy-progress bar included.
- **Two mods poll git**: hermes-band every 15 s, this one every 60 s; both read-only. The fetch stays behind `↻` and `/pr`.
- **Not in scope:** a release button (a `prod` deploy stays a typed command, by the house rule), a CI re-run button (CI is off), review comments, auto-merge, squash.
