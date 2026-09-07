# Validation

Checked on 5 September 2026 using Node 24.12, Herdr 0.8.0 and a connected Waveshare ESP32-S3-Touch-AMOLED-1.75-B.

- `npm run check`: 67 tests pass; TypeScript and the production build pass.
- Browser: live agent selection, reduced motion, desktop and 390-pixel layouts verified in ego-browser.
- Playground: clicked all five expression buttons in ego-browser and verified corresponding serial sequence acknowledgements from the device. Back to live restored the previous agent selection and was acknowledged. Playground state survived a page reload.
- Browser: stopping and restarting the bridge shows the correct offline state and recovers automatically.
- Fresh independent review: no blockers. Fixed name layering, spinner handling, stale connection labels and delayed serial updates found during review.
- ESP-IDF v5.5.5 build: application image 14,865,712 bytes, within the 15 MB partition. No application compiler warnings in the final build.
- Full 16 MB original flash backup: read successfully, verified against device flash by esptool, SHA-256 checked again before flashing.
- Flash: bootloader, partition table and application written and verified by esptool.
- Device protocol: correct board readiness, acknowledgements for all seven states, including explicit sleep, rejection of malformed and oversized frames, valid-frame recovery, and resumed readiness after host timeout all pass.
- Live bridge: Herdr connected, board connected. A 24-second observation received fresh acknowledgements throughout; maximum acknowledgement age was 1.64 seconds.

Physical appearance and touch behaviour require visual confirmation at the board. Serial checks prove firmware startup and state delivery, but cannot inspect the physical screen.

A fresh review of the playground change found no blockers. Removed the POST snapshot assignment to prevent an older response from replacing a newer event-stream update.

The playground regression checks also cover invalid presets, live Herdr updates during overrides, and touch/selection clearing an override.

Mouse following checks:

- The real macOS helper reports bounded coordinates. Observed sample gaps were 104 ms at the 100 ms setting, 502 to 504 ms at 500 ms, and 1004 to 1005 ms at 1 second.
- Unit checks cover default off, invalid settings, unsupported platforms, fragmented data, unchanged sample coalescing, interval changes, stale process output, disabling during compilation, helper failure, timeouts and retry. Mouse updates preserve selection, expression and idle sleep age.
- In ego-browser, enabling changed the preview eye transforms and the physical board acknowledged the matching sequence. Changing to 500 ms, switching expression and reloading preserved following. Disabling cleared the gaze, received an acknowledgement and stopped the helper process.
- The controls fit a 390-pixel viewport without horizontal overflow. Reduced motion still accepts direct gaze changes.
- A fresh review found a brief invalid eye transform when resuming animation after reduced-motion mouse updates. Added a failing regression test against the real Bloub engine, then fixed zero-duration gaze transitions; the test passes after the fix. Other review notes were low severity, with no blockers.
- Flashed the updated firmware and verified all seven states, gaze corners, fractional gaze, null release, invalid coordinates, malformed-frame recovery and host timeout readiness over USB.
- Left the running bridge connected to Herdr and the board, with the previous agent selection restored and mouse following off at the default 100 ms setting.

Local logs are under `.work/` and are excluded from version control. Re-run the device protocol check with the bridge stopped using `scripts/check-device.py` as documented in the firmware README.

Expression parity correction:

- The earlier ACK-only checks missed real visual mismatches: Ready had two closed eyes on the board; thinking, confused, gaze projection and blinking also differed. The firmware now uses profiles generated from the browser's Bloub definitions and the same geometry, transitions and repeating blink calendar.
- Compiled the native model with `-Wall -Wextra -Werror` and compared all seven expressions at nine animation times and four gaze settings, including after 15 and 30 minutes. Interrupted expression and gaze transitions also agree with the browser. Separate checks compare against the original Bloub expressions.
- A native framebuffer test verifies that Ready has a taller open left eye and a wider closed right eye. Visually inspected all seven native framebuffers beside the browser SVG output in ego-browser; the expression shapes match. The comparison image is `.work/expression-parity.png`.
- Flashed the firmware and verified the last-rendered sequence and eye dimensions for all seven states over USB. The first raster implementation exceeded the frame interval for Attention; optimized span filling reduced measured raster times from 14-51 ms to 11-17 ms. These timings exclude LVGL blitting and the display transfer.
- Clicked all five playground buttons and verified both the browser SVG and the board's rendered-eye diagnostics. Back to live restored the previous agent. A live idle test confirmed closed eyes on both displays after 30 seconds.
- Repeated blink calendars prevent the earlier 15-minute stop. Reduced motion uses a non-blinking sample and preserves direct gaze updates. Host state age prevents title changes or reconnects from waking only the board.
- A fresh independent review found no blockers. Fixed its remaining browser clock restart issue, added a regression test, then restarted the live bridge without reloading the test page. Browser geometry matched the new host clock within 0.01 in the rounded matrix values, and the board reconnected.
- Final bridge is running, previous agent selection restored. Physical touch behaviour and panel appearance still require observation at the board; framebuffer and rendered-eye checks provide stronger evidence than state ACKs alone.

Grok motion extraction:

- Extracted the thinking pose, Gaussian pulse, cubic spin easing, diminishing
  bounces and confetti from BIGAGENT commit
  `c7a498f0275229bdbad67c93c29e070bb85bd91b`, with its MIT license and an
  adaptation notice. Native particle parameters are generated from the same
  seeded source used in the browser.
- Native/browser parity tests cover all seven states at 181 samples through
  the sequence and at long-running times, checking motion transforms, every
  polygon vertex, alpha and colour. Completion stops after 2.2 seconds;
  reconnecting to an old ready state does not replay it.
- Raster tests cover concave star gaps, alpha blending, circular and label
  clipping, edge antialiasing and invalid input bounds. Fixed a coverage-buffer
  bug that could leave stale pixels between disjoint spans.
- Inspected six browser/native frame pairs in ego-browser. Geometry and the
  coloured burst match; comparison saved locally as `.work/animation-parity.png`.
- Flashed the board and passed all seven states, mouse gaze, malformed-input
  recovery and timeout readiness. Render diagnostics confirm 3 thinking dots,
  20 celebration particles and 0 particles after completion. Recorded raster
  times were about 15 ms for thinking and 25 ms for confetti, below 33 ms.
  These measurements exclude LVGL blitting and display transfer.
- Live playground clicks matched the board's decoration counts. Reloading
  after completion did not replay it. Reduced motion stopped effects, and the
  390px layout kept the session name below the smaller status without overflow.
- Fresh review verified state-age handling and clipping. It identified excess
  ACK snapshot broadcasts and a possible partial replay when leaving reduced
  motion. ACK diagnostics now publish together; resuming motion catches up to
  the host clock before sampling.

- Final `npm run check`: 33 tests and the production build pass. Verified reduced-motion resume after a ready state aged past the completion sequence: no replay or extra spin. The bridge is running with the saved pointer settings restored. The previous selected agent had ended, so selection fell back to All agents.


Mouse glide correction:

- Replaced the 180 ms ease-out-quint gaze with a critically damped response
  shared by the browser and firmware. It reaches about 95% of a target in
  475 ms. Every new pointer target preserves current position and velocity.
- Regression tests verify intermediate motion at 100 ms, continuous position
  and velocity under rapid direction changes, matching native geometry, and
  immediate reduced-motion updates even when the target is unchanged.
- `npm run check`: 35 tests pass and the production build passes. Flashed the
  firmware and passed the hardware state, decoration, gaze, malformed-input
  and reconnection checks.
- In an isolated browser fixture using the real Vue Face component, observed
  the eye centre move through 12 intermediate positions across the screen.
  Focus emulation enabled continuous browser animation during the check.
- Restored the saved live selection, expression and mouse update interval.

Complete Grok collection (current):

- All 39 named upstream states and eight actions extracted from the unmodified
  pinned renderer. Capture tests verify deterministic output, finite geometry,
  changing states and working action triggers. Exact double-spin and spin/burst
  click behaviour is preserved.
- All 47 generated clips decode losslessly. Browser and C players match frame
  hashes through seeks, replays, loop seams, reduced motion and long uptime.
  Native bilinear output matches browser pixels, with clipping above labels.
- Library: 14,149,290 bytes of flash, 192 x 168 RGB565 frames at 24 fps. Clips
  contain eight seconds; states loop from four seconds with a blended seam.
  Full source is retained; this is a finite seeded capture of procedural motion.
- Fixed an inherited startup setting that tried to copy the library into 8 MB
  PSRAM. Clips now stay in flash, with a 64,512-byte decoded frame in PSRAM.
  Firmware builds reject stale configurations that would copy rodata to PSRAM.
- Firmware, bootloader and partition table verified against flash by esptool.
  Final application size: 14,845,040 bytes. Original full flash backup retained.
- `scripts/check-grok-device.py`: all 47 physical-device selections returned
  source frame hashes matching browser decoding. Replay, invalid clip/epoch
  rejection and return to status faces passed. Rendering was 19,320 to 33,512 us,
  inside the 41,667 us budget for 24 fps clips. Timing excludes LVGL transfer.
- `scripts/check-device.py`: all seven original states, eye shapes, thinking
  dots, completion confetti, gaze, malformed input recovery and host timeout
  passed. Original face raster times were 10,916 to 16,884 us; confetti 24,237 us.
- Codec tests passed under address and undefined-behaviour sanitizers. Q16
  scaling also passed sanitizer checks at extreme dimensions and gaze bounds.
- Fresh independent review completed; actionable findings fixed. Explicit
  epochs prevent small delivery jitter from restarting clip playback, replay
  retries failed asset loads, and dropped browser frames use host clock time.
- Ego browser: all 47 previews rendered, Happy selection reached the actual
  device, Replay reset age to 53 ms, and the session caption remained below
  status. At 390 px, document width remained 390 px. A deliberately blocked
  clip fetch recovered after Replay; reduced motion selected the still frame.
- Vite now includes the generated clip directory in the production build.
  Temporary QA pages, static server, browser space and review workspaces removed.
  Live selection and enabled mouse following at 1,000 ms restored.

## Working status line

- Live working status now shimmers across Working or the working count,
  replacing the pulsing dots. Individual session titles remain below;
  All agents has no redundant subtitle or totals. Ready and Idle stay static.
- Browser and firmware share a 1.6-second highlight sweep in a 2.8-second
  cycle. The firmware caches a 21,760-byte text mask when the label changes.
- Browser checks covered a complete shimmer cycle, both label layouts,
  Ready, Idle and playground transitions, static text with browser reduced
  motion, and the 390 px layout without overflow. Thinking previews retain
  their original dots. Reduced motion remains a browser setting.
- All 60 tests and the production build pass. Native and browser colour
  samples match across the animation cycle and long uptime. Mask tests cover
  shape preservation, antialiasing and clipping; address and undefined
  behaviour sanitizer checks pass.
- The 14,847,264-byte application, bootloader and partition table were
  verified against flash. Hardware checks passed all seven states, shimmer
  label changes, clearing on Ready, Idle and preview transitions, gaze,
  malformed input recovery and host timeout. Live shimmer raster time stayed
  below 33 ms; this excludes LVGL blitting and display transfer.
- Fresh independent review found no blocking issues. The live selection and
  enabled mouse following at 1,000 ms were restored after device checks.

## Geist fonts

- Replaced the playground's text with locally bundled Geist Sans and Geist
  Mono. Device status, shimmer masks and session titles use Geist Sans at
  the existing 22 px and 16 px sizes. Label positions remain unchanged.
- Browser font inspection confirmed actual Geist glyphs for status and
  session titles, and Geist Mono for monospace labels. Both webfonts loaded
  locally. Working and count labels fit at 390 px and 1,200 px without page
  overflow; individual titles remained below status. Screenshot capture was
  unavailable in Ego, so browser checks used DOM geometry and font diagnostics.
- The generated LVGL fonts reproduce exactly from the pinned font source
  and converter. All glyphs fit their line boxes, including accents and
  descenders. The 27 px status line fits the existing 32 px shimmer mask.
- All 60 existing tests and the web and firmware builds pass. The application
  is 14,865,344 bytes, 18,080 bytes larger than the shimmer version. Application,
  bootloader and partition table hashes were verified after flashing.
- Physical checks passed all seven states, shimmer label changes and clearing,
  preview decorations, mouse gaze, malformed input recovery and host timeout.
  Base face raster times were 10,722 to 17,019 us, excluding display transfer.
- Fresh review found no blocking issues. Corrected the stale font metrics
  comment. Restored the selected agent, expression and mouse settings.

## All agents text layout

- All agents now sends its working count through the existing status field
  and its ready count through the session-title field. If none are ready,
  the lower row shows the idle count. Zero working is explicit; attention,
  unknown, empty and disconnected views retain their status messages.
- The browser and device use their existing individual-agent text rows.
  Browser measurements at 390 px and 1,200 px confirmed identical font family,
  font size, letter spacing, alignment and row bounds between individual and
  all-agent views. Both fit without horizontal overflow.
- Store and serial-link tests cover ready taking precedence over idle,
  readiness changing while work continues, zero counts, state priority,
  disconnection and returning to an individual session title. Count updates
  preserve the working animation's age. All 63 tests and the build pass.
- The live board acknowledged the new two-line payload and reported rendered
  shimmer pixels with no duplicate dots. Existing firmware already renders
  both fields with Geist 22 and 16 at the individual-agent positions.
- Fresh independent review found no blocking issues in the count priority,
  row reuse or transitions between all-agent and individual views.
- Working labels now include three literal dots: `Working...` and
  `N Working...`. The 19 relevant store and serial tests pass. Browser checks
  confirmed both labels fit at 390 px with shimmer intact, and the device
  acknowledged the update and rendered the shimmer. Fresh review found no
  blocking issues; selection and mouse settings were restored.

## Adjustable text spacing

- Text spacing offers Close (4 px), Balanced (8 px, default) and Wide (16 px).
  Only the status moves; the session-name or count row stays fixed. Firmware
  uses status tops 364, 360 and 352, with the name at 395. Balanced is 5 px
  lower than the previous status position.
- The browser uses the same gap scaled to the preview width. At 320 px,
  390 px and 1,200 px, all choices had a positive gap, the expected separation,
  a fixed lower row and no horizontal overflow. Checked working shimmer,
  individual Ready and the Thinking preview.
- The select persisted across page reload and an actual restart of an
  isolated bridge. Atomic saves occur in request order; failed saves leave
  the live setting intact. Invalid values and corrupt saved data are covered.
- All 67 tests and the web and firmware builds pass. Spacing changes preserve
  selection and animation age. Existing frames without textGap use Balanced.
- Flashed the 14,866,192-byte application; application, bootloader and
  partition-table hashes verified. Physical checks passed all three gaps in
  shimmer and static Ready, omitted-field defaults, malformed-frame rejection,
  all seven expressions, gaze and timeout recovery.
- The production UI select drove the connected board to status tops 364,
  352 and 360 for Close, Wide and Balanced. Device diagnostics matched each
  choice, and the browser's lower row stayed fixed. Left Balanced saved.
- Fresh review found no blocking issues. The temporary preview bridge and
  review workspaces were closed; the live bridge and mouse settings restored.

Working label update:

- Removed literal trailing dots from individual and All agents labels: `Working` and `N Working`. Shimmer and text spacing are unchanged.
- All 20 store and device tests pass. Fresh independent review found no blockers. Restarted the bridge, restored live settings and confirmed the board rendered the updated frame.

Original bouncing dots removed (5 September 2026):

- Removed the dot generator from the browser and native working accents. Both keep the gentle eye motion and use status shimmer in live view and playground previews, including previews without Herdr.
- The original playground buttons and captions now share the live labels: Working, Needs your input, Ready, Idle and Sleeping. The subtitle stays below the status at the saved spacing. Removed the browser-only static status bullet to match the board.
- All 67 tests, TypeScript and the production build pass. Native and browser accents agree across their sequences; the working decoration layer is empty. A fresh independent review found no blocking bugs.
- Flashed the 14,865,712-byte application and verified all flash hashes. Device checks pass for all seven states, zero working decorations, working preview shimmer, Ready confetti, all three text gaps, gaze, malformed input and host timeout. Baseline rendering took 10,569 to 16,364 us; the sampled celebration took 21,885 us.
- Browser checks at desktop, 390 and 320 pixel widths confirm matching caption positions and spacing, no overflow, no working dots, moving shimmer, Ready confetti and static reduced motion. Older dot references above describe previous versions.

Fixed text row heights (5 September 2026):

- Startup and diagnostic captions already used the same Geist fonts as live status. An LVGL 9.4 host probe with the real fonts measured 27/20 pixel rows at y=360/395 for Disconnected, Protocol check, Working, Ready and Checks passed.
- Long text exposed a separate wrapping bug: content-sized rows grew to 108 and 40 pixels. Both native labels now have fixed one-line heights of 27 and 20. The probe confirms long text no longer changes the row sizes or positions.
- Browser title and subtitle heights are explicit too, preserving their existing 1.3 line heights through startup and font loading. Measured startup, check and long labels retain the same positions and 13/11.7 pixel rows at the tested desktop size.
- Browser and firmware builds pass. Fresh independent review found no blockers. Flashed and verified all segment hashes, then checked device delivery/rendering of Working, Ready, long static text, Idle and Disconnected at the default gap. Targeted raster times were 10,492 to 14,768 us.
- The larger startup font reported by the user was not reproduced. Hardware checks deliberately exercise spacing settings; those temporary movements are separate from normal startup.

## Companion Studio revamp - 6 September 2026

Replaced the Vue playground with React 19, Vite 8, Tailwind 4 and the requested shadcn b0/base-nova preset. The studio defaults to English left to right, with RTL and theme settings.

- Automated checks: 112 tests passed after the integration and React migration. One additional compact usage-label regression test passes (113 tests in total). TypeScript and the production build pass. All 47 generated gallery thumbnails match decoded frames and use about 104 KB combined.
- Fresh independent review covered firmware, CLI adapters, persistent settings, API validation, React state and accessibility. Fixed HEY recovery after an initial timeout, slow refresh blocking controls, local Working shimmer parity, mapping-dialog auditions, icon navigation names, saved-provider visibility and stale pointer input during disconnect.
- Browser checks in Ego: actual CLI detection, enabling both modules, live usage and partial HEY counts, saving Working to Celebrate while retaining the logical Working caption, 52 library entries, search, local audition, swipe navigation, module selection, mobile layout, dark mode and RTL. Settings updates persisted through the real bridge API. No mock mailbox or usage values were used.
- Firmware application: 14,876,272 bytes. ESP-IDF build and native parser/touch tests pass. Actual LVGL desktop renders were inspected for usage, HEY and missing-data states. HEY count uses a native Geist44 digit subset.
- Flashed the bootloader, partition table and application to the connected Waveshare; esptool verified all written hashes.
- `scripts/check-module-device.py` passes over USB: every usage connection state, HEY unknown/zero/lower-bound counts, native animation remapping with logical Working shimmer, explicit idle versus automatic sleep, live Grok mapping without shimmer, malformed-frame rejection and legacy recovery.
- `scripts/check-device.py` passes over USB: all seven native states, actual rendered eye geometry, completion effects, shimmer, all three text gaps, gaze, malformed frames, recovery and host timeout.
- End-to-end production bridge checks: real CodexBar and HEY modules reached the device and returned matching rendered-module acknowledgements. A saved Working-to-Celebrate mapping reached the board with logical Working and zero shimmer pixels. Original mappings, active face view and mouse preferences were restored afterward.

Physical swipe feel and the AMOLED panel's appearance still require hands-on observation. Native gesture tests, LVGL renders and USB render diagnostics do not substitute for looking at or touching the physical panel.

## Optional module navigation

Module selector buttons, page dots and the swipe reminder now default to hidden. Device > Display > Show module selector enables them. The visibility setting persists independently of swipe navigation, including after loading older settings files.

Twenty targeted settings, module-parser and frame-size tests pass; web and firmware builds pass. An independent review found no blockers. Ego checks verified both toggle states, swiping while hidden and Return to live during auditions. Flashed and hash-verified application 14,876,368 bytes; the board accepted and rendered explicit true, false and omitted navigation fields. The running bridge uses the hidden default.

## Neutral developer themes

Replaced green studio chrome with shared neutral light and dark tokens across surfaces, controls, badges, selections, usage bars and notifications. Added labelled sun and moon buttons to the top bar; the System option remains in Device settings. Physical animation colours are unchanged.

TypeScript and the production build pass. Ego checks covered both theme buttons, saved theme state after reload, dark dialogs and a 360-pixel viewport without overflow. Independent review found one selected-row contrast issue; light secondary text now uses #666666 on #ededed, exceeding 4.5:1. Returned the studio to light mode after checking both themes.

## Usage progress cards - 6 September 2026

Replaced circular usage meters with stacked cards inspired by the supplied Clawdmeter and CodexBar references. The device and browser preview use large Geist percentages, window pills, horizontal remaining bars and reset countdowns. The footer states Usage remaining and CodexBar without repeating the provider heading. The studio readout uses matching cards for all returned windows, with shortened provider prefixes for mobile labels.

- Web and ESP-IDF builds pass. Ten targeted dashboard, parser and touch checks pass, including a provider with no usage windows taking the unavailable view.
- Actual LVGL fixtures cover normal, low, zero, full, tiny positive, unknown, missing and single-window values. The percent glyph is included in the Geist44 subset; HEY content is unchanged. Native and browser percentage baselines differ by less than one logical pixel.
- Browser fixtures verify matching bar widths, positive half-value rounding, absent cards and single-card centring. Light desktop and dark 360-pixel views have no horizontal overflow; the shortened Spark labels fit without clipping.
- Flashed and hash-verified application 14,877,024 bytes. All checks in scripts/check-module-device.py pass over USB, including usage connection states, missing values, HEY, live mappings and invalid-frame recovery.
- Reconnected the production bridge and confirmed live CodexBar values in both the browser and the device's rendered-module acknowledgement. Left usage visible for review, restored the selected agent, and retained hidden navigation and mouse-follow preferences. The temporary fixture server and browser task space are closed.
- Fresh independent review found no actionable issues. Physical panel appearance still requires hands-on observation.

## Provider paging and mailbox cards - 6 September 2026

Applied Mean inspections 26-09-06-00.46.17, 26-09-06-00.46.35 and 26-09-06-00.47.34. Usage and HEY no longer repeat the face title or subtitle. Usage cards are borderless, name their provider and use text-sized pills with green, amber and red remaining bars. All configured provider windows are available in pairs through vertical swipes, arrow keys or configuration page buttons. HEY uses a centred list of mailbox cards.

- Web and ESP-IDF builds pass. The 41 targeted dashboard, store, device, HTTP, native parser and touch tests pass. The six native parser/touch tests were rerun after the final firmware changes.
- Actual LVGL renders cover normal, low, empty, unknown, single and secondary-only usage cards, provider labels and long pills. HEY fixtures cover one to four cards, unknown, zero, lower bounds and large counts. Four-card layouts use 72-pixel cards to fit the round screen.
- Independent review caught clipping for five-digit HEY counts. Both renderers now use Geist22 from 10000 upwards. Native renders verify 20000, 50000 and 9999+ without truncation. The reviewer confirmed the fix and found no remaining issues.
- Ego browser checks verify touch paging, arrow keys, page buttons and wraparound. Long drags over 1.5 seconds are ignored. Light and dark views, all returned provider readouts, fitted pills, hidden shared captions, unknown and large mailbox values, and a 390-pixel viewport pass visual checks with no horizontal overflow.
- Flashed application 14,877,808 bytes and verified its hash. Updated USB module checks pass for provider pages, maximum page bounds, four-card HEY counts, native and Grok face restoration, malformed frames and legacy recovery.
- Live production bridge checks reached all seven configured windows across four pages: four Codex windows and three Claude windows. Each page received a rendered acknowledgement, page wrapping passed, and HEY rendered from the real source. Original module, selected agent and saved settings were restored.
- Closed the temporary browser task space and fixture server. The production bridge remains running on port 4317.

## Status and spacing cleanup - 6 September 2026

Applied Mean inspections 26-09-06-00.48.45, 26-09-06-00.49.33, 26-09-06-00.49.51 and 26-09-06-00.55.40. Connection and error screens now contain only one title and one subtitle. Removed the Modules tagline, switched the Studio and Workspace sidebar labels to Geist Sans, increased usage pill padding to 14 pixels, and rebalanced card padding with a 24-pixel gap.

- Web and ESP-IDF builds pass. Sixteen targeted dashboard, native parser and touch tests pass.
- Native LVGL fixtures verify the new usage positions, single-card centring, long labels and simple loading, authentication, error and disconnected states. HEY card geometry stays consistent.
- Ego browser checks confirm the two sidebar fonts, absent Modules tagline, exactly two labels in connection/error screens, no placeholder circles, 14-pixel pill padding and no horizontal overflow at 390 pixels.
- Fresh independent review found no actionable issues.
- Flashed application 14,877,664 bytes with hash verification. All USB module checks pass, including connection states, paging, HEY counts and restoration of native and Grok faces.
- Restarted the production bridge and confirmed the saved active module, usage page and settings, with a matching rendered-module acknowledgement. Live browser checks confirm the updated fonts, heading and cards. Temporary fixtures and the browser task space are closed.

## Background refresh - 6 September 2026

Applied Mean inspection 26-09-06-01.02.44. Same-query refreshes retain ready usage and HEY cards, values and timestamps while source.refreshing is true. New readings replace them atomically. A small Checking label shimmers below the cards and disappears when the refresh ends. Interval-only changes retain data; query changes and re-enabling start without cached cards. Errors keep their existing explicit error/auth states.

- Web and ESP-IDF builds pass. Seventy relevant bridge checks pass; 45 targeted source, dashboard, native parser/touch and shared-shimmer tests also pass after integration.
- Deferred source tests cover initial loading, refresh retention, atomic replacement, failure/recovery, interval/query changes, cancelled reads and stale generations. Usage paging stays available during a cached refresh. Frames with the refresh flag remain within 1024 bytes.
- Actual native LVGL renders at 0, 0.8 and 2 seconds keep every card pixel and Checking glyph position unchanged while 157 ink colours change during the sweep. Completion restores the original pixels; nonready states and disconnection hide the indicator.
- Ego checks verify stable card markup during refresh, changing shimmer gradients, completion cleanup, HEY, app and system reduced motion, and a 390-pixel viewport with no overflow.
- Fresh independent review found no actionable issues. Flashed application 14,878,416 bytes with hash verification. Updated USB checks pass, including ready refresh start/finish, hidden indicators in nonready states, HEY and face recovery.
- A real CodexBar refresh retained the providers, values, updatedAt and selected page while both source and dashboard reported ready/refreshing. The timestamp advanced after completion and Checking cleared. The live browser observed cards throughout the refresh. Original module, page and settings were restored; the bridge remains running.
- Closed the temporary fixture server and dedicated browser task space after verification.

## Card spacing and optional backgrounds - 6 September 2026

Applied Mean inspections 26-09-06-01.05.55 and 26-09-06-01.16.27, including the request for equal top and bottom padding. Usage cards now have 14-pixel label-box padding at both ends and four more pixels between the provider and percentage. Cards are 142 pixels high, centred with a 24-pixel gap. Device > Display has a Show card backgrounds toggle for Usage and HEY, off by default for new and existing settings.

- Web and ESP-IDF builds pass. Forty-three targeted settings, store, dashboard, native parser, touch and HTTP tests pass. Saved choices survive restart, invalid values are rejected, and frames remain within the serial limit.
- Native LVGL renders measure equal 18-pixel visible top and bottom padding and a 14-pixel provider-to-percentage gap. Single cards, large percentages, unknown values and long pills fit. Background off/on/off restores identical pixels and preserves all text, pills and bars.
- Ego browser checks verify the toggle updates both Usage and HEY panels, defaults off, and keeps the existing card geometry. The 390-pixel viewport has no horizontal overflow.
- Fresh independent review found no issues. Flashed the 14,878,560-byte application with hash verification.
- All nine USB check groups pass, including optional backgrounds for both modules, invalid-frame rejection and face recovery. The production bridge is running with the original active module, page and settings restored.
- The live Device toggle changes the preview and saved preference in both directions while usage stays ready on the same page. Reload preserves off. Temporary browser and fixture server are closed.

## Geist Pixel percentages - 6 September 2026

Usage percentages use Geist Pixel Square in the device preview, the module usage readouts and the firmware. Provider names, pills, reset text and HEY counts retain Geist Sans. The checked-in webfont and device source font match the official pinned Geist repository and its existing licence. The font generator produces a separate 44-pixel LVGL subset for digits, percent, space and minus signs.

- Web and ESP-IDF builds pass. Fresh independent review verifies source hashes, licence, reproducible generation and native glyph bounds.
- Native LVGL fixtures cover 0%, 100%, unknown values, single and paired cards, long labels, and HEY isolation. Percentage text fits its 138-pixel column without moving the existing card layout.
- Ego browser checks confirm the real webfont loaded, Pixel on usage percentages only, and Sans on surrounding text and HEY. All seven module usage readouts use Pixel; the 390-pixel layout has no horizontal overflow.
- Flashed the 14,882,960-byte application with hash verification. USB render acknowledgements pass for 0%, 100%, unknown values and visible card backgrounds. The production bridge is running, the live playground loads the Pixel font, and the original Face module and settings are restored.
- Closed the temporary fixture server and dedicated browser test space.

## Geist Pixel Circle - 6 September 2026

Changed the usage percentage font from Geist Pixel Square to Circle in the preview, module readouts and device font subset. The unmodified Circle assets use the same pinned upstream commit and licence. Removed unused Square assets and updated font generation and documentation.

- Web and ESP-IDF builds pass. Browser checks confirm Circle is loaded and 0% and 100% fit the existing 138-pixel column. Card geometry stays the same.
- Independent review confirms official Circle file hashes, reproducible font generation, and native 0%, 100% and unknown-value renders without clipping. No active Square references remain.
- Flashed the 14,882,960-byte application with hash verification. Four targeted USB render checks pass. The live preview uses Circle, and the selected agent, usage page and settings are restored. Closed the temporary fixture server and browser test space.

## Grid percentages and HEY counts - 6 September 2026

Usage percentages and HEY counts now use Geist Pixel Grid in both the playground and device. Added a 22-pixel Grid subset for long HEY counts and included the plus glyph in both sizes. Native label insets account for Grid's shorter glyph boxes. Reset durations, provider names, mailbox labels and units retain Geist Sans.

- Web and ESP-IDF builds pass. Independent native review verifies normal percentages, 0%, 100%, unknown values, four HEY cards and large counts without clipping or overlap. LVGL measures 9999+ at 135 of 138 pixels and 999999+ at 96 of 138 pixels in the compact font.
- Both Grid font subsets regenerate consistently. The font declarations, CMake entries and scoped CSS agree.
- Browser checks confirm Grid is loaded for percentages and HEY counts, including compact counts, while supporting text remains Sans. HEY module readouts use Grid at regular weight. The 390-pixel layout has no horizontal overflow.
- Flashed the 14,879,424-byte application with hash verification. Eight targeted USB render checks pass, covering percentages, unknown values, zero, 9999+, 20000 and 999999+.
- The live playground loads Grid and shows HEY counts in it. The selected agent, HEY module and saved settings are restored. Closed the temporary fixture server and browser test space.


HEY Imbox list, 6 September 2026:

- Replaced mailbox count cards with sender and subject rows, three per device page. The collector reads up to 30 recent entries, including bundles, with an explicit partial-list flag. Screener uses the same read-only list contract.
- 74 targeted backend, protocol, store, server and native tests pass. Checks include malformed entries, Unicode fallback, bounded escaped frames, pagination, refresh retention, cancellation and empty mailboxes. Independent review checked worst-case frames below the 1024-byte limit.
- Production web and ESP-IDF builds pass. Six native LVGL fixtures verify row positions, typography, truncation, empty states, optional backgrounds and Checking. Browser checks cover light and dark themes, 390-pixel width without overflow, buttons, arrow keys and vertical touch swipes. Fictional mail is used in visual artifacts.
- Fixed review findings for unsupported font glyphs, two-line subject ellipsis and stale counts-only help copy. The full source list retains original supported text; the device and preview share glyph fallback and byte-bounded truncation.
- Flashed application image 14,879,120 bytes. Esptool verified the written images. USB checks passed for connection states, cached refreshes, card backgrounds, empty and populated pages, bounded UTF-8, long subjects, malformed frames and Face/Grok regressions.
- Live Imbox returned 30 rows. The preview matched each row on the selected page, and a keyboard page change reached the live HEY dashboard. Restored the saved module, page, selected agent and settings; the board acknowledged the restored HEY view.

USB diagnostics confirm rendering and state delivery. Native framebuffers provide visual checks; physical panel appearance and finger swipes still require observation at the board.


Return to Geist Pixel Circle, 6 September 2026:

- Restored the pinned Circle TTF and WOFF2 assets, updated pixel font families and regenerated the 22 px and 44 px firmware subsets. HEY remains in Geist Sans.
- Web and ESP-IDF builds passed. Independent native rendering checks confirmed 0%, 100% and missing values fit the existing numeric slots and card geometry. Browser font loading and visual inspection confirmed Circle in the preview and usage readouts.
- Flashed and verified the 14,879,440-byte application. USB checks rendered 0%, 100%, missing usage and the HEY list successfully. Restored saved settings, selection, module and page, then refreshed the existing playground tab.


Clock module, 6 September 2026:

- Added a built-in clock with 72 px Geist Pixel Circle time, 12-hour default, configurable 24-hour format and an optional weekday underneath. Existing settings retain their order and preferences when Clock is appended.
- All 93 targeted backend, settings, source, HTTP/SSE, store, serial and native tests pass. Checks include midnight/day rollover with no Herdr or hardware, persistence, migration, strict time syntax and four-module navigation.
- The native renderer checked all 2,880 daily 12-hour and 24-hour strings; maximum width is 296 of 400 px. Inspected normal, longest, 24-hour and weekday-hidden fixtures. Web and firmware builds pass.
- Browser checks cover format changes, weekday visibility, reload persistence, enabling/disabling, reordering, horizontal swipes and light/dark mobile layouts. Fixed four module buttons overlapping the arrows in a 270 px preview; all six controls now fit. A fresh independent review found no other defects.
- Flashed the 14,892,064-byte firmware image and verified it with esptool. USB checks passed for Clock formats, weekday visibility, four navigation dots, malformed-frame rejection and existing Usage, HEY, Face and Grok behavior.
- Enabled Clock with 12-hour time and weekday visible, preserving other saved preferences and appending Clock after the existing modules. The board reported Clock rendered. Observed the live preview advance from 2:09am to 2:10am. Opened the clock controls in the user's existing playground tab.

Clock without am/pm, 6 September 2026:

- Removed the suffix from 12-hour time in the shared dashboard and configuration example. The native parser accepts one-digit hours without a suffix and retains legacy suffixed input compatibility.
- All 19 focused clock, HTTP/SSE and firmware protocol tests pass. Web and firmware builds pass; independent review found no defects. Browser inspection confirmed centered `5:20` with the weekday below.
- Flashed the 14,892,096-byte application with hash verification. Six USB render checks passed for 12-hour, 24-hour and optional weekday displays. Restored the exact saved settings and selection; the live board reported Clock rendered at `2:15`, with `Sun` underneath. Refreshed the existing playground tab and closed temporary test resources.

Larger HEY message text, 6 September 2026:

- Increased sender and subject text from Geist Sans 16 to 22 in the preview and native renderer. Removed the mailbox heading from populated and empty views. Three rows retain single-line senders and two-line subjects with ellipsis.
- Panels are 340 by 105 pixels at y68, y181 and y294, with equal 10-pixel vertical padding. Independent review caught and resolved clipping of optional panel backgrounds at the circular edge. Checking and navigation remain clear.
- Web and firmware builds pass. Six native fixtures cover normal, long, single, empty, refreshing and panel-background views. Browser checks confirm 22-pixel text, matching geometry and no visible Imbox heading.
- Flashed the 14,892,048-byte application with hash verification. Fifteen targeted HEY USB renders passed across refresh states, background toggles, empty and paged lists, UTF-8 and long subjects. Restored saved settings and selection, refreshed the existing playground, and closed temporary test resources.

Larger Clock time, 6 September 2026:

- Increased Geist Pixel Circle time from 72 to 128 pixels and regenerated the native font subset. Time remains centred, with the 22-pixel weekday below at y308 in both renderers.
- All 2,880 daily 12-hour and 24-hour strings fit the 400-pixel slot: maximum native width376 pixels, browser width374.53 pixels. Native frames confirm weekday visibility, module switching and disconnection behavior. Independent review found and resolved a preview weekday-position mismatch; final review is clear.
- Web and firmware builds passed. Flashed the 14,916,608-byte image with hash verification. Eight targeted USB render checks passed, including the widest time values and hidden weekday.
- Preserved the user's latest module order and preferences, refreshed the existing playground, and closed the isolated browser and fixture server.

Working session subtitle rotation, 6 September 2026:

- Read Mean inspection 26-09-06-02.28.27 with its frame and region. All agents now cycles through working session names every four seconds in the existing 16-pixel subtitle row, with a muted shimmer. Attention titles remain intact; zero workers restores ready or idle counts.
- Rotation retains session identity across ordinary updates and stops for individual sessions, explicit previews, inactive Face and disconnection. Subtitle changes preserve the face animation epoch and age. Mapped Grok and native faces both support the subtitle.
- Added strict optional nameShimmer protocol support and independent native mask/diagnostics. Shared muted color and timing parity, UTF-8/long-name truncation, actual LVGL mask bounds and native parser selfchecks pass.
- All 153 tests pass, including real HTTP/SSE rotation without hardware. Web and firmware builds pass. Browser checks cover cycling, stable size/position, long names, fallbacks, individual views, previews, attention, mapped Grok and reduced motion. Fresh independent review found no remaining defects.
- Flashed the 14,917,952-byte application with hash verification. Ten USB render checks passed. Restored saved settings and All agents; the live view cycled through four subtitles with five workers during observation. Refreshed the existing playground and closed temporary browser/server resources.

Borderless usage spacing, 6 September 2026:

- Read Mean inspection 26-09-06-02.38.39 with its frame and region. With card backgrounds off, percentages use Geist Pixel Circle56 instead of44 and two usage sections sit16 pixels closer together at y87 and y237. Visible cards retain the44-pixel font and previous spacing; single sections remain centred.
- Web and firmware builds passed. Independent native checks verified every0..100% value and the missing-value marker fit138 pixels (maximum135 pixels), with clear provider, pill and track spacing. Repeated background toggles restore font, label height and position. No pixels cross the circular boundary.
- Browser checks covered normal, extreme and missing percentages, long labels, single/secondary-only sections and visible backgrounds. Both renderers match. Fresh independent review found no defects.
- Flashed the14,925,120-byte application with hash verification. Eight USB checks passed for background toggles, extreme/missing values and single sections. Restored the current usage page and exact saved settings, refreshed the playground and closed temporary test resources.

Usage spacing and two-message HEY pages, 6 September 2026:

- Added four pixels each between the usage provider and percentage, and between the percentage and progress bar. Native and browser cards grow by eight pixels with balanced outer padding, including visible-background and single-window layouts.
- HEY now pages two messages at a time, using Geist Sans 28 instead of 22 for sender and subject. Subjects retain two-line truncation; cards have equal 12-pixel vertical padding. Backend paging, HTTP controls and device gestures cover every message without skips or duplicates.
- All 154 tests and both production builds passed. Browser fixtures covered long text, empty lists, backgrounds and usage extremes. Independent native fixtures verified matching geometry, ellipses and circular-screen bounds.
- Flashed the 14,977,040-byte application with verified hashes. Fifteen HEY and eight usage USB render checks passed. Restored usage page 2 and exact saved settings, refreshed the playground and closed temporary test resources.

Realtime module designer, 6 September 2026:

- Read Mean inspection 26-09-06-02.45.37 and its frame/crop. Removed the redundant Local tag from the connection header.
- Added a dedicated designer with 58 schema-driven controls for Face, usage, HEY and Clock. Includes live saving, paused previews, sample content, searchable properties, undo, property/module resets, layout guides and design import/export. Drafts and paused mode survive navigation in the same tab; failures retain edits for retry.
- Shared numeric schema validates persistence and active-module serial arrays. Legacy settings receive exact current defaults. Firmware and browser share layout parameters, existing Geist font choices and custom shimmer palettes. Native frame limit is 2048 bytes with checked bounds and larger serial buffers.
- All 164 tests passed, including strict native schema and production parser boundaries. Both production builds passed. Native fixtures cover all modules, custom fonts/colours, three HEY rows, narrow numeric ellipsis and 216 face mask cases with odd widths. Browser checks cover autosave, pause-before-debounce, navigation retention, failed-save retry, import, search, undo and responsive light/dark layouts down to 390px. Review findings on saving and navigation were fixed.
- Flashed the 14,983,488-byte application with verified hashes. Twelve USB render checks passed for defaults and custom designs across all four modules. A live settings API change moved the Face status to y348 and received a rendered acknowledgement; restored the original design, active Face module and exact preferences afterward. Closed temporary browser fixtures and opened the designer in the playground.

Flexible designer sizes, 6 September 2026:

- Replaced fixed font choices with 1px steps: Sans 12-48px and Pixel Circle 24-160px. Percentage sizing retains Automatic mode. Added Face size at 50-150% for original and Grok animations, preserving animation timing and separate labels.
- Firmware embeds Geist fonts with stable handles per text role and bounded glyph caches. Expanded shimmer masks, exposed font allocation errors, and retained legacy Face arrays with scale 100. Default 100% animation pixels remain unchanged.
- All 169 tests and web/firmware builds passed. Native fixtures rasterized 533 font combinations and checked 2,664 shimmer mask cases. Scaling fixtures verified browser/native parity at 50, 75, 100, 125 and 150 percent. Independent review completed.
- Flashed the 15,449,568-byte application with verified hashes. Twenty USB cases passed across all four modules, including odd font sizes, minimum/maximum sizes, original/Grok scaling and font-error diagnostics. Corrected an invalid alignment value in the temporary checker; no firmware fix was needed.
- Verified a live settings change to 31px/19px Face text and 120% scale reached the device, then restored those temporary fields. Preserved the user's newer usage-layout edits made during validation. The bridge is connected with no font errors; temporary browser/fixture resources were closed.

Session-name Greek glyphs, 6 September 2026:

- Read Mean inspection 26-09-06-03.32.05 and its frame/crop. The pi in the session name was absent from the generated standard-size Sans fonts.
- Added the Greek range to font generation and regenerated 16, 22 and 28px fonts. Native regression checks confirm a real pi glyph at every Sans size from 12 through 48; visually inspected 16px and 19px session fixtures.
- All 169 tests, 533 native font cases and the firmware build passed. Independent review found no issues. Flashed the 15,451,696-byte application with verified hashes; four USB cases rendered pi session names at 16, 19, 22 and 28px without font errors, including Grok subtitle shimmer.

Promoted saved configuration, 6 September 2026:

- Replaced built-in studio settings with the user's saved configuration, including tuned usage geometry, 57px percentages, dark theme, mouse follow, enabled modules and module order. Synced every schema property default and regenerated native defaults.
- Browser reset check changed percentage size to 65px, then verified Reset module restored 57px, progress position 98 and row gap -8. Independent review confirmed all defaults and reset paths match the captured setup.
- Updated test fixtures to declare module states/order explicitly rather than depend on the previous defaults. All 169 tests, web build and firmware build passed.
- Flashed the matching firmware with verified hashes. All four modules rendered successfully with design arrays omitted, exercising native defaults. Restarted the bridge and verified exact settings restoration and connected device state.

Roon module, 6 September 2026:

- Read Mean inspection 26-09-06-03.36.54, including its marked frames and crops. Added a fifth module with official Roon pairing, zone selection, album art, title/artist and Previous/Play-Pause/Next controls. Added thirteen Designer properties with matching preview and native layout.
- Connected to the user's Roon Server after they enabled Companion Studio in Extensions. Automatic selected the playing D90SE zone. Real metadata and artwork reached the browser; an intercepted browser Next action verified route wiring without changing music playback.
- All 188 tests, the production web build, 607 native font cases and the firmware build passed. Independent review caught two restart cases in artwork transfers; both were fixed and covered by forced transfer-ID reuse regressions. Final review found no remaining issues.
- Flashed application 0xebdd90 with verified hashes. The physical USB check acknowledged one begin, 67 chunks and one commit for a complete 51,200-byte image; the Roon dashboard rendered without font errors.
- Restarted the production bridge, enabled Roon and verified live D90SE metadata with a connected device. Compared all previous settings exactly after excluding the new Roon fields, appended navigation entry and intentional active-module change; all were preserved. Pairing remains separate from exported settings.

Clock separator blink, 6 September 2026:

- Read Mean inspection 26-09-06-03.47.17 and its full frame and crop. Added Blink separator under Clock configuration and Designer, enabled by default, with persisted opt-out. Older saved settings acquire the new default.
- The browser hides only the colon span with a one-second stepped opacity animation. Verified visible/hidden phases have identical text and colon bounding boxes. The settings switch removes blinking and persists false. Reduced-motion preview preferences keep it steady.
- Native rendering colors only the colon glyph using label selection, preserving the unchanged time string. A pixel probe covers 2466 combinations of all Pixel sizes24..160, three alignments, full/clipped widths and 12/24-hour samples. Non-colon pixels, including truncation dots, are identical across phases. Disabling while hidden, text updates and disconnection are covered.
- All 190 tests and production web/firmware builds passed. Native binary is 0xebe090 bytes.
- Flashed with verified hashes. Both enabled and disabled clock frames rendered on the physical device without font errors. Restarted the production bridge, restored the previous Roon view, and compared saved settings: only the new default-on blink flag was added.

Pixel progress variants, 6 September 2026:

- Read Mean inspection 26-09-06-03.49.36 with its frame and crop. Added Solid, Square pixels and Circle pixels in Designer's CodexBar progress controls, with pixel size and spacing. Solid remains the built-in default.
- Browser SVG patterns and native bounded canvases use centred full-cell grids, transparent gaps and exact percentage clipping. Track and fill use disjoint regions so antialiased circles do not double blend. Verified the browser Designer dropdown changes and persists the style.
- All 191 tests and production web build passed. Native review independently confirmed bounds, transparent gaps, partial fills, buffer reuse and legacy design compatibility. Targeted tests include 31,252 raster cases. Actual LVGL renders were inspected; returning to Solid is pixel-identical to the original solid rendering.
- Older 25-field usage frames preserve their values and acquire the appended solid defaults. Firmware build passed: 0xebe570 bytes.
- Flashed with verified hashes. Solid, square and circle frames rendered on the physical device without font errors. Restarted the bridge and confirmed exact saved-settings preservation, with Solid still selected.

Roon artwork view and transport styling, 6 September 2026:

- Read Mean inspections 26-09-06-03.54.06 and 26-09-06-03.55.42, including both full frames and crops. Removed the play/pause background, enlarged its icon and added tap-to-expand circular artwork with a slow playing-only spin and tap-to-collapse.
- Preview and native use a 430px disc, 280ms geometry transition, 180ms text/control fade, 12px chrome offset and 20-second rotation. Pause retains angle; interrupted transitions continue from current geometry. Image overscan prevents corner wedges while returning to a rounded square. Custom layouts restore exactly.
- Real browser pointer checks verified artwork expansion, dragging away and returning without an accidental tap, collapse to the original geometry, transparent playback buttons and actual playback hit detection. Playback requests were intercepted locally, so music was not changed. Fixed inherited pointer-events that had blocked preview transport clicks.
- Independent browser motion checks covered endpoints, pause retention, collapse, reduced motion and RAF cleanup. Native tests include 1,000 interruptions and guard against playback hits beneath a collapsing cover. Final independent native review found no remaining issues. Firmware build passed: 0xebf0d0 bytes.
- All 196 tests and the production web build passed. Flashed with verified hashes. Real-cover USB cases passed for normal, expanded-playing, expanded-paused and collapsed views without font errors. Restarted the production bridge and verified exact preservation of the latest saved settings and selected module.

Roon placeholder and Reicon downloads, 6 September 2026:

- Removed the missing-art text in preview and native rendering, preserving the placeholder shape and tap rules. Web and firmware builds passed; firmware 0xebf0b0 flashed with verified hashes. Restarted the bridge with saved settings preserved.
- Used ego browser to search Reicon and export filled Previous, Next and Play SVGs. Saved unmodified exports under public/icons/reicon with source links and the site's MIT license. Validated all three SVG XML documents and viewBoxes.

### Roon still artwork (Mean 26-09-06-04.37.32)

Removed the centre hole from the browser and native artwork. Continuous rotation is disabled in both renderers; expansion, collapse and touch protection remain. Investigated GPIO13 TE synchronization: the board exposes the signal and its panel initialization enables it, but the adapter's supported TE path uses full frames at the existing 40 MHz QSPI rate (21.7 ms minimum per frame), with unsynchronized fallback for missed windows. The experimental display startup was not selected for release because it could not establish reliable tear avoidance and would change every module's rendering path.

Validation: web build and all 196 tests passed. Independent motion reviews passed, including 1,000 interrupted native transitions, reduced-motion handling and browser RAF cleanup. Native LVGL fixtures confirm a solid centre and identical settled expanded artwork during playback and pause. Firmware build passed using the original board startup.

Device delivery: flashed and verified by esptool. USB checks passed for normal, expanded playing, expanded paused and collapsed Roon frames with artwork transfer and no font errors. Restarted the bridge; device rendered Roon successfully and saved settings matched the pre-flash snapshot exactly.

### Reicon Roon controls

Replaced Previous, Next and Play in the playground and device with the downloaded filled SVG shapes. Native alpha masks are generated from the originals; the preview shares an SVG component across both Roon views. Pause remains the existing two-bar glyph. Web and firmware builds passed, all 196 tests passed, and independent reviews verified source paths, sizing, tint, disabled opacity, fades and action wiring. The native LVGL fixture covered 123 renders across control sizes 32 to 72.

Flashed and verified with esptool. The bridge reconnected to the device with no font errors, and the saved settings matched the pre-flash snapshot exactly.

### Roon configurable controls and opt-in motion

Mean 26-09-06-04.57.57 promotes title size 28, artist position 316, artist size 21, controls position 358, button size 64 and spacing 12 to built-in defaults. Controls remain adjustable from 28 to 72px. Added independent Designer switches for artwork expansion animation and spin, both off by default. Default expansion/collapse snaps immediately; enabled animation uses 280ms geometry and 180ms chrome transitions. Spin runs only with expanded artwork during playback and pauses in place. Reduced motion overrides browser animation and spin.

The web build and 197 tests passed, including migration of old saved layouts with motion off and persistence of both options. Independent review covered wire compatibility, interrupted motion and narrow-screen control layout.

Final firmware flashed and verified. USB checks passed for all four motion combinations, paused spin and instant collapse with complete artwork and no font errors. Bridge reconnected; only the requested Roon defaults and motion flags changed, with other settings preserved.

### HEY and usage card links (Mean 04.58.58 and 04.59.36)

Added tap-to-open through the Mac's default browser for live HEY rows and supported provider usage cards. HEY uses supplied app links rather than guessing topic IDs; provider links come from verified CodexBar metadata. Card identity tokens protect against page/source changes during a gesture. Native touch capture and preview gestures preserve swipes and reject drag-return, long holds, cancelled contacts and stale cards.

Web and firmware builds passed. Independent reviews covered URL resolution, launcher arguments, page races, custom hit regions, disabled/sample cards and keyboard controls. Real ego-browser checks with intercepted requests confirmed single HEY and usage opens, Enter activation, and vertical paging without opening. Native fixtures covered custom layouts and production touch-handler paths. No real messages were opened during testing.

Firmware flashed and verified. Real USB HEY and usage frames containing the new card tokens were acknowledged with no font errors. The live bridge reconnected and saved settings matched the pre-flash snapshot exactly. All 204 tests passed.

### Saved display rotation

Added Device > Display > Display rotation with 0, 90, 180 and 270 degrees clockwise. Existing settings default to 0. Every module state carries rotation and ACKs report the applied angle. Preview content rotates independently of its housing. Native partial RGB565 updates rotate through the supported bitmap callback, preserving the panel crop, byte order and DMA completion path; touch coordinates are inverted once. Orientation changes cancel gestures and force one full redraw.

Web/firmware builds and all 206 tests passed. Pixel tests covered 868,624 point mappings and 2,000 partial rectangles; independent review checked 400 additional randomized rectangles. Preview tests covered 60 rotation cases and 26 card cases. Ego-browser verified a 90-degree preview card tap, correctly oriented paging swipe and the setting's numeric payload, with network actions intercepted. Browser task space closed after testing.

Device firmware flashed and verified. Real USB checks acknowledged all four applied rotations without font errors. Restored 0 degrees and restarted the live bridge; other saved settings matched the pre-flash snapshot.

### Free physical rotation and upright preview

Expanded saved physical rotation to integer degrees from 0 to 359. Device settings use a slider, numeric field and quick presets; drag saves on release, keyboard updates are debounced, and failed saves restore the last acknowledged value. The web preview no longer rotates or remaps gestures based on this physical setting.

Native arbitrary rotation keeps a complete logical backing and resamples the accumulated dirty area once at the final LVGL flush. Bilinear RGB565 sampling preserves text edges, neighboring pixels and transfer alignment. Cardinal angles retain their exact path. Larger transfer memory is allocated safely, without freeing an active DMA buffer; allocation failure preserves the current angle.

Web and firmware builds and all 207 tests passed. Tests covered all 360 parser and touch angles, partial/full redraw equivalence and independent color checks. Independent review checked 320 dirty updates and flush-buffer safety. Browser checks verified a 37-degree save and an upright, tappable preview despite a saved 90-degree physical angle. Widget checks covered throttling, editable values, external updates and save failure. Browser test space closed.

Final firmware flashed successfully. Real USB checks acknowledged 15, 37, 359 and 90 degrees without font errors. The live bridge reconnected at the saved 90-degree angle; all settings matched the pre-flash snapshot exactly.

### Arbitrary rotation freeze correction

Free-angle refreshes exhausted internal DMA memory through queued bounce buffers. The board SPI integration now bounds the transfer queue to one chunk and keeps internal DMA. Direct PSRAM DMA was tested on hardware and rejected after transfer errors. The application also holds the display lock while setting startup brightness, preventing a race with LVGL's first flush. Managed BSP sources remain unchanged.

ACKs now include successful panel submission counts, transfer error and submitted angle. The earlier rotation ACK alone only proved scene preparation, so it was insufficient evidence of physical rendering. Real USB validation now requires advancing panel counts over successive animated refreshes at each angle.

Final firmware flashed. Continued transfers passed at 22, 1, 89, 91, 179, 181, 269, 271, 359 and 0 degrees with zero panel errors. Two further hardware resets reached UI ready without bus errors. All 210 tests passed, including bounded queue configuration and transfer telemetry. Web preview remains upright.

### Optimized arbitrary rotation and device palettes

Rotation tracks changed logical pixels before sampling, skips identical invalidations and tightens changed regions. The bilinear interior path is optimized without changing output. Angle changes force a full redraw; failed transfers retain a full retry. Native randomized tests cover sparse changes and all angles. The optimization applies to every custom angle.

Physical benchmark with the same working-face animation at 85 degrees: previous firmware submitted 44 refreshes in 8.009 seconds; optimized firmware submitted 112 in 8.014 seconds (about 5.5 to 14 updates/second). This is one representative workload, not a guarantee for full-screen artwork. All sampled panel errors were zero.

Independent device Light, Dark and System modes have nine semantic color tokens per palette. System uses the host appearance reader, not dashboard preferences; macOS is queried even without a browser. Module layout colors resolve from the palette. Neutral face pixels and canvas backgrounds theme, colored clip pixels and Roon artwork are preserved. Native fallback frames without explicit design also receive readable themed colors.

Firmware flashed and both themes verified over USB in Face, Usage, HEY, Clock and Roon at 85 degrees, without font or panel errors. Browser checks saved a light background token, verified the preview, reset it, and selected System while the dashboard stayed dark. Final device reports Light at 85 degrees. Other previous configuration matches the pre-change snapshot. Review browser space closed.

## Attention requests - 6 September 2026

- `pnpm check`: 236 tests pass, including queue expiry and pause, decision responses, stale revisions, chains, ownership, HTTP origin checks, real CLI flows and native parser rejection. TypeScript and production build pass.
- Browser: composed a two-button test decision, opened its details, selected Cancel and verified the clock returned with a dismissed result. Inspected the detail layout in ego-browser.
- Independent review found and resolved a firmware race between a newly received frame and the message visible when a tap started. Responses now require the visible and current request identities to match.
- ESP-IDF build and USB flash passed; esptool verified the written images.
- Physical serial check: summary, details and clearing rendered at 85 degrees in both themes without panel or font errors. Invalid attention frames were rejected and normal rendering recovered.
- Installed the `companion` CLI and validated the agent skill. Added its reference to the user's AGENTS.md. Existing device settings are retained.
- Physical touch feel and screen appearance still need the user's confirmation. A two-screen demo is available for this purpose; test responses do not perform external actions.
- Live demo: the bridge received open and dismiss actions for the physical demo request while the browser check performed no action calls. The result was dismissed, and the underlying module returned.

## Attention gestures - 7 September 2026

- Removed the device Back button and stacked actions vertically, with Approve and Decline as decision defaults.
- `pnpm check`: all 240 tests and the production build pass.
- Native and browser gesture tests cover delayed single taps, second presses crossing the 300 ms deadline, scrolling, long presses, stale requests and 40-pixel circular distance matching. Browser tests also cover leaving the view and losing focus.
- Browser verification used two real pointer click sequences over Approve, 83 ms apart. The recorded outcome was dismissed with no action. Both buttons occupied separate rows and no Back control was present.
- Updated firmware flashed and verified by esptool. Physical serial checks passed for summary, detail and clearing at 85 degrees in both themes, with invalid-frame recovery. Bridge restarted with the existing connection settings.

## Attention detail spacing - 7 September 2026

- Description follows the measured title height with a 12-pixel gap. The scroll viewport ends 28 pixels above the actions; one-line titles no longer reserve an empty second line.
- Browser measurements confirmed 12 and 28 pixels. Independent review confirmed matching native font metrics, dynamic scroll range and touch bounds.
- Eleven native and browser regression tests passed; web and firmware builds passed.
- Flashed and verified the update. Physical serial render checks passed at 85 degrees in both themes. Restarted the bridge and sent a spacing preview.
- Follow-up spacing adjustment: title-to-description gap increased from 12 to 18 pixels in native and browser layouts. Button gap remains 28 pixels. Both builds passed; firmware flash verified and bridge restarted.
- Final fine adjustment: description moved down another 2 pixels, for a 20-pixel title gap. Browser and firmware builds passed.

## Display freeze recovery - 7 September 2026

- Captured repeated ESP_ERR_NO_MEM failures from SPI colour transfers while the panel was frozen at 85 degrees. USB alone still appeared connected.
- Limited transfers to two 4,092-byte DMA descriptors (8,184 bytes), preserving queue depth and final-transfer callbacks. Moved 15,040 bytes of long-lived attention/render snapshots into PSRAM BSS. Configuration is tracked and reproducible.
- Dashboard now exposes panel-transfer errors from acknowledgements and clears them after healthy acknowledgements without clearing unrelated errors.
- Full check passed 241 tests and production build; the final DMA rounding regression and native build also passed. Independent review checked descriptor rounding, callback semantics, PSRAM map placement and ACK byte limits.
- Flashed and verified firmware. A physical 300-update stress test used current user design settings, six animation clips, repeated detail transitions and rotations of 85, 22 and 137 degrees. All 300 frames were acknowledged over 99.2 seconds; 602 panel transfers completed with zero panel/font errors. Minimum largest DMA block was 63,488 bytes; minimum internal free memory was 110,999 bytes.

## macOS menu bar launcher

- Built and ad hoc signature verified with `pnpm menubar:build`.
- Installed in `~/Applications/Companion Studio.app`; live Node child connected to the USB device.
- Forced bridge exit recovered automatically with a new child process.
- App termination stopped both app and bridge within the bounded shutdown period; relaunch reconnected.
- Native UI automation could not inspect the windowless menu app (accessibility timeout). Login registration and menu clicks were not automated.

## Portable macOS releases and Sparkle

- Sparkle 2.9.6 and Node 24.12.0 official archives verified against pinned SHA-256 digests.
- Portable ad hoc build passed, including native dependency imports; production dependency closure reduced runtime from 1 GB to approximately 155 MB with Sparkle.
- Full Sparkle launcher compilation, nested Developer ID signing, strict signature verification and signed native-addon imports passed.
- Signed portable runtime served the dashboard and state API from an isolated temporary working directory with no development PATH, no USB and integrations disabled.
- Release workflow YAML and packaging JavaScript syntax validated.
- Test release used a non-publishing placeholder feed. It was not installed or published.
- Apple notarization, public hosting and an actual Sparkle update round trip remain untested until their credentials and host are configured.
