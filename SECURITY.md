# Security Policy

## Supply-Chain Hardening

Every release of Harnessa-FE is published with the following defenses. If any of these signals fails, **do not install** and report it.

### Provenance (sigstore attestation)

Starting at `v0.1.0`, every tarball on npm is published with `--provenance`, which attaches a [sigstore](https://www.sigstore.dev/) attestation linking the artifact to:

- the exact git commit
- the exact GitHub Actions workflow run
- the `morphixai/harnessa-fe` repo

Verify in your project:

```bash
npm audit signatures
```

You can also inspect provenance on each npm package page (under "Provenance").

### What an attack on us would look like

A compromised Harnessa-FE release would typically be one of:

- A version pushed **without** provenance (badge missing on npm)
- A postinstall script appearing in `package.json` (we ship none)
- A version published by an account other than `@harnessa-fe`
- An out-of-band patch version (e.g. `0.1.0-hotfix`) we did not announce

If you see any of these, file a public issue immediately and pin to the last known-good version.

### What we do internally

- **OIDC trusted publishing** via GitHub Actions — no long-lived NPM tokens stored anywhere
- **`id-token: write`** is the only elevated permission granted to the release workflow
- **Tag-triggered + protected environment** — release jobs require manual approval
- **Pinned GitHub Actions** — all third-party actions are pinned by commit SHA
- **`--ignore-scripts` on CI install** — postinstall hooks (the Shai-Hulud worm's entry point) cannot execute in our pipeline
- **`pnpm audit signatures`** before every publish — catches tampered transitive deps
- **Frozen lockfile** — every CI install uses `--frozen-lockfile`
- **2FA enforced** on every maintainer's npm and GitHub accounts
- **Granular npm tokens** scoped to `@harnessa-fe` only, expiring every 90 days (used only for first publish before OIDC took over)
- **No production runtime code** — Harnessa-FE is a dev-time tool. All instrumentation auto-disables in production builds.

## Reporting a Vulnerability

Please **do not** file public GitHub issues for security problems.

Email: **security@morphix.ai** (PGP key on request)

Or use [GitHub's private vulnerability reporting](https://github.com/morphixai/harnessa-fe/security/advisories/new).

We aim to:

- Acknowledge within 48 hours
- Confirm or refute within 7 days
- Ship a fix within 30 days for high/critical issues

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x | ✅ |
| < 0.1 | ❌ (pre-release) |

We patch the latest minor only until 1.0.

## Hall of fame

Researchers who responsibly disclose issues will be credited here (with permission).
