# PRISM by Entangled

Open-source dashboard frames: DIY hardware builds running web-tile dashboards.
No ads, no subscriptions, no telemetry, no data sales.

## Repo shape (spec §23)

```
docs/                 the spec and project docs — docs/dashboard-schema.md is the source of truth
prototypes/           working reference code (editor with the reference solver, build wizard)
packages/
  core/               prism-core — the shared TypeScript brain; shells decide nothing
  editor/             prism-editor — the web designer (reference renderer)
  remote-ui/          (planned) phone remote PWA
  conformance/        prism-conformance — the kit that defines "is a Prism"
shells/
  android/            Kotlin shell — core in a hidden WebView, tiles as WebViews
  daemon/             prism-daemon — core in Node, tiles as Chromium windows via
                      CDP pipe (PrismOS on Linux; the Windows Build 5 recipe)
  ...                 (planned) PrismOS image build
```

## prism-core

Schema types (`frame.dashboard/v0.1`) and the deterministic hero-layout solver
(spec §8). Solver output is normative: `packages/core/tests/golden/solver-fixtures.json`
is the portable conformance artifact — every port on every platform must
reproduce those rects exactly for those inputs.

```
npm install
npm test          # golden fixtures + cross-check vs. the verbatim prototype solver
npm run build
```

Every behavior section of the spec lives in core (`packages/core/src`); shells
implement only the driver seam in `drivers.ts` and decide nothing:

| Spec | Module | Spec | Module |
|---|---|---|---|
| §3 audio focus | `audio-focus.ts` | §17 region focus | `focus.ts` |
| §4/§24 schedules, night, alarm | `schedule.ts`, `alarm.ts` | §18 tile lifecycle | `lifecycle.ts` |
| §5 adapters runtime | `adapters.ts` | §19 compatibility reports | `compat.ts` |
| §6 remote API + pairing | `remote.ts` | §21 VPN | `vpn.ts` |
| §7/§11 input mapping, remotes | `input.ts` | §25 living previews | `preview.ts` |
| §8/§9 solver, layout, carousel | `solver.ts`, `layout.ts`, `orchestrator.ts` | §26 intermission | `intermission.ts` |
| §12 launch tiles | `orchestrator.ts` | §27 gallery veil | `veil.ts` |
| §14 private listening | `listening.ts` | §28 updates | `updates.ts` |
| §15/§20 sharing + fit validation | `sharing.ts` | §16 no white frames | `refresh.ts` |

## prism-conformance

Drives any shell through the remote API (§6) alone and verifies the
observable contracts — auth, state shape, rects bit-identical to the
reference solver, hero re-solve, layout switching, carousel wrap:

```
npm run build
node packages/conformance/dist/cli.js http://<frame>:8471 <token> <bundle.json>
```

A shell that passes is a Prism (§23).

## Building, contributing, security

- **Build the Windows app:** [docs/building-windows.md](docs/building-windows.md)
- **Contribute:** [CONTRIBUTING.md](CONTRIBUTING.md) (GPLv3-or-later, signed-off commits, the gate `node scripts/verify.mjs`)
- **Report a security problem:** security@entangled.world, see [SECURITY.md](SECURITY.md)
- **How Prism treats the services it shows:** [docs/third-party-services-policy.md](docs/third-party-services-policy.md)

## License

Prism is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. See [LICENSE](LICENSE).

Copyright (C) 2026 Entangled Labs LLC. Prism by Entangled is a trademark of Entangled Labs LLC.
