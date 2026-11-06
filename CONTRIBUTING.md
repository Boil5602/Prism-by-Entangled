# Contributing to Prism

Thanks for helping. Prism by Entangled is free software from Entangled Labs LLC, and contributions
are welcome: bug reports, adapters for more services, fixes and features.

Security problems go to **security@entangled.world**, not a public issue. See [SECURITY.md](SECURITY.md).

## Before you start

- **Read the spec first.** `docs/dashboard-schema.md` is the source of truth for behavior;
  `docs/win-host-spec.md` covers the Windows app, and `docs/scene-model-spec.md` the configuration
  model. A behavior question is answered there before any code is written.
- **Read the services policy.** `docs/third-party-services-policy.md` sets how Prism treats the
  services it shows: no credential handling, nothing that touches copy protection, page actions
  only, a person's pace, no disguises. A change that breaks it won't be merged.
- **One brain, thin hands.** All behavior lives in prism-core (`packages/core`). The Windows app,
  the daemon and the other shells only implement the driver seam and decide nothing.

## License and sign-off

Prism is licensed under the **GNU General Public License, version 3 or later** (see
[LICENSE](LICENSE)). By contributing you agree that your contribution is licensed the same way.

Every commit needs a sign-off line, certifying the
[Developer Certificate of Origin](https://developercertificate.org/) (that you wrote the change,
or otherwise have the right to submit it under the project's license):

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it for you.

## Building and testing

- The Windows app: see [docs/building-windows.md](docs/building-windows.md).
- prism-core: `npm install` at the repo root, then `npx vitest run` and `npx tsc -p tsconfig.json`
  in `packages/core`.
- **The gate:** `node scripts/verify.mjs` runs everything a change must pass (core tests and
  typecheck, the bundles, the vocabulary, hover and adapter audits, the host's tests and build).
  Run it before opening a pull request. Close the Windows app first: its build can't replace
  files the running app has open.

## House rules

- **Vocabulary.** App, Slot, Layout, Facet, Scene, Canvas class, Visualization. "Frame" means the
  physical device only. The vocabulary audit in the gate enforces it.
- **Plain on-screen words.** Text Prism shows reads like a person wrote it: short sentences, no
  " - " joining clauses, no chains of semicolons.
- **Readable from across a room.** Light ink `#E8ECF2` for information, amber `#F2B14C` for the
  thing to notice. Never show information in a control's disabled state.
- **Coloured buttons in the Windows app** are made with `Chip()` or call `OwnHover()`
  (`MainWindow.VideoHub.cs`); the hover audit in the gate checks it.
- **Encodings.** Some sources are mixed cp1252 and UTF-8 with CRLF line endings, and some host
  files must stay pure ASCII (write `\uXXXX` escapes). Keep each file as you found it.
- **Adapters.** Each service's adapter (`prism-adapters/adapters/*.json`) records what was read
  live and when in its notes, and bumps its version on every change. Selectors must be valid
  CSS; the adapter audit checks the literal ones.
- **Tests with behavior.** A change to core behavior comes with a test in `packages/core/tests`.
- **Privacy.** No personal details in code, tests, docs or commit messages: no real people's
  names, no home network addresses, no personal email, no one's viewing history. Tests use the
  demo household (Alex, Sam, Maya, Leo).
- **Non-negotiables.** Never wipe a user's profile or session storage; no white frames (dark
  substrate, snapshot then crossfade); no identifiers in any network call; ad detection observes
  and covers, never interferes.

## Pull requests

Keep a pull request to one change, say what it does and why, and link the spec section or issue it
answers. Describe how you tested it. For anything visible in the Windows app, a screenshot helps.
