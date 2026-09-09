# MediaRemote Adapter

Source: https://github.com/ungive/mediaremote-adapter
Commit: 73f14ab1568371e6e3c44063f21c34c5e2712c4d
License: BSD-3-Clause (see LICENSE).

Companion builds the unmodified adapter sources with scripts/build-mediaremote.mjs.
The adapter uses private macOS APIs. Keep it isolated from the app and report
unavailable data if a macOS update changes access. No system settings are modified.
