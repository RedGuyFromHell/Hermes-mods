# hermes-mods

Four Claude Code mods (plugins of function hooks): three built for the Hermes project, one for the Nerd Castle knowledge base. They need Claude Code 2.1.289 or newer.

## hermes-band

A colored band above the prompt:

- the branch, the short commit, the worktree, ahead/behind, and dirty files split into "mine" (edited by this session) and "not mine" (another session's work);
- the context window: used of window, the compaction point, a bar whose colors show a card on hover, and two ring gauges for the 5-hour and weekly limits;
- beside the gauges, hermes-agents' counts (`3 · 2 running · 1 done`, a ring on the desktop) and a button that opens its pane; with hermes-agents not loaded, nothing;
- the api and web dev servers with their ports and worktrees, orphans marked, and a two-step "stop orphans" button (Windows only: the scan uses PowerShell);
- buttons for `/compact`, `/ship` and `/clean-code-review`.

Commands: `/band`, `/band hide|show|refresh|forget`.

In the Nerd Castle knowledge base (any path with a `nerd-castle` folder) it draws nothing and scans nothing: nerd-band takes its place.

## hermes-agents

An agents pane, in hermes-band's colors. It opens by itself when the first agent of a session starts.

- one row per agent: its status, name, task, type, model, run time, tool count, and what it is doing now (`reading catalog.md`);
- `›` on a row shows that agent's task, its last 10 tool calls and its answer;
- there, a field to send it a message (a message to a finished agent resumes it) and a two-step `stop`;
- `clear finished` drops the agents that ended.

A mod cannot pause an agent: a hook may hold a tool call for 10 seconds at most. Agents a Workflow starts show by id, as the engine gives them no name.

Commands: `/agents-pane`, `/agents-pane clear`.

## nerd-band

hermes-band, adapted to the Nerd Castle knowledge base (`D:\Projects\NERD-CASTLE` and its worktrees; elsewhere it stays quiet):

- the same git chips, "mine" / "not mine", context bar and limit gauges;
- a row for the nested repos (theme, workbench, etsy): branch, ahead/behind, dirty count;
- a `git fetch` every 10 minutes, so ↓ shows what the other station (or the Shopify GitHub bot, for the theme) pushed, and a `pull ↓N` button that pulls fast-forward only;
- the `shopify theme dev` and `hyperframes preview` servers with their ports, orphans marked, and the two-step "stop orphans" button (Windows only);
- buttons for `/compact`, `/ship` and `/code-review`.

Commands: `/castle`, `/castle hide|show|refresh|fetch|forget`.

## hermes-guard

Hooks that refuse the mistakes that cost the most:

- staging everything at once (`add -A`, `add .`, `commit -a`): stage by explicit path instead;
- a `git commit` of code without a green `node checks/check.mjs` after the last edit;
- edits to the verified-path hands-off files, until `/guard unlock`;
- `.skip(` or `.only(` added to a test, or a test file deleted;
- an em or en dash written into app source.

It also sets `model: "sonnet"` on every Agent call without one, and `"opus"` on Plan agents. A named agent whose `.claude/agents/<name>.md` frontmatter sets its own `model:` (in the project or the user folder) is left alone, so an evaluator's pin holds. Commands: `/guard`, `/guard unlock|lock`.

## Install

```bash
claude plugin marketplace add RedGuyFromHell/Hermes-mods
claude plugin install hermes-band@hermes-mods
claude plugin install hermes-guard@hermes-mods
claude plugin install nerd-band@hermes-mods
claude plugin install hermes-agents@hermes-mods
```

## Develop

Edit a mod's `hooks/*.tsx`. An installed mod that is read from this folder reloads with `/reload-plugins`. Validate and test with a 2.1.289 or newer binary:

```bash
claude plugin validate hermes-band
claude plugin test hermes-band
```
