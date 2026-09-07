# Release Companion for macOS

Companion uses Sparkle for in-app updates. The release pipeline follows Notate's sequence: build, sign, notarize, staple, package, sign the update feed, then publish the archives before the feed.

The workflow currently builds Apple silicon releases for macOS 13.5 or later. It does not change repository visibility or publish on a normal push.

## What ships

A release contains the menu bar app, Node, the browser dashboard, production bridge dependencies and a compiled mouse helper. It runs without a checkout or a separately installed Node runtime. HEY, CodexBar and Herdr remain optional integrations installed by the user.

Settings and pairing data live in `~/Library/Application Support/Companion`. Updates replace the app, not this folder. Optional environment settings go in `config.env` there. Logs keep the existing `~/Library/Logs/Companion Studio/bridge.log` location. The bundle and Roon extension identifiers remain unchanged so identity and pairing stay stable.

To move this development installation's saved settings to the release location, quit Companion and run:

```sh
node scripts/release/migrate-local-data.mjs
```

Existing destination files are kept. No secrets, local settings, workspace paths or `.env` files are included in releases.

## Configure GitHub

The `Release macOS` workflow uses these repository variables:

| Variable | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | Exact Developer ID Application identity |
| `SPARKLE_PUBLIC_KEY` | Companion's Ed25519 public key |
| `COMPANION_UPDATE_BASE_URL` | `https://cdn.victor.computer/companion` (no trailing slash) |
| `R2_BUCKET` | Dedicated Companion release bucket |

And these encrypted secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID certificate and private key in a password-protected `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_APP_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple developer team ID |
| `SPARKLE_PRIVATE_KEY` | Companion Sparkle private signing key |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Bucket-scoped S3 access key |
| `R2_SECRET_ACCESS_KEY` | Corresponding S3 secret |

A separate Companion Sparkle key has been created in the local Keychain under account `companion`. Its public variable and encrypted private secret are configured in GitHub. Do not use Notate's update key or feed.

Export the Developer ID identity from Keychain Access as a password-protected `.p12`, then set GitHub secrets through Settings > Secrets and variables > Actions or `gh secret set`. GitHub cannot copy existing encrypted secrets back out of another repository.

The `victor-cdn` Worker serves the private `companion-releases` bucket at `https://cdn.victor.computer/companion/`. The public feed is at `/companion/arm64/appcast.xml`; its R2 object key remains `arm64/appcast.xml`. GitHub upload credentials can list, read and write only this bucket. `companion.victor.computer` is reserved for the landing page.

The router source and bindings live in `infra/cdn/`. Deploy changes with `wrangler deploy --config infra/cdn/wrangler.jsonc`. To expose another project's bucket, add an explicit R2 binding and path mount; unknown prefixes return 404. Downloads stream from R2 and preserve uploaded cache metadata. The router currently returns complete files rather than partial byte ranges.

Configure the GitHub `release` environment with reviewers if you want a review gate before public uploads.

## Build locally

```sh
pnpm install --frozen-lockfile
pnpm check
node scripts/release/fetch-dependencies.mjs
COMPANION_NODE_BINARY="$PWD/.tools/release-deps/node/node-v24.12.0-darwin-arm64/bin/node" \
  node scripts/build-menubar.mjs --bundle
```

`--bundle` makes a portable, ad hoc signed smoke build without an updater. `--release` additionally requires `APPLE_SIGNING_IDENTITY`, `SPARKLE_FRAMEWORK`, `SPARKLE_FEED_URL` and `SPARKLE_PUBLIC_KEY`. It enables Sparkle, hardened runtime and Developer ID signing. `COMPANION_VERSION` overrides the package version for a build.

Dependencies are downloaded from the official Node and Sparkle distributions and checked against pinned SHA-256 hashes. Update these pins deliberately in `scripts/release/fetch-dependencies.mjs`.

## Stage and publish

The GitHub **Run workflow** form provides:

- **Channel:** production or beta. Each channel has separate downloads and an update feed. Beta installers follow only the beta feed and GitHub marks them as prereleases.
- **Version bump:** patch, minor or major, calculated from the highest package or published tag version across both channels.
- **Exact version:** optional override, useful for the initial `0.1.0` release or promoting a beta version to production.
- **Auto publish:** off by default. When off, the run saves a signed test artifact. When on, it publishes after the build succeeds and any configured environment review passes.

Production uses `/companion/arm64/`; beta uses `/companion/beta/arm64/`. A failed or staged build does not consume a version: the next bump uses published tags. The workflow does not commit a version bump to the source branch. Unlike Notate, this workflow uses GitHub-generated notes and does not have its AI changelog review gate.

Commit and push the release changes first. Then run:

```sh
gh workflow run 'Release macOS' -f channel=production -f bump=patch -f version=0.1.0 -f auto_publish=false
```

The workflow builds and notarizes the app, produces a ZIP and DMG, and signs the Sparkle feed. It saves the output as a GitHub Actions artifact. Download it and test on a Mac without the development checkout: launch, connect USB, open the dashboard, exercise optional integrations, quit, relaunch and check saved settings.

To build and publish a release:

```sh
gh workflow run 'Release macOS' -f channel=production -f bump=patch -f auto_publish=true
```

Publishing rejects an existing or lower version. It uploads immutable versioned archives, creates the GitHub release against the built commit, then updates the public feed. The feed contains the latest release; older versioned downloads remain available. A failed upload may leave an unpublished versioned archive: inspect it before retrying, or use a new version. Do not overwrite released archives.

A staged run and a publish run are separate builds. The publish workflow's artifact is the one that goes live. Use the `release` environment gate to inspect that exact artifact before allowing its publish job.

## Verify updates

Install a signed release, then publish a higher version to the same feed. Choose **Check for Updates** in the menu. Confirm the update installs, restarts Companion, reconnects the device and preserves settings. A compile or packaging check alone does not verify this round trip.

Reference: [Sparkle setup](https://sparkle-project.org/documentation/) and [publishing updates](https://sparkle-project.org/documentation/publishing/).
