# Speed Dial

Speed Dial turns the display into a collection of buttons. Configure them in Modules, and adjust their layout in Designer. It starts disabled with no actions configured.

## Choose an action

| Action | Value |
| --- | --- |
| Open app | An installed app name, such as Safari, or its full path |
| Open URL | A complete website or app URL |
| Open file | An absolute path or a path starting with `~/` |
| Run Shortcut | The exact name shown in macOS Shortcuts |
| Shell command | A command or script, run with `/bin/zsh -lc` on macOS |

Actions run on the Mac as the signed-in user. Shell commands use the user's home directory. Shell actions can also run from a source checkout on other platforms; the other action types require macOS.

Each button supports up to eight actions. They run in order and stop on the first failure. Each action has a 30-second limit. Four buttons can run at once, and a button cannot run twice at the same time. Quitting Companion cancels running command processes. Opening an app or URL completes when macOS accepts the open request.

Save does not execute anything. Test runs the saved button, even when the module is disabled, and requires the editor to have the current settings revision. Tapping on the device also checks that the button still belongs to the displayed page.

The green success check clears after two seconds on the device and preview. The completed result and command output remain available in the button editor. Failed actions keep their error indicator until the button runs again.

## Icons and layout

Choose emoji through [Frimousse](https://frimousse.liveblocks.io/), a built-in icon, or upload a PNG or SVG up to 2 MB. The browser prepares a transparent 96-pixel PNG. Companion stores it locally and prepares a 32-pixel version for the device. English emoji metadata is bundled for offline search; no emoji font is redistributed.

Drag the handle beside a button to reorder it. A line shows where it will go; the order saves when you drop it. Use the up and down buttons for keyboard or touch controls. Reordering does not run any actions.

There can be up to 48 buttons. Names support up to 24 Unicode code points and 64 UTF-8 bytes. Disabled buttons stay in the editor and are excluded from device pages.

Grid pages use automatic packing by default. Round displays use staggered rows; rectangular displays use straight rows. With the default design, a page holds seven labelled buttons on the round display or nine on a square canvas. The layout keeps icons and labels within the screen and leaves room for pagination. The connected board profile supplies the screen shape.

With labels hidden, round layouts can fill four side pockets with smaller buttons, keeping at least 48 pixels for each tap target. If your spacing or button size leaves too little room, those extra slots are omitted.

Adjust button size, spacing and labels in Designer to change the density, up to thirteen buttons per page. The default icon-only round layout has nine large buttons, including one at the top and bottom, and four smaller side buttons. Four- and six-button grids remain available. List pages hold three or four rows without button backgrounds. Vertical swipes change pages; horizontal swipes change modules. Automatic grids place the first button at the centre, then fill opposite positions outward. With labels hidden, smaller buttons nest between at least two existing neighbours at the configured spacing. Opposite pairs keep partial pages balanced. Icon-only round grids centre the visible buttons as a group when there is only one page. With multiple pages, they leave at least 16 pixels around the page counter. Changing the layout preserves your buttons and their order.

## Local data

Button configuration is saved in `studio-settings.json`. Icons are stored in the adjacent `speed-dial-icons` directory, using content hashes as filenames. Include both when backing up or transferring settings. Execution results are kept in memory until Companion restarts.

The local API accepts icon uploads at `POST /api/speed-dial/icon`, page changes at `POST /api/speed-dial/page`, and deliberate runs at `POST /api/speed-dial/run`. Test requests contain `id` and the current `revision` from `/api/state`; display taps contain `id` and the displayed `openToken` as `token`. Run requests never contain commands. The bridge loads the saved action sequence by ID.

## Firmware

Speed Dial requires firmware built with this module. Existing settings migrate with Speed Dial disabled. The device sends the button ID and page token over USB; the Mac executes the action and reports running, success or failure. A thirteen-icon atlas uses 32px tiles in the existing 160px artwork transfer shared with Now Playing. Hidden labels stay in your settings and browser preview but are omitted from device frames to keep them within the 4096-byte limit. Changing pages or returning to music replaces the atlas automatically.
