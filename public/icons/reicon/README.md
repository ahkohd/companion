# Reicon playback icons

Downloaded through Reicon's SVG export on 6 September 2026. Filled weight, 64px export size, original 24 x 24 viewBox and currentColor fills. SVG exports are unmodified.

- [Previous](https://reicon.dev/icon/previous?weight=filled): previous.svg
- [Next](https://reicon.dev/icon/next?weight=filled): next.svg
- [Play](https://reicon.dev/icon/play?weight=filled): play.svg

[Reicon license](https://reicon.dev/license): MIT, copyright 2025 Dev Chauhan. Full notice is included in LICENSE.txt. The source site also credits Solar Icons (480 Design; package maintained by Saoudi H.) and Zappicon as base icon sets.

The Roon preview and module controls use these paths through `web/components/RoonIcon.tsx`. The device uses alpha masks generated from these SVGs, tinted with the configured primary text colour. Pause keeps its existing two-bar glyph.

Regenerate the native masks with `node scripts/build-reicon-icons.mjs`. The firmware build runs this automatically; `--check` verifies the checked-in masks match their SVG sources.
