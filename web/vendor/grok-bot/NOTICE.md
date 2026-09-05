# Grok Bot animation extraction

Source: https://github.com/marcodenic/BIGAGENT/blob/c7a498f0275229bdbad67c93c29e070bb85bd91b/src/vendor/grok-bot-0.18/renderer.tsx

Upstream repository: BIGAGENT, commit c7a498f0275229bdbad67c93c29e070bb85bd91b.
The upstream file identifies itself as a dependency closure of Grok Bot 0.18.0
(renderer SHA-256 `ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa`).
The repository supplies the accompanying MIT license. `upstream-renderer.tsx`
is the unmodified source; its own SHA-256 is recorded by the capture tests.

The Grok collection includes all 39 named states and eight actions: spin,
double spin, spin and bounce, dizzy spin, wild spin, bounce, burst, and spin
with burst. The source's spring motion, 25 eye contours, body transformations,
14 effect modes, particles, trails and gradients run in the offline capture.
`scripts/grok-source/capture.mjs` supplies a deterministic clock, seeded random
numbers and a minimal DOM. It exposes internal spin triggers without changing
the original animation math. The fake DOM rejects unsupported operations.

Device adaptations: the blob body shape, lavender foreground, scaling and
clipping above labels, 192 x 168 RGB565 frames at 24 fps. Each preset contains
an eight-second capture. States loop from four seconds with a short blend at
the seam; actions finish once and can be replayed. These are finite, seeded
clips, not the upstream renderer's indefinitely random procedural output.
Other body skins and interactive pose controls are not animation presets.

Both browser and firmware decode the same lossless clip data and use the same
bilinear scaling. The full renderer is retained for further extraction.
`npm run animations:generate` reproduces the assets. Normal builds regenerate
missing or stale binaries; the manifest verifies every clip and the native pack.

The earlier `motion.ts` extraction remains on the five Bloub status faces:
gentle working pose, cubic spin, diminishing parabolic bounces and confetti.
The three-phase dot pulse has been removed in favour of the status text shimmer. Its native port is `firmware/main/face_accent.c`.
These status faces keep their original profiles and smooth mouse following.
