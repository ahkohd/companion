# Add a board

Companion currently supports one tested board: Waveshare ESP32-S3-Touch-AMOLED-1.75-B. Profiles provide a place to add ports. They do not make another board compatible by themselves.

Start with an ESP32-S3 board with a documented display, touch controller, enough flash for the firmware and enough PSRAM for display buffers. A similar Waveshare AMOLED board is a practical candidate. Check its exact hardware revision before selecting drivers or flashing.

## What stays shared

The host integrations, attention protocol, animation catalogue and dashboard remain shared. Firmware modules currently use a 466 x 466 logical layout. The preview can fit that canvas inside a round or rectangular screen, but this is not an automatic firmware layout port.

## Create a profile

Copy `shared/boards/waveshare-1.75-b.json` to a file named after your board. Use a stable ID and mark the new profile `experimental`:

```json
{
  "id": "vendor-model-revision",
  "name": "Vendor model and revision",
  "status": "experimental",
  "protocol": 1,
  "display": { "width": 480, "height": 480, "shape": "rectangular" },
  "canvas": { "width": 466, "height": 466 }
}
```

These dimensions are an example, not a supported target. Register the JSON file explicitly in `bridge/board-profiles.mjs`. Only registered profiles can complete the serial handshake. Match the firmware's ID and screen metadata exactly. Do not reuse another board's ID to bypass this check.

## Port the firmware

Copy the current profile under `firmware/boards`. Implement the board adapter for display startup, brightness, touch and locking. Keep its pin assignments, power sequencing and panel-specific transfer code in the board implementation or its board support package.

The input adapter must preserve physical sample timestamps and movement independently of rendering. Implement the touch timestamp, validity, revision and cancellation APIs in `board.h`; input loss must cancel a contact rather than create a tap. Rotation changes must clear buffered contacts.

Review the profile's CMake sources and link options, `firmware/main/idf_component.yml`, ESP-IDF configuration and partition table. The present memory settings and managed BSP dependency belong to the tested board. Do not copy them without checking flash capacity, PSRAM mode, panel bus, DMA support and touch wiring.

Build the selected profile from the repository root:

```sh
COMPANION_BOARD=vendor-model-revision pnpm firmware:build
```

The default remains `waveshare-1.75-b`. Unknown profile IDs fail the build.

The firmware must report a version 1 ready message:

```json
{"type":"ready","v":1,"board":"vendor-model-revision","display":{"width":480,"height":480,"shape":"rectangular"}}
```

The original 1.75-B firmware can omit display metadata for backwards compatibility. New profiles must include it.

Port the renderer and touch coordinates to the physical display. Existing module positions, attention hit areas and arbitrary-angle rotation still assume the current canvas. Either implement uniform fitting in firmware or adapt these layouts. The browser's fitted preview alone does not do this work.

## Verify on hardware

Before proposing tested support, record the exact board revision, display and touch controllers, flash and PSRAM sizes, build command and firmware revision. Check:

- Cold boot, USB reconnection and recovery after the host restarts.
- Each module, its text bounds and light and dark palettes.
- Touch coordinates, swipes, attention actions and double tap dismissal.
- Cardinal and custom display rotation, including responsiveness.
- Artwork, animation playback and memory use under sustained operation.
- Preview geometry against the physical screen.

Run `pnpm test`, `pnpm build` and the selected firmware build. Attach photos and the results to the pull request. Keep the profile experimental until someone verifies it on that exact hardware. No hardware access means an experimental port, not tested support.
