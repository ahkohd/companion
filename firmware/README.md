# Waveshare firmware

Native LVGL rendering for Companion on the Waveshare ESP32-S3-Touch-AMOLED-1.75-B. The display supports the animated Herdr face, CodexBar usage meters, HEY mailbox lists, a clock and Roon playback. USB supplies power and carries state from the local bridge.

This target is the round 466 x 466 board with a CO5300 AMOLED and CST9217 touch controller. Other Waveshare sizes need their own hardware port.

See the [hardware compatibility table](../README.md#hardware-compatibility) for related round, rectangular and watch-style boards. They are untested port candidates, not additional supported firmware targets. The browser preview and Designer also currently assume this round screen.

## Build and flash

From the repository root:

```sh
pnpm firmware:setup
pnpm firmware:build
```

Setup requires the GitHub CLI (`gh`), Git and Python. It installs the pinned ESP-IDF toolchain under `.tools`. The build prints the flash command.

Keep a full backup of your own board before replacing its firmware. See the [backup and recovery instructions](../README.md#hardware-and-firmware).

Stop the bridge before flashing, monitoring the serial port or running hardware checks. For the commands below, create a Python environment and replace the port placeholder with your board's current serial port:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-device.txt
export ESP_SERIAL_PORT=/dev/your-serial-port
```

Flash from the build directory, then return to the repository root:

```sh
cd firmware/build
../../.venv/bin/python -m esptool --chip esp32s3 \
  --port "$ESP_SERIAL_PORT" --baud 460800 \
  --before default-reset --after hard-reset write-flash @flash_args
cd ../..
```

The ESP-IDF installation also includes esptool. If automatic bootloader entry fails, hold BOOT, press and release RESET, then release BOOT and retry. Check the port again after a reset; it can change.

Run the hardware checks one at a time while the bridge remains stopped:

```sh
.venv/bin/python scripts/check-module-device.py "$ESP_SERIAL_PORT"
.venv/bin/python scripts/check-device.py "$ESP_SERIAL_PORT"
.venv/bin/python firmware/check_attention_device.py "$ESP_SERIAL_PORT"
```

The module check covers usage and HEY states, missing and zero usage values, empty and paged mailbox lists, UTF-8 limits, live expression mappings and invalid frames. The original check covers native faces, timing, gaze and layout.

Set `ESP_SERIAL_PORT` in `.env` for future sessions, then run `pnpm start`. The board can take up to 8 seconds after a previous connection to announce readiness again. Updates currently use USB; there is no OTA update path.

## Pinned dependencies

The firmware uses:

- ESP-IDF v5.5.5, commit `b774170ff46c393eeb5e495ea37936038d3f4f4f`
- `waveshare/esp32_s3_touch_amoled_1_75` 3.0.1
- LVGL 9.4.0
- transitive versions and hashes recorded in [dependencies.lock](dependencies.lock)

The official BSP configures the display, touch controller and power hardware. Application code uses its APIs rather than duplicating board pin definitions. Flash is 16 MB, with a 15 MB application partition. PSRAM is 8 MB octal at 80 MHz. Display brightness is 40%.

## USB protocol

The bridge uses newline-delimited JSON at 115200 baud. Its frames are at most 2048 bytes including the newline. The board validates a complete frame before changing state. Invalid JSON, unsupported field values and oversized lines are discarded without an acknowledgement.

A state frame requires `type:"state"`, `v:1`, an unsigned 32-bit `seq`, a native `state`, `label`, `name` and `counts`. The native states are `working`, `blocked`, `done`, `idle`, `sleep`, `unknown` and `disconnected`. The count object requires `working`, `blocked`, `done`, `idle` and `unknown`, each an integer from 0 to 65535.

The firmware accepts labels up to 96 UTF-8 bytes and names up to 192 bytes. The bridge uses a stricter 48-byte limit for normal modules. Attention limits titles to 24 characters and descriptions to 48 characters, with a separate frame-size check. These common fields remain required for every module, even when a dashboard is visible.

Optional fields:

| Field | Meaning |
| --- | --- |
| `module` | `face`, `usage`, `hey`, `clock` or `roon`; omitted means `face` |
| `moduleIndex`, `moduleCount` | Position among enabled modules; provide both or neither. Count is 1 to 5 and index is from 0 to count minus one. Defaults are 0 and 1 |
| `dashboard` | Module metrics and connection state; omitted data remains unavailable |
| `expression` | A native pose override; omitted or null uses the logical `state` |
| `animation` | Legacy field; only omitted or null is accepted |
| `preview` | Boolean marking an explicit preview; defaults to false |
| `animationMs`, `ageMs` | Host animation clock and state age; provide both or neither |
| `epoch` | Unsigned 32-bit replay identifier |
| `look` | Normalised mouse gaze, or null for natural gaze |
| `textGap` | 4, 8 or 16 pixels; defaults to 8 |
| `statusDots` | Legacy boolean, accepted for compatibility but no longer changes the presentation |
| `attention` | Temporary face overlay with message `id`, `revision`, `detail`, `body` and one or two `actions` containing `id` and `label` |

When attention is present, tapping the face sends an `attention` event with `v:1`, the visible message `id`, `revision` and `action:"open"`. In details, a tap sends the selected action ID. Actions stack vertically. A double tap sends `__dismiss` from either view. Single taps wait 300 milliseconds so a double tap cannot trigger approval first. Vertical swipes scroll the body. Normal module controls are suspended until the bridge clears the overlay. Both the bridge and device reject stale responses; the device never executes an action itself.

The legacy `statusDots:true` value remains valid only with `state:"working"` and `preview:false`. New hosts should leave it false or omit it.

When no valid host frame has arrived for 8 seconds, the face shows Disconnected or the active dashboard shows Host disconnected. The board announces readiness every 2 seconds until the host returns:

```json
{"type":"ready","v":1,"board":"waveshare-1.75-b"}
```

## Native expressions and live mappings

`state` describes the logical agent status. `expression` changes the native eye pose without changing that status, its caption or the session name. For example, this complete frame shows sleeping eyes while retaining the Working label:

```json
{"type":"state","v":1,"seq":1,"state":"working","expression":"sleep","label":"Working","name":"Build project","counts":{"working":1,"blocked":0,"done":0,"idle":0,"unknown":0}}
```

The renderer runs on a 33 ms timer. Native expression transitions take 450 ms. Bloub supplies the eye profiles, perspective, gaze drift and repeating blink calendar. Default live idle becomes sleepy after 30 seconds. Explicit Sleep closes the eyes immediately; explicit Idle and idle previews stay awake.

Working shimmers its status text, including when another native eye pose is mapped to it. Ready uses the original wink. The faces retain their blinking and mouse-following without added spins, bounces or confetti.

`face_profiles.h` is generated from `web/face-model.ts`. `face_model.c` projects and rasterises the eyes into an RGB565 canvas. Native rendering and browser geometry are compared by `pnpm test`; SVG and RGB565 antialiasing can differ slightly.

## Module dashboards

`dashboard.status` is required when a dashboard object is present. It accepts `ready`, `loading`, `unavailable`, `auth` or `error`. Other fields are optional:

| Field | Limits and behaviour |
| --- | --- |
| `title` | Up to 32 UTF-8 bytes |
| Clock `time` | Valid 12-hour `5:20` or 24-hour `17:20` string without am/pm; required when ready. Legacy suffixed values up to 7 ASCII bytes remain accepted |
| Clock `weekday` | `Sun` to `Sat`, or empty when hidden |
| `refreshing` | Optional boolean, false when omitted; shows Checking only beside ready data |
| `detail` | Up to 48 UTF-8 bytes |
| `primary`, `secondary` | Usage metric objects with `provider`, `label`, `remaining` and `reset` |
| Metric `provider` | Up to 16 UTF-8 bytes |
| `pageIndex`, `pageCount` | Optional paired integers; zero-based index, page count 1 to 256 |
| Metric `label` | Up to 16 UTF-8 bytes |
| Metric `remaining` | Finite number from 0 to 100, or null/omitted when unknown |
| Metric `reset` | Up to 24 UTF-8 bytes; formatted by the host |
| `items` | HEY list with at most three objects, each requiring string `sender` and `subject` |
| Item `sender` | Up to 32 UTF-8 bytes |
| Item `subject` | Up to 64 UTF-8 bytes |

Unknown values stay visually distinct from zero. The usage view shows the windows supplied by CodexBar; the host does not invent missing Session or Weekly windows. HEY rows carry sender names and subjects. Message bodies, account identifiers and credentials are not part of this protocol. Legacy `count`, `countMore` and `boxes` fields remain accepted but are no longer rendered.

Usage uses 56-pixel Geist Pixel Circle percentages without card backgrounds, or 44-pixel percentages with card backgrounds, alongside horizontal bars. Two windows stack vertically; one window is centred. Each borderless card names its provider and uses a fitted window pill with 14 pixels of horizontal padding. Cards are 142 pixels high with equal 14-pixel top and bottom padding. Borderless sections start at y87 and y237 with an 8-pixel gap; visible cards start at y79 and y245 with a 24-pixel gap. The single-card view stays centred at y162. Bars represent remaining allowance, with green above 25%, amber at 25% or less and red at 10% or less. Zero has no fill; an unknown percentage shows `--`. The percentage font includes digits, percent, space and minus glyphs.

HEY shows up to three fixed rows at y68, y181 and y294, without a mailbox heading. Each row is 340 by 105 pixels with 10-pixel top and bottom padding. Sender names use a single 27-pixel line and subjects use two 27-pixel lines, both in Geist Sans 22. Long text uses an ellipsis. Empty mailboxes show a centred message. Usage and HEY do not show the shared face title or subtitle. Their connection and error views show a single centred title and subtitle, without a placeholder icon or repeated status text. During a refresh of ready data, cards remain in place while a Geist16 Checking label shimmers at y408. The indicator uses the shared host animation clock and disappears on completion, error, disconnection or a switch to the face.

Clock uses a 128-pixel Geist Pixel Circle time label centered at x233, with its ink centered near y233. The 22-pixel Geist Sans weekday sits below at y308. Hiding the weekday leaves the time in place. The host supplies local time every minute; there is no independent RTC clock mode. Host timeout shows the standard disconnected state. Clock has no card background, Checking indicator or vertical paging.

The host selects the active module, filters enabled modules and persists their order. The device renders the received snapshot and reports touch intent.

## Touch navigation

Releasing a short tap on the face module emits:

```json
{"type":"cycle","v":1}
```

The bridge cycles the selected agent and clears an explicit expression preview. Taps on usage or HEY do not cycle agents.

A left swipe requests the next module; a right swipe requests the previous one:

```json
{"type":"module","v":1,"direction":1}
{"type":"module","v":1,"direction":-1}
```

The device sends these only when `moduleCount` is greater than one. The bridge also checks its saved swipe-enabled setting, skips disabled modules and persists the new active module before sending it back. The firmware does not change modules on its own.

An upward swipe on a ready usage dashboard requests the next pair of cards; a downward swipe requests the previous pair:

```json
{"type":"usage-page","v":1,"direction":1}
{"type":"usage-page","v":1,"direction":-1}
```

HEY uses the same vertical gesture for three-message pages:

```json
{"type":"hey-page","v":1,"direction":1}
{"type":"hey-page","v":1,"direction":-1}
```

The device sends these only when `pageCount` is greater than one. The bridge wraps pages across selected provider windows or the recent mailbox list. Page selection is transient and independent of the setting for horizontal module swipes. The browser sends the same intent through `POST /api/usage/page` or `POST /api/hey/page`.

Audio uses vertical swipes to switch input and output. Tapping its title, percentage or device name opens a device picker:

```json
{"type":"audio-view","v":1,"open":true,"scope":"output","deviceId":78}
```

While `dashboard.pickerOpen` is true, `pageIndex` and `pageCount` describe device-list pages. `devices` contains up to three rows with `id`, `name` (up to 64 UTF-8 bytes) and `active`. Vertical swipes send `audio-page` with direction 1 or -1 to browse these pages. Selecting a row sends:

```json
{"type":"audio-control","v":1,"scope":"output","deviceId":78,"action":"device","value":78}
```

The bridge checks the current and chosen device IDs before applying a change. Selecting the active device closes the picker without changing the Mac audio device. There is no Back button. The browser uses `POST /api/audio/view`, `/api/audio/page` and `/api/audio/control` for the same actions.

The board reads touch interrupts independently of LVGL rendering and buffers movement with its original timestamps. Rendering delays cannot erase movement before gesture classification. Buffer overflow, read errors, multiple contacts, overlapping reports or interrupt service delays over 32 ms cancel the contact until release. Changing display rotation clears queued contacts.

Each contact produces at most one action. A swipe cannot also become a tap. Long holds, diagonal drags and cancelled contacts are ignored.

## Timing, gaze and typography

`animationMs` is the host's monotonic animation time. `ageMs` is the age of the current display state. They preserve blinking and idle sleep through ordinary updates and reconnection. The optional `epoch` distinguishes explicit replays. Small clock corrections within 100 ms are ignored while the display state and epoch remain unchanged.

For mouse gaze, `look:{"x":-1,"y":-1}` means the top left of the current monitor, `{"x":1,"y":1}` the bottom right, and zero the centre. Both values must be finite numbers in [-1, 1]. Omit `look` or use null to restore natural gaze. Host timeout also releases the gaze.

Mouse motion uses the same critically damped glide as the browser, covering about 95% of a move in 475 ms. New targets preserve the current velocity.

Geist Sans 22 is used for face status and Geist Sans 16 for the session name. Both labels have fixed single-line heights of 27 and 20 pixels, including startup and diagnostic states. Long text is truncated. Usage percentages use Geist Pixel Circle numeric subsets. HEY uses Geist Sans for senders and subjects. Reset durations and other supporting text use Geist Sans. Fonts cover Latin text and common punctuation. The bridge replaces unsupported HEY characters with `?` for consistent preview and device rendering; the configuration list retains the original text.

The session-name row starts at y=395. Status begins at `395 - 27 - textGap` for static text and shimmer alike: Close is y=364, Balanced y=360 and Wide y=352. Gap changes preserve animation age, and host timeout keeps the last accepted gap.

The 340 x 32 RGB565 shimmer mask occupies 21,760 bytes of PSRAM. `face_shimmer.c` tints it using the host clock and the colour curve in `shared/shimmer.json`.

See [Bloub attribution](../web/vendor/bloub/NOTICE.md) and [Geist font sources](../fonts/geist/README.md) for licences and regeneration details.

## Render acknowledgements

Every accepted state frame receives an `ack` containing its `seq`. Render diagnostics describe the most recent completed render, which can precede that newly accepted frame:

| ACK field | Meaning |
| --- | --- |
| `rendered_seq` | Sequence number of the completed render |
| `module` | Rendered `face`, `usage`, `hey`, `clock` or `roon` module |
| `render_us` | Render duration in microseconds |
| `eyes` | Each eye's width and height in model units; zeroed for dashboards |
| `shimmer_pixels` | Number of status-mask pixels rendered, or zero when inactive |
| `text_gap`, `status_top` | Actual rendered text layout |

To verify a change reached the screen, wait for `rendered_seq` to match the sent frame as well as its ACK. Diagnostics alone do not trigger another host state frame, avoiding a serial feedback loop.

`showModuleNavigation` is an optional boolean. Missing or false hides module page dots; true shows them when multiple modules are enabled. It does not change module count or swipe handling.

`showCardBackgrounds` is an optional boolean. Missing or false leaves usage and HEY cards on the black screen; true shows their dark panels. Borderless usage sections use larger percentages and closer spacing. HEY keeps the same text and layout. The playground saves this preference under Device > Display.

The optional boolean `nameShimmer` animates the Face session subtitle in Geist Sans16 at its existing position. The host cycles working session names every four seconds in All agents; name changes do not restart the face animation. Missing or false keeps the subtitle static. Local previews, non-Face modules and host disconnection suppress subtitle shimmer. Mapped native expressions support it. ACK diagnostics report `name_shimmer_pixels`.

### Now Playing sources

The `roon` module also displays Spotify and macOS Now Playing using the same artwork and controls. Optional dashboard `player` values are `roon`, `spotify` and `system`; older frames default to `roon`. Optional boolean `canLike` and `liked` fields control the heart action and its saved state. The source badge sits at the artwork's top left (System has no badge), and the heart sits at its bottom right. Expanded artwork hides both overlays.

When `pageCount` is greater than one, vertical swipes send `{"type":"roon-player","v":1,"direction":1}` or direction `-1`, even when a source is unavailable. Horizontal swipes still select modules. Tapping a supported heart sends `{"type":"roon-control","v":1,"action":"like","player":"spotify"}`. Playback controls include the player captured on touch. The bridge rejects controls queued for a different source and performs supported actions.
