# Geist fonts

Geist Sans, Geist Mono and Geist Pixel Circle come from [vercel/geist-font](https://github.com/vercel/geist-font/tree/10dc7658f13c38a474cde201bb09a4617267545b), pinned to commit `10dc7658f13c38a474cde201bb09a4617267545b`.

The unmodified webfonts are in `public/fonts`. The device uses
`Geist-Regular.ttf`, converted into 16 px, 22 px and 28 px LVGL fonts with 4-bit
antialiasing and kerning. Usage percentages use 56 px Geist Pixel Circle without card backgrounds, or 44 px with them.
The 22 px, 44 px and 56 px pixel subsets contain digits, percent, space, plus and
minus signs. The Clock module uses a 128 px Circle subset containing digits,
a colon and the lowercase letters a, m and p. HEY senders and subjects use Geist Sans. Pixel source files are
`fonts/GeistPixel/ttf/GeistPixel-Circle.ttf` and
`fonts/GeistPixel/webfonts/GeistPixel-Circle.woff2` in the pinned upstream.
Regenerate the checked-in C files with:

```sh
pnpm run fonts:generate
```

The device subset includes ASCII, Latin-1, Latin Extended-A, Greek symbols, common punctuation
and the euro sign, where supported by Geist. Other scripts and emoji remain
subject to the device's glyph limits. Browser fonts retain their full coverage.

The original SIL Open Font License is in `OFL.txt` and `public/fonts/OFL.txt`.
