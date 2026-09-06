# Companion Studio

Follow your coding agents, check AI usage and control a small desktop display from a local web app.

Companion Studio works with the [Waveshare ESP32-S3-Touch-AMOLED-1.75-B](https://www.amazon.co.uk/dp/B0F7XTJ7JW). You can also use the browser preview without a device.

![Overview showing sample agent statuses beside the device preview](docs/images/overview.png)

Version 0.1.0. Screenshots show the app with sample data.

## What you can do

Choose from 5 modules:

| Module | What it shows | What you need |
| --- | --- | --- |
| Herdr Face | Agent status, session names and animated expressions | Herdr running on your computer |
| CodexBar | Usage balances and reset times | An installed, configured CodexBar CLI |
| HEY | Senders and subjects from your chosen mailbox | An installed, authenticated HEY CLI |
| Clock | Time and an optional weekday | No additional service |
| Roon | Album artwork, track details and playback controls | A Roon server with the Companion Studio extension enabled |

The app detects installed CodexBar and HEY CLIs. Herdr Face, CodexBar, HEY and Clock start enabled. Roon starts disabled.

Enable the modules you want on the Modules page. Swipe left or right to switch between them. You can change their order.

## Run the app

Use Node.js 22.12 or later and pnpm 11.19.0. Development and hardware checks have been tested on macOS with Node.js 24.

From the repository directory, run:

```sh
pnpm install
cp .env.example .env
pnpm build
pnpm start
```

Open [Companion Studio on your computer](http://127.0.0.1:4317).

Leave `ESP_SERIAL_PORT` empty in `.env` to use the browser without hardware. Set it after flashing a compatible board.

The app reads data through your local integrations. Follow the [integration setup guide](docs/integrations.md) to connect them.

## Choose animations

Use Animations to map expressions to Working, Needs your input, Ready, Idle, Unknown and Disconnected.

The library contains 52 entries: 5 original expressions and 47 extracted Grok clips.

![Animation library with expression cards and a live preview](docs/images/animations.png)

Choose an animation to preview it in the browser. Select Send to device to show it on the hardware. Select Return to live to resume agent status.

Mappings change the expression, not the status text. One working agent shows Working; 2 or more show the count. Ready takes precedence over idle in the secondary summary.

Tap the physical face to cycle through agents. A swipe changes modules instead.

## Adjust the layout

Use Designer to change each module's layout with a live preview. Adjust text sizes, spacing, positions, card dimensions and playback controls.

![Designer showing face layout controls beside the circular preview](docs/images/designer.png)

Live updates save changes as you make them. Turn them off to experiment, then select Apply design. Use Undo or Reset module to restore earlier values.

You can export and import designs. Sample content changes the preview without replacing live data on the device.

Roon artwork expands instantly by default. You can enable the expansion animation and artwork spin in Designer.

## Set device colours and rotation

Device appearance is separate from the dashboard theme. Choose Light, Dark or System on the Device page.

Each device mode has its own editable colours for the background, text, cards, progress bars and status accents. Album artwork keeps its original colours.

System follows the connected computer's appearance, even when the browser is closed. The bridge checks macOS, Windows or GNOME preferences every 3 seconds. Failed queries retain the last reading.

Physical rotation supports 0 to 359 degrees in 1-degree steps. Touch coordinates follow the rotation. The browser preview stays upright.

Custom angles require more rendering work than right angles. The renderer skips unchanged pixels and limits updates to changed areas. Performance depends on the animation and module.

Mouse following is available on macOS. The face moves smoothly towards sampled cursor positions. Disable it or change the sampling interval on the Device page.

## Hardware and firmware

The supported [Waveshare board on Amazon UK](https://www.amazon.co.uk/dp/B0F7XTJ7JW) has a round 466 x 466 CO5300 AMOLED display, CST9217 touch controller, 16 MB flash and 8 MB PSRAM.

Other Waveshare boards need their own hardware port. The device renders native LVGL graphics; it does not run the web app.

Install the GitHub CLI, Git and Python before setting up the firmware toolchain. From the repository root, run:

```sh
pnpm firmware:setup
pnpm firmware:build
```

Setup downloads the pinned ESP-IDF toolchain into `.tools`. The build prints a flash command. See the [firmware build and flash instructions](firmware/README.md) for the complete steps.

Stop the bridge before flashing or opening the serial port with another tool. Set `ESP_SERIAL_PORT` in `.env` after flashing, then run `pnpm start`.

To keep a copy of the original firmware, install esptool using `requirements-device.txt`. Replace the port below with your board's port:

```sh
export ESP_PORT=/dev/your-serial-port
python -m esptool --chip esp32s3 --port "$ESP_PORT" \
  read-flash 0 0x1000000 original-flash.bin
```

Store the backup outside the repository. To restore it with the bridge stopped, run:

```sh
python -m esptool --chip esp32s3 --port "$ESP_PORT" \
  write-flash 0 original-flash.bin
```

USB carries power and data. Firmware updates use USB; there is no over-the-air update feature.

## Settings and data

The bridge listens on `127.0.0.1`. Settings are saved in `.cache/studio-settings.json`. Export settings from the Device page to keep a copy.

Enabled integrations can send agent names, usage values, mail senders and subjects, or music details to the local preview and device.

The HEY module does not send messages or fetch message bodies for display. Tapping a supported mail or usage card opens its link on your computer.

The integration CLIs handle their own authentication and network requests. Mouse following keeps no cursor history. Local settings, credentials and build files are excluded by `.gitignore`.

## Develop and test

Stop any running bridge before starting development mode:

```sh
pnpm dev
```

This starts the bridge and Vite. Open [the development app](http://127.0.0.1:5173).

Run the tests, type checks and production build:

```sh
pnpm check
```

Native rendering tests require a C11 compiler available as `cc`.

The app uses React, TypeScript, Vite, Tailwind CSS and shadcn/ui. Firmware uses ESP-IDF and LVGL. Lockfiles record dependency versions.

Generated animation binaries are not stored in Git. Normal builds recreate missing or outdated binaries. To regenerate source assets, run:

```sh
pnpm faces:generate
pnpm animations:generate
pnpm fonts:generate
```

## Licence and credits

Original project code is available under the [MIT licence](LICENSE).

Third-party code and assets retain their own licences:

| Source | Use | Licence and notice |
| --- | --- | --- |
| Bloub | Original face expressions and motion | [MIT licence](web/vendor/bloub/LICENSE), [notice](web/vendor/bloub/NOTICE.md) |
| BIGAGENT Grok renderer | Extracted animation clips | [MIT licence](web/vendor/grok-bot/LICENSE), [extraction notice](web/vendor/grok-bot/NOTICE.md) |
| Geist | Text and pixel fonts | [SIL Open Font License](fonts/geist/OFL.txt), [font sources](fonts/geist/README.md) |
| Reicon | Previous, next and play icons | [MIT licence](public/icons/reicon/LICENSE.txt), [icon sources](public/icons/reicon/README.md) |

The Roon client packages retain their Apache-2.0 licences. Other dependencies retain the licences distributed with their packages.
