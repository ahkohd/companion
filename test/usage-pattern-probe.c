#include "usage_pattern.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static uint32_t pixels[USAGE_PATTERN_MAX_WIDTH * USAGE_PATTERN_MAX_HEIGHT + 2];

static unsigned sample_alpha(int style, int cell, int x, int y)
{
    if (style == 1)
        return 255;
    unsigned hits = 0;

    for (int sy = 0; sy < 4; ++sy)
        for (int sx = 0; sx < 4; ++sx) {
            double dx = x + (sx + .5) / 4 - cell / 2.0, dy = y + (sy + .5) / 4 - cell / 2.0;
            if (dx * dx + dy * dy <= cell * cell / 4.0)
                hits++;
        }

    return (hits * 255 + 8) / 16;
}

static void check(int width, int height, int style, int size, int gap, int fill)
{
    const uint32_t track = 0x27394b, color = 0x65c18c, sentinel = 0xcafebabe;
    size_t count = (size_t)width * height;
    pixels[0] = pixels[count + 1] = sentinel;
    memset(pixels + 1, 0x7f, count * sizeof(uint32_t));

    assert(usage_pattern_render(pixels + 1, width, height, style, size, gap, fill, track, color));
    assert(pixels[0] == sentinel && pixels[count + 1] == sentinel);

    int cell = size < height ? size : height, step = cell + gap;
    int columns = (width + gap) / step, rows = (height + gap) / step;
    int left = (width - (columns * cell + (columns - 1) * gap)) / 2;
    int top = (height - (rows * cell + (rows - 1) * gap)) / 2;
    unsigned visible = 0;

    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x) {
            unsigned alpha = 0;
            int column = (x - left) / step, row = (y - top) / step;
            int cx = (x - left) % step, cy = (y - top) % step;
            if (x >= left && y >= top && column < columns && row < rows && cx < cell && cy < cell)
                alpha = sample_alpha(style, cell, cx, cy);
            uint32_t expected = alpha ? (alpha << 24) | (x < fill ? color : track) : 0;

            assert(pixels[1 + y * width + x] == expected);

            if (alpha)
                visible++;
        }

    assert(visible > 0);
}

int main(void)
{
    unsigned cases = 0;
    const int widths[] = {100, 101, 307, 308, 418};

    for (unsigned w = 0; w < sizeof(widths) / sizeof(widths[0]); ++w)
        for (int height = 2; height <= 24; ++height)
            for (int style = 1; style <= 2; ++style)
                for (int size = 2; size <= 16; ++size)
                    for (int gap = 0; gap <= 8; gap++) {
                        int width = widths[w];
                        check(width, height, style, size, gap,
                              (cases % 3 == 0)   ? 0
                              : (cases % 3 == 1) ? width
                                                 : width / 3 + 1);
                        cases++;
                    }

    for (int fill = 0; fill <= 100; ++fill)
        for (int style = 1; style <= 2; ++style) {
            check(100, 10, style, 4, 2, fill);
            cases++;
        }

    for (int invalid = -1; invalid <= 4; ++invalid)
        if (invalid != 1 && invalid != 2)
            assert(!usage_pattern_render(pixels, 100, 10, invalid, 4, 2, 50, 0, 0));
    assert(!usage_pattern_render(NULL, 100, 10, 1, 4, 2, 50, 0, 0));
    assert(!usage_pattern_render(pixels, 427, 10, 1, 4, 2, 50, 0, 0));
    assert(!usage_pattern_render(pixels, 100, 25, 1, 4, 2, 50, 0, 0));
    assert(!usage_pattern_render(pixels, 100, 10, 1, 17, 2, 50, 0, 0));
    assert(!usage_pattern_render(pixels, 100, 10, 1, 4, 9, 50, 0, 0));
    assert(!usage_pattern_render(pixels, 100, 10, 1, 4, 2, 101, 0, 0));

    printf(
        "PASS: %u patterned bar cases validate full-cell centering, transparent gaps, square/circle coverage, exact clipped progress, all/none fill and buffer guards\n",
        cases);
}
