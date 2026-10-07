# Security policy

Prism by Entangled is made by Entangled Labs LLC. We take security reports seriously and want to
hear about anything that could put Prism's users at risk.

## Reporting a vulnerability

Email **security@entangled.world**. Please don't open a public issue, discussion or pull request
for a security problem until it has been fixed.

A useful report includes:

- what is affected: the Windows app, the Veil browser extension (and which browser), prism-core,
  an adapter, or the ad-report inbox;
- the version (the About box in the Windows app, or the extension's version in its popup);
- steps to reproduce, and what an attacker could do with it;
- any proof-of-concept code, logs or screenshots. Please leave out anything personal, such as
  account details or viewing history.

## What to expect

- We aim to acknowledge a report within 5 business days.
- We'll keep you updated while we investigate and fix it, and tell you when a fix is released.
- We're happy to credit you in the release notes if you'd like. Tell us the name to use.

There is no paid bug bounty.

## Scope

In scope:

- the Windows app (`targets/win-host`) and prism-core (`packages/core`);
- the Veil browser extension (`prototypes/prism-veil-extension`);
- the adapters shipped in this repository (`prism-adapters`);
- the ad-report inbox Entangled runs (`prototypes/prism-veil-reports`).

Out of scope: problems in the streaming and music services Prism shows (Netflix, Hulu, Spotify
and the rest). Report those to the service itself. Findings that need physical access to an
unlocked computer, or that only affect a copy someone has modified, are also out of scope.

## Supported versions

Security fixes go into the latest release of the Windows app and of the Veil extension. Please
update to the latest version before reporting.

## Good-faith research

We won't pursue or support legal action against anyone who researches and reports a
vulnerability in good faith under this policy: without accessing other people's data, without
disrupting the ad-report inbox or other services, and giving us reasonable time to fix the
problem before disclosing it.
