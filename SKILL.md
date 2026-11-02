---
name: web-cli
description: Drive a real browser (Opera GX by default, also Chrome/Edge) from the shell with the `web` CLI. Use for ANY web page task - reading a site, clicking, filling forms, logging in, scraping, checking a web app - before reaching for Playwright, claude-in-chrome or windows-mcp browser tools. Far fewer tokens, works while the window is minimized, the user keeps using the PC.
---

# web CLI

`web` is on PATH (PowerShell and Git Bash). Full reference: `~/Desktop/claude/playwrote-cli/README.md`.

## Loop

1. `web goto <url>`. The output already includes the top 40 lines of the page outline.
2. Need more? Run `web page` (the whole page, 8k char budget, repeats folded only when over budget), or narrow it with `--region main|nav|form|dialog|<ref>` / `--sel <css>`. A fold marker `…+N similar (web page --expand eK)` means there are more items.
3. Act on refs from the outline: `web click e12`, `web type e4 "text" [--clear] [--enter]`, `web select e7 "Option"`, `web key Enter`.
4. `ok -> <url>` means you navigated, so run `web page` again. For partial updates use `web find <text>` or `web page --region <ref>`, not a full re-dump.
5. Use `web wait <text|ref|url:part|gone:text>` after actions that load content asynchronously.

## Rules

- Find elements with `web find "Send"` or `web find button:Send` instead of dumping the page again.
- Batch known steps in one call: `web do` with commands on stdin, one per line.
- Screenshots: `web shot [ref]` prints a PNG path. Read the file only if layout or visuals actually matter.
- `stale ref` error: the page re-rendered, so run `find` or `page` again.
- Never act on the user's own tabs unless asked: `web tabs`, then `--tab <id>`.
- Logins: the agent profile is a clone of the user's real Opera profile (`web clone`). If a site asks you to log in, tell the user. Do not type their credentials unless they give them for that task.
- Debugging a web app: `web console`, `web net --filter api`, `web eval "<js>"`.
- Broken? `web selftest` should print `selftest ok`.
