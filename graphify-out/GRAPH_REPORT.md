# Graph Report - web  (2026-11-02)

## Corpus Check
- 10 files · ~7,457 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 135 nodes · 193 edges · 11 communities (7 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `77485be5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]

## God Nodes (most connected - your core abstractions)
1. `render()` - 11 edges
2. `clone()` - 9 edges
3. `Ctx` - 9 edges
4. `tok()` - 8 edges
5. `web` - 8 edges
6. `inline()` - 7 edges
7. `clip()` - 6 edges
8. `http()` - 6 edges
9. `clean()` - 5 edges
10. `seq()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `up()` --calls--> `sleep()`  [EXTRACTED]
  web.js → web.js  _Bridges community 2 → community 0_

## Communities (11 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (28): alive(), BOOL, BROWSERS, CLONE_ITEMS, CMDS, Fail, fs, GLOBAL (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.12
Nodes (30): b, children(), clean(), clip(), draw(), el, hay, hit (+22 more)

### Community 2 - "Community 2"
Cohesion: 0.20
Nodes (7): afterAction(), CDP, clip(), clone(), Ctx, press(), sleep()

### Community 3 - "Community 3"
Cohesion: 0.15
Nodes (12): bin, web, description, engines, node, files, license, name (+4 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (9): c, ctx, e, fake, fs, go, q, results (+1 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (12): Agent loop, code:block1 (git clone <this repo> ~/.claude/tools/web), code:mermaid (flowchart LR), code:block3 (@ https://news.ycombinator.com/ "Hacker News"), code:block4 (web do <<'EOF'), Commands, Files, How it works (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.50
Nodes (3): Loop, Rules, web CLI

## Knowledge Gaps
- **60 isolated node(s):** `name`, `version`, `description`, `web`, `files` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Ctx` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `CDP` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _60 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08522727272727272 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.12298387096774194 - nodes in this community are weakly interconnected._