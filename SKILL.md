---
name: web-cli
description: Drive a real browser (Opera GX by default, also Chrome/Edge) from the shell with the `web` CLI. Use for ANY web page task - reading a site, clicking, filling forms, logging in, scraping, checking a web app - before reaching for Playwright, claude-in-chrome or windows-mcp browser tools. Far fewer tokens, works while the window is minimized, the user keeps using the PC.
---

# web CLI

`web` is on PATH (PowerShell and Git Bash). Full reference: `~/Desktop/claude/playwrote-cli/README.md`.

## Loop

1. `web goto <url>`. The output already includes the top 40 lines of the page outline.
2. Need more? Run `web page` (the whole page, 8k char budget, repeats folded only when over budget), or narrow it with `--region main|nav|form|dialog|<ref>` / `--sel <css>`. A fold marker `…+N similar (web page --expand eK)` means there are more items.
3. Act on refs from the outline: `web click e12`, `web type e4 "text" [--clear] [--enter]`, `web select e7 "Option"`, `web upload e9 C:\path\file.pdf`, `web key Enter`.
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

## Limits per command (work around them, do not retry blindly)

- `page` / `find` / `snap`: cannot see inside iframes (shown as one `iframe "<src>"` line) or Shadow DOM, and skip `<canvas>`/`<svg>` content. Use `web eval` (e.g. `document.querySelector('x').shadowRoot...`) or `web shot` for those. `page` stops at 8k chars: use `--region`, `--sel`, `--expand` or `--max N`. `find` returns at most 15 text matches.
- Refs (`e12`) die on navigation and re-render: `stale ref` means run `find`/`page` again. `goto --quiet` assigns no refs.
- `click`: if the element is covered or has no size it falls back to a JS click (says so in the output); a few sites ignore JS clicks, then click the covering element or use `web key`.
- `type`: inserts text in one go (no per-key events). Autocomplete widgets that react to keys may need `web key ArrowDown` / `web key Enter` after. It fails if the element won't take focus: click it first.
- `select`: native `<select>` only. Custom dropdowns: `click` the dropdown, then `click` the option ref.
- `upload [ref] <file...>`: pass the ref of the upload button, label, file input or drop zone (`web find dropzone:`). No ref works only when the page has exactly one file input. If the ref has no file input next to it, `upload` CLICKS it to catch the file picker, then tries a drop; a ref that is neither errors with "not an upload target" but has still been clicked, so never pass refs of submit/delete buttons. Single-file inputs reject several files. Drop zones are spotted by name (`dropzone`, `drop-area`, `drag-drop`, `dz-`, `ondrop`); one with a plain name shows as `clickable` or as text: use that ref, the drop bubbles up to it.
- Dialogs (alert/confirm/prompt): answered automatically and printed as `dialog <type> "<msg>" -> accepted|dismissed`. Alerts are accepted, confirms and prompts dismissed; rerun the action with `--accept` or `--prompt "text"` to accept. Accepting a confirm can be destructive: only when the user's task needs it. A dialog that opens while no `web` command runs (e.g. a timer) freezes the tab: you get "tab is frozen", run `web close`, then `web open <url>`, page state is lost.
- `key`: Enter Tab Escape Backspace Delete Arrow* PageUp PageDown Home End Space, single characters, with Control/Alt/Shift/Meta+. Nothing else (no F-keys).
- `wait`: case-sensitive substring of visible text, polls every 250ms, default 10s (`--t N`).
- `eval`: result is JSON (DOM nodes come back as `{}`), clipped at 4000 chars. Return strings or plain data.
- `net`: from the page's performance log, not a live capture: no request bodies or headers, cross-origin status often `---`, only the current page. Use `web eval` with `fetch` to probe an API.
- `console`: current page only, errors/warnings unless `--all`; messages from before a navigation are gone.
- `shot`: a minimized window is restored for a moment to capture, then minimized again (the user may see a flash).
- `do`: stops at the first failing line; `do` and `selftest` cannot be nested in it.
- `clone`: one-time snapshot of the user's logins, needs their browser closed. New logins in their browser do not reach the agent profile until `clone` runs again.

## Before filling any form

1. Confirm the target: `web tabs` and check the agent tab (`*`) is the page the user means. The agent browser is a separate window from the user's own browser, so the user may be looking at a different copy of the page. If more than one tab matches, ask which one.
2. Read the whole form first: `web page --region form` (or `web shot` when the form lives in a cross-origin iframe, which the outline cannot see). List every field, its current value, and which ones you have data for.
3. Fill, then verify: re-read the form or `web shot` and check every value actually landed. Report a field as done only after you have seen it filled.
4. Iframe forms (Stripe, payment, captcha-guarded): if typing does not land after one verified retry, stop and hand the values to the user. Do not loop on blind coordinate input.
