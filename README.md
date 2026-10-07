# hermes-mods

Two Claude Code mods (plugins of function hooks) built for the Hermes project. They need Claude Code 2.1.289 or newer.

## hermes-band

A colored band above the prompt:

- the branch, the short commit, the worktree, ahead/behind, and dirty files split into "mine" (edited by this session) and "not mine" (another session's work);
- the context window: used of window, the compaction point, a bar whose colors show a card on hover, and two ring gauges for the 5-hour and weekly limits;
- the api and web dev servers with their ports and worktrees, orphans marked, and a two-step "stop orphans" button (Windows only: the scan uses PowerShell);
- buttons for `/compact`, `/ship` and `/clean-code-review`.

Commands: `/band`, `/band hide|show|refresh|forget`.

## hermes-guard

Hooks that refuse the mistakes that cost the most:

- staging everything at once (`add -A`, `add .`, `commit -a`): stage by explicit path instead;
- a `git commit` of code without a green `node checks/check.mjs` after the last edit;
- edits to the verified-path hands-off files, until `/guard unlock`;
- `.skip(` or `.only(` added to a test, or a test file deleted;
- an em or en dash written into app source.

It also sets `model: "sonnet"` on every Agent call without one, and `"opus"` on Plan agents. Commands: `/guard`, `/guard unlock|lock`.

## Install

```bash
claude plugin marketplace add RedGuyFromHell/hermes-mods
claude plugin install hermes-band@hermes-mods
claude plugin install hermes-guard@hermes-mods
```

## Develop

Edit a mod's `hooks/*.tsx`. An installed mod that is read from this folder reloads with `/reload-plugins`. Validate and test with a 2.1.289 or newer binary:

```bash
claude plugin validate hermes-band
claude plugin test hermes-band
```
