# Read-only modules

The companion uses locally installed CLIs. It detects their versions when the bridge starts, even when a module is disabled. Detection does not read account data. Enable a module to collect data; disable it to stop its commands and clear its display data.

The bridge does not sign in, install software, change mailbox state or send messages. Command errors are replaced with safe guidance before reaching the browser or device. CodexBar account identifiers and credentials are excluded from snapshots. Enabling HEY includes sender names and subjects in local snapshots and the USB display; message bodies are excluded.

## CodexBar

[CodexBar](https://codexbar.app/) provides provider usage windows and reset times. The bridge calls:

```sh
codexbar usage --json --no-credits --no-color
```

An empty provider selection follows the providers enabled in CodexBar. An explicit selection adds `--provider <id>` for each selected provider. Configure provider credentials in CodexBar itself.

Each returned window contains the percentage used and its reset time. Missing windows stay absent. A provider with an expired session cannot be mistaken for 0% usage. If one provider fails, usable results from other providers remain available with a warning.

The parser follows the [CodexBar CLI implementation](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCLI/CLIUsageCommand.swift). The module was checked against installed CodexBar 0.56.6.

## HEY

[HEY CLI](https://github.com/basecamp/hey-cli) supplies a read-only list from the selected mailbox. Sign in with `hey auth login` in your terminal if needed.

Mailbox requests use `hey box view <box> --limit 30 --jq <filter>`. The built-in filter allows only row IDs, sender names, subjects, supported app links and continuation metadata to reach the bridge. Screener uses its read-only list command with the same bounded output. Bundles remain a single row, as returned by HEY.

The source snapshot contains `items`, `selectedBox` and `hasMore`. `items` holds at most 30 rows with `id`, `sender`, `subject` and an optional supported `url`. `hasMore` means the recent list is incomplete; older mail stays in HEY. The bridge does not scan mailbox history or read message bodies.

The bridge sends one to three `items` per dashboard according to `design.hey.rows` (two by default), plus `pageIndex` and `pageCount`. Changing the row count clamps the current page. Sender and subject text is bounded for the device protocol, without splitting UTF-8 characters. Unsupported device glyphs become `?` and truncated text ends with an ellipsis; the configuration list retains the original text. Vertical swipes send `hey-page` with direction `1` or `-1`; the browser uses `POST /api/hey/page`. Page changes only apply while the HEY module is active and ready. Selecting another mailbox resets the page, and refreshes clamp it if the list shrinks.

Ongoing mailbox changes use the [HEY WebSocket watch](https://github.com/basecamp/hey-cli/blob/main/internal/cmd/watch.go):

```sh
hey watch --events added,updated,deleted,resync --timeout 30m
```

Several changes share one delayed refresh, using the configured refresh interval. The bridge restarts a completed watch and ignores events from cancelled watches. Screener has no matching watch event, so selecting it uses periodic list requests. Existing rows remain visible while the same mailbox refreshes.

The module was checked against installed HEY 1.2.1. Validation artifacts use fictional messages. Reading a mailbox list does not mark messages as read, and the studio exposes no mailbox write operations.

## Clock

Clock is built in. It uses the computer's local date and time, with no account or CLI. Settings are `modules.clock.enabled`, `modules.clock.hourFormat` (`"12"` by default, or `"24"`) and `modules.clock.showWeekday` (true by default) and `modules.clock.blinkSeparator` (true by default). Missing Clock settings use the current built-in defaults; an existing saved module order is preserved.

Clock dashboards carry `blinkSeparator` (a boolean) and `time` (such as `5:20` or `17:20`, without am/pm; up to seven ASCII characters accepted for compatibility) and `weekday` (a three-letter day, or an empty string when hidden). The bridge checks the clock every second and publishes when the displayed minute or day changes. The colon blinks locally on the browser and device without additional bridge updates, keeping its original glyph width. The browser keeps it steady when reduced motion is enabled. This also updates previews without connected hardware. Clock settings, enabling and reordering use the existing settings API.

## Display inspiration

[Clawdmeter](https://github.com/HermannBjorgvin/Clawdmeter) demonstrates a compact hardware display with session usage, weekly usage and reset countdowns. Its README explains that some fonts and mascot assets have unresolved licensing. This project uses its own layout and existing fonts; it does not copy those assets or its daemon.

## Runtime contract

`ModuleSources` emits `change` with a fresh snapshot. It supports `configure(settings)`, `start()`, `stop()`, `refresh(moduleId)` and `snapshot()`.

Both modules expose `installed`, `version`, `status`, `updatedAt` and a safe `error`. `installed: null` means detection has not completed or could not confirm availability. Installation does not imply authentication. Refreshing a disabled module runs version detection only.

Subprocesses receive fixed executable names and argument arrays, without a shell. Normal reads have timeouts and output limits. Watches stream bounded lines without retaining mail records. Disabling or reconfiguring a module aborts its commands and prevents delayed results from restoring stale state.

## Display designer

Settings persist per-module `design` records. Every field is an integer validated against `shared/design-schema.json`, including colour values and font-size choices. Partial updates use `POST /api/settings` and preserve other modules. Old settings files receive the default designs automatically. State frames include the active module's `design` array in schema order only when customized; omission restores defaults. State frames allow up to 2048 bytes, and oversized updates report an error rather than silently disappearing.

Font sizes use bounded integers rather than preset enums. Usage `numberSize: 0` retains automatic sizing; other percentage sizes are 24..160, as are clock digits. Sans roles accept 12..48. The firmware uses bounded, role-owned TinyTTF glyph caches for intermediate sizes and preserves existing bitmap sizes. Face `scale` accepts 50..150 percent, default100, and changes rendered geometry without resetting animation clocks.

The built-in configuration matches the saved setup promoted on 6 September 2026. Module and property resets restore that tuned design. New settings files also inherit its theme, mouse-follow preference, enabled modules and module order. Later edits remain saved preferences until explicitly promoted again.

## Roon

Roon uses the official local extension APIs for transport, zone subscriptions and album artwork. It does not use the Roon ARC port or scrape Web Display. Enable Roon in Modules, then enable Companion Studio in Roon Settings > Extensions. Select a listening zone, or leave Automatic selected to follow a playing zone. The optional server address uses Roon's local API on port 9330; leaving it blank uses discovery.

The module shows artwork, track and artist with previous, play/pause and next controls. These affect only the selected zone. Disable the module to stop its connection and controls. Missing, removed and disconnected zones clear stale track data. Designer exposes artwork size, position and corners, text sizes and positions, button size and spacing, and colours.

Pairing state is stored privately in `.cache/roon-pairing.json`, outside shareable studio settings. Artwork is resized locally to 160 x 160, served as JPEG to the preview, and transferred as bounded RGB565 chunks to the device. Acknowledgements, checksums and image IDs prevent incomplete or obsolete covers from appearing. Album art is fetched only through the paired Roon image service.

Official API references: [Roon API](https://github.com/RoonLabs/node-roon-api), [Transport](https://github.com/RoonLabs/node-roon-api-transport) and [Image](https://github.com/RoonLabs/node-roon-api-image). Dependencies are pinned to reviewed source revisions in package.json.

Usage progress styles are `design.usage.barStyle`: 0 for Solid (default), 1 for Square pixels and 2 for Circle pixels. `barPixelSize` accepts 2 to 16px (default 4), and `barPixelGap` accepts 0 to 8px (default 2). Cell size is capped at bar thickness; complete cells form a centred grid with transparent gaps. Filled cells are clipped at the exact progress boundary, including partial cells. Native rendering uses bounded, lazily allocated canvases. Older 25-field usage designs receive the appended solid defaults.

Roon artwork expansion is temporary display state. `POST /api/roon/view` accepts `{ "expanded": true }` or false; the physical display sends a `roon-view` event. Expansion requires a ready Roon module and current artwork, and leaving the module clears it. It never changes playback or saved settings. The expanded cover is 430px with no centre hole. Expansion is instant and stationary by default. Designer offers independent Animate artwork expansion and Spin expanded artwork switches. Animation uses 280ms geometry and 180ms chrome transitions; spin runs only while expanded and playing. Playback hit targets stay disabled until collapse settles. Playback button size is configurable from 28 to 72px, default 64px. The preview honours reduced-motion preferences.

## Open a card on the Mac

Tap a HEY row to open its supplied HEY app link, or a usage card to open the provider's dashboard, in the Mac's default browser. The playground and device share the same local bridge action. Swipes continue to change modules or pages. Sample cards and cards without supported links stay inactive.

`POST /api/open-card` accepts `{ "module": "hey", "index": 0, "token": "<openToken>" }` (or module `usage`). The device sends the same fields in an `open-card` event. The dashboard supplies `openToken` and per-card `openable` flags. Tokens bind the displayed page and card identities, so stale taps cannot open a different row after a refresh. URLs are resolved on the bridge, never accepted from a tap request. The launcher uses macOS `/usr/bin/open` with a validated HTTPS destination and no shell.

HEY links come from the CLI's supplied app URLs, including bundle links; posting IDs are not treated as topic IDs. Provider destinations follow CodexBar's verified dashboard links. Background HEY polling remains read-only; opening a message uses HEY's normal browser reading behaviour.

## Display rotation

`device.rotation` accepts integer angles from 0 to 359 degrees clockwise and defaults to 0 for existing settings. Every state frame includes `rotation`; firmware acknowledgements report the applied angle using the same field. This setting affects the physical display only. The web preview and its gestures remain upright.

Firmware keeps the panel orientation and crop unchanged and rotates RGB565 updates in software. Touch points receive the inverse transform once; orientation changes cancel physical gestures and trigger a full redraw. Cardinal angles retain their direct partial-update path.

### Device appearance

Device > Device appearance controls the companion independently of Studio preferences. Light and Dark each have editable Screen, Primary text, Secondary text, Card surface, Progress track, Accent, Success, Warning and Critical tokens. Save palette applies changes; each token can be reset. Album artwork keeps its source colors. Designer geometry remains module-specific; colors are centralized here.

System follows the connected host's appearance, including when the browser is closed. The bridge polls macOS appearance, Windows AppsUseLightTheme or GNOME color-scheme every three seconds. Failed or unavailable OS queries retain the last reading (Dark until a reading succeeds). Dashboard appearance never controls the device.

Frames include resolved `theme` and RGB24 `palette`; module design colors are resolved from those tokens. ACKs report rendered theme and panel transfer diagnostics. Rotation work is tracked with `rotation_us` and `rotation_pixels` to separate screen processing from scene preparation.

### USB connection selection

Device > USB connection provides Automatic, Choose a port and Browser only modes. Refresh ports updates the list; Reconnect reopens the current connection.

Automatic selection uses the Espressif USB identifier, then remembers the chosen device's serial number and USB identity. Moving that device to another socket updates its path. Multiple candidates require a manual choice. A remembered device being absent does not select a different board automatically.

Only listed ports can be selected. The bridge waits for the expected firmware handshake before sending state. A saved connection in `.cache/device-connection.json` takes precedence over the initial `.env` port. Browser only prevents automatic connection while preserving your selection.
