# hermes-pr

The branch's pull request, read for hermes-band: the PR as a link, five status chips with a green check or a red cross and the reason under them, and the merge / fix PR / close PR buttons, drawn by hermes-band as **a PR band of its own, above the band**. Built for Hermes, where `/ship` has the Clean Historian open the PR with `gh pr create` and the app has no PR pane of its own.

**Built 2026-10-11.** The first cut was a pane, the second a card above the band; Andrei looked at both live and asked for the PR folded into the band itself; on 2026-10-12 he asked for it back in its own band above, drawn by hermes-band (a separate mod loaded later draws *below* the band, so the band draws both boxes). So this mod draws nothing: it reads the PR and runs the actions, and publishes the result in `$.state` under `hermes-pr`; hermes-band reads that and draws the PR band above its own, with the PR buttons on the PR band's right. Without hermes-band loaded nothing shows. Commands: `/pr` reads the PR again, `/pr merge` and `/pr close` act (the band's buttons run these after their yes), `/pr fix` puts the fix prompt in the prompt box, `/pr hide` and `/pr show`. Install from the marketplace: `/plugin install hermes-pr --marketplace RedGuyFromHell/Hermes-mods`; on Andrei's machine it loads through `CLAUDE_CODE_PLUGIN_DIRS`.

Checked with the app's engine (2.1.295): `claude plugin validate`, `tsc -p` (with `node --max-old-space-size=12288`, the engine's types are large), `claude plugin test` here (6 tests: the helpers, the state `/pr` publishes, merge and close, fix, hide and show, the refresh after a push) and in hermes-band (the PR band, the buttons and their confirm step, a merged PR and its ×, the hidden band, no PR).

## What the PR band shows

```
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ ⎇ #344 feat(ship): the Clean Historian opens the PR ... · open   open on GitHub ↗  ↻   merge  │
│ ✗ CI failed: check · ✓ no conflicts with main · ✗ 9 behind main · ✓ clear of …          fix PR │
│ The job was not started because recent account payments have failed ...               close PR │
╰──────────────────────────────────────────────────────────────────────────────────────────────╯
 ⎇ ship-via-gh 9535ff36 · ⌂ main tree · ↑0 ↓0 · ✓ clean │ no dev servers                 compact
 ◆ context 82k of 1M · 8% · compacts at 967k                                              ship
 ...                                                                                       review
```

The PR band is a rounded box in the band's amber, drawn only while the branch has a PR (and not after `/pr hide`). A merged or closed PR shrinks it to the title row and, when merged, the release reminder, with a `×` that puts that PR's band away (`hermes-band.dismissedPr`); the next PR shows again.

- **The title row:** the number and title, the PR's state (`open`, `draft`, `merged`, `closed`), a `Link` to the PR (the desktop draws an anchor, the terminal an OSC 8 span) and `↻`, which runs `/pr`.
- **Five chips**, each `✓` (green) or `✗` (red), `…` (dim) while unknown:
  1. **CI.** From `gh pr view --json statusCheckRollup`: green when every check concluded `SUCCESS` (or `SKIPPED`/`NEUTRAL`), pending while one runs, red otherwise. When red, the reason goes on the line under the chips: for a job that never started, the annotation text (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`, the id from the rollup's `detailsUrl`). The billing refusal of 2026-10-11 is exactly the case the reason exists for.
  2. **No conflicts with main.** `mergeable` from `gh pr view`: `MERGEABLE` green, `CONFLICTING` red, `UNKNOWN` dim (GitHub is still computing).
  3. **Up to date with main.** `git rev-list --count HEAD..origin/main`; zero is green, else red with the count. `git fetch origin main` runs only on `/pr` (so on `↻`), so the timer does no network work of its own beyond `gh`.
  4. **Clear of the other open PRs.** `node release/pr-conflicts.mjs --no-fetch` (exit 0 green, 2 red with the pairs it printed, 1 red "conflicts with main"). Only when the repo has the script; otherwise the chip is not drawn. This is the one line GitHub cannot show.
  5. **Review.** `reviewDecision`: `APPROVED` green, `CHANGES_REQUESTED` red, `REVIEW_REQUIRED` red "a review is required", empty green "none required" (the repo requires no reviewer today).
- **Under the chips:** the reasons (dim) when something red has one; after a merge the release reminder, because merging deploys nothing in Hermes; the last action's result (`merged #344`, or `gh`'s refusal, one line).
- **Buttons**, in the PR band's right column, only while the PR is open:
  - `merge` (hotkey m): asks first, in the title row (`merge #344 into main with 2 red? [yes] [no]`, like the band's stop-orphans). The yes runs `/pr merge`: `gh pr merge <n> --merge` (a merge commit, as every PR so far; no `--delete-branch`, the release script deletes the branch after `prod` moves). `variant="primary"` when every chip is green; with a red one it still works (the person's call).
  - `fix PR` (hotkey f): drawn only while a chip is red. The band submits the prompt hermes-pr prepared (`hermes-pr.fix`) to the session as a turn of its own: the PR number and URL, the red lines verbatim, and the ask: merge `origin/main` in if behind or conflicting, run `node checks/check.mjs`, push, say what changed. The band refreshes the PR after the session's `git push`.
  - `close PR` (hotkey x): asks first; the yes runs `/pr close`, `gh pr close <n>`. The one button that throws work away.

## How it works

- **Data** comes from `$.process.run` in `$.session.cwd()` (a worktree has its own branch, so the row follows the session's tree): `git rev-parse --abbrev-ref HEAD`; `gh pr view --json number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup`; `gh repo view --json nameWithOwner` when a check failed; the git and node commands above. `gh` is on PATH (winget, user scope) and logged in. No `$.mcp` call: the app's `ccd_pr` tools exist only in the desktop app, and `gh` works on every surface.
- **State** lives in `$.state` under the contract in `types/index.d.ts` (a hot reload keeps it): `pr: PrView | null` (with its five `lines`, so the band computes nothing), `fix: string | null` (the prompt, null while nothing is red), `branch`, `busy` (the action running, so a button is not pressed twice), `note`, `refreshedAt`, `hidden`. hermes-band declares a read-only copy of the fields it draws in its own contract, the way it does for savvy-progress.
- **Refresh** runs: at `session.start`; every 60 s from `$.clock.every` (skipped while `busy`); on `/pr` (with the fetch); and after any Bash or PowerShell `tool.call` whose command matches `gh pr (create|merge|close|ready|reopen)` or `git push`, awaited in the hook (a few seconds, after a rare command) so the row is current the moment `/ship`'s Historian opened the PR; and at every `turn.complete` and after `EnterWorktree` / `ExitWorktree` when the tree or the branch is not the one of the last read (the read at session start went stale once the session moved into a worktree, and the band showed the main tree's merged PR on the worktree's branch). A PR `gh` found whose head is not the current branch is dropped.
- **Actions** run `gh` through `$.process.run` with `timeoutMs: 120000`, set `busy` first, write the result to `note`, toast it, and refresh. `/pr merge` and `/pr close` are what the band's yes runs; typed by hand they act at once.
- **Why `fix` is state and not a command:** a slash command may not submit a prompt (it holds the turn: the engine refuses with "called from a command.run hook, it would wait on the turn this hook is holding"), but a button press may. So hermes-pr prepares the text and the band's button submits it; `/pr fix` typed by hand fills the prompt box instead and leaves the Enter to the person.

## Files

```
hermes-pr/
  .claude-plugin/plugin.json      name, version 0.1.0, description, "types": "./types/index.d.ts"
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              the module: refresh, the actions, /pr
  hooks/pr.test.tsx               the tests (claude plugin test)
  types/index.d.ts                PrView, Line and the PluginState contract under 'hermes-pr'
  tsconfig.json                   extends the engine's, like hermes-band's
  README.md                       this file
```

In hermes-band: `types/index.d.ts` (the `PullRequest` and `PrLine` copies, the read-only `'hermes-pr'` state, `confirmPr`, `dismissedPr`), `hooks/register.tsx` (the PR band, its buttons, `submitPr`, `submitFix`), `hooks/band.test.tsx` (the PR tests).

Pure, exported and tested on their own: `parsePr(json)` (the `gh pr view` JSON to the record), `ciOf(rollup)` (the CI state and the failing names), `jobIdOf(detailsUrl)`, `siblingsOf(exitCode, stdout, stderr)`, `statusLines(view)` (the five chips as `{ ok, text, detail }`), `isGreen(view)`, `fixPrompt(view)`.

## Engine facts learned building it

- The test `$` has no `$.state`: a test reads another plugin's writes by hooking `state.set` with a matcher on `plugin` and passing `next(e)`; it fakes another plugin's value with `on('state.get', { plugin, key }, () => ({ value: { value, version: 1 } }))`.
- A slash command's hook may not `$.prompt.submit` (it holds the turn); a `ui.press` handler may. `$.prompt.fill` works from either.
- `$.ui.toast` has no implementation in the test engine (the call is dropped, not thrown); wrap it anyway.
- A `Button` with `hover` needs a keyed `Box` around it.
- A helper that takes `$` must be a top-level function of the module, not one declared inside `register`.
- `on('tool.call', { tool })` with a union-typed `tool` breaks the matcher types: register Bash and PowerShell separately.
- A hook that calls `next(e)` on `AbovePrompt` needs a fake beneath it in a test (`on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['beneath'] }))`). Which mod draws above which follows the load order, and a mod loaded later drew *below* the band, not above it: one reason the PR moved into the band.
- `tsc -p` on a mod needs `node --max-old-space-size=12288`.
- The mods repo is one checkout and `CLAUDE_CODE_PLUGIN_DIRS` loads from its working tree: switching its branch changes the mods every session loads. Branch a new mod off the branch that is checked out.

## Risks and open points

- **Branch protection may refuse `gh pr merge` while CI never runs** (Actions is off for billing, Andrei's call of 2026-10-11). The row then shows `gh`'s refusal under the chips. What to do about the required check (drop it from `main`'s protection, or pay) is Andrei's decision, outside this mod. GitHub's protection API is Pro-only on a private repo, so the mod cannot read the rule; it learns it from the refusal.
- **`statusCheckRollup` can be empty** for a minute after a push; the CI chip is dim "no checks yet", never green by default.
- **Two mods poll git**: hermes-band every 15 s, this one every 60 s; both read-only. The fetch stays behind `/pr`.
- **Not in scope:** a release button (a `prod` deploy stays a typed command, by the house rule), a CI re-run button (CI is off), review comments, auto-merge, squash.
