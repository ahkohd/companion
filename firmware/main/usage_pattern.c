#include "usage_pattern.h"
#include <string.h>

bool usage_pattern_render(uint32_t *pixels, int width, int height, int style, int pixel_size, int gap,
                          int fill_width, uint32_t track_color, uint32_t fill_color)
{
    if (!pixels || width < 1 || width > USAGE_PATTERN_MAX_WIDTH || height < 2 || height > USAGE_PATTERN_MAX_HEIGHT ||
        (style != 1 && style != 2) || pixel_size < 2 || pixel_size > 16 || gap < 0 || gap > 8 ||
        fill_width < 0 || fill_width > width || track_color > 0xffffff || fill_color > 0xffffff) return false;
    int cell = pixel_size < height ? pixel_size : height;
    if (cell > width) return false;
    int step = cell + gap, columns = (width + gap) / step, rows = (height + gap) / step;
    int x0 = (width - (columns * step - gap)) / 2, y0 = (height - (rows * step - gap)) / 2;
    memset(pixels, 0, (size_t)width * height * sizeof(*pixels));
    // Reuse one cell's coverage for the whole grid. At most256 samples are stored.
    uint8_t alpha[16 * 16];
    for (int y = 0; y < cell; ++y) for (int x = 0; x < cell; ++x) {
        unsigned coverage = 16;
        if (style == 2) {
            coverage = 0;
            for (int sy = 1; sy < 8; sy += 2) for (int sx = 1; sx < 8; sx += 2) {
                int dx = x * 8 + sx - cell * 4, dy = y * 8 + sy - cell * 4;
                if (dx * dx + dy * dy <= cell * cell * 16) coverage++;
            }
        }
        alpha[y * cell + x] = (uint8_t)((coverage * 255 + 8) / 16);
    }
    for (int row = 0; row < rows; ++row) for (int column = 0; column < columns; ++column) {
        int left = x0 + column * step, top = y0 + row * step;
        for (int y = 0; y < cell; ++y) for (int x = 0; x < cell; ++x) {
            unsigned opacity = alpha[y * cell + x];
            if (opacity) pixels[(top + y) * width + left + x] = opacity << 24 |
                (left + x < fill_width ? fill_color : track_color);
        }
    }
    return true;
}
