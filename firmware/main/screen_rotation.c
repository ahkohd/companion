#include "screen_rotation.h"
#include <math.h>
#include <string.h>

#define FIXED_ONE 65536
#define CENTER_FIXED ((SCREEN_SIDE - 1) * (FIXED_ONE / 2))

static bool valid_area(screen_rect_t area)
{
    return area.x >= 0 && area.y >= 0 && area.width > 0 && area.height > 0 &&
        area.x < SCREEN_SIDE && area.y < SCREEN_SIDE &&
        area.width <= SCREEN_SIDE - area.x && area.height <= SCREEN_SIDE - area.y;
}

bool screen_transform_init(unsigned rotation, screen_transform_t *transform)
{
    if (rotation > 359 || !transform) return false;
    double radians = rotation * (3.14159265358979323846 / 180.0);
    transform->cosine = (int32_t)lround(cos(radians) * FIXED_ONE);
    transform->sine = (int32_t)lround(sin(radians) * FIXED_ONE);
    return true;
}

bool screen_backing_update(uint16_t *backing, const uint16_t *source, screen_rect_t area)
{
    if (!backing || !source || !valid_area(area)) return false;
    for (int y = 0; y < area.height; ++y)
        memcpy(backing + (area.y + y) * SCREEN_SIDE + area.x,
               source + y * area.width, area.width * sizeof(*source));
    return true;
}

bool screen_backing_update_changed(uint16_t *backing, const uint16_t *source,
                                   screen_rect_t area, screen_rect_t *changed)
{
    if (!backing || !source || !changed || !valid_area(area)) return false;
    int left = area.width, right = 0, top = area.height, bottom = 0;
    for (int y = 0; y < area.height; ++y) {
        uint16_t *row = backing + (area.y + y) * SCREEN_SIDE + area.x;
        const uint16_t *input = source + y * area.width;
        if (!memcmp(row, input, area.width * sizeof(*row))) continue;
        int first = 0, last = area.width;
        while (row[first] == input[first]) ++first;
        while (row[last - 1] == input[last - 1]) --last;
        if (first < left) left = first;
        if (last > right) right = last;
        if (y < top) top = y;
        bottom = y + 1;
        memcpy(row + first, input + first, (last - first) * sizeof(*row));
    }
    *changed = right ? (screen_rect_t){area.x + left, area.y + top, right - left, bottom - top} : (screen_rect_t){0};
    return true;
}

static uint16_t pixel_at(const uint16_t *backing, int x, int y)
{
    return (unsigned)x < SCREEN_SIDE && (unsigned)y < SCREEN_SIDE ? backing[y * SCREEN_SIDE + x] : 0;
}

static uint16_t swap565(uint16_t value) { return (uint16_t)((value << 8) | (value >> 8)); }

static uint16_t sample_bilinear(const uint16_t *backing, int32_t sx, int32_t sy)
{
    if (sx <= -FIXED_ONE || sy <= -FIXED_ONE ||
        sx >= SCREEN_SIDE * FIXED_ONE || sy >= SCREEN_SIDE * FIXED_ONE) return 0;
    int x = sx < 0 ? -1 : sx / FIXED_ONE, y = sy < 0 ? -1 : sy / FIXED_ONE;
    uint16_t a, b, c, d;
    if ((unsigned)x < SCREEN_SIDE - 1 && (unsigned)y < SCREEN_SIDE - 1) {
        const uint16_t *row = backing + y * SCREEN_SIDE + x;
        a = row[0]; b = row[1]; c = row[SCREEN_SIDE]; d = row[SCREEN_SIDE + 1];
    } else {
        a = pixel_at(backing, x, y); b = pixel_at(backing, x + 1, y);
        c = pixel_at(backing, x, y + 1); d = pixel_at(backing, x + 1, y + 1);
    }
    if (a == b && a == c && a == d) return a;
    unsigned fx = ((uint32_t)sx & 65535) >> 8, fy = ((uint32_t)sy & 65535) >> 8;
    unsigned wa = (256 - fx) * (256 - fy), wb = fx * (256 - fy);
    unsigned wc = (256 - fx) * fy, wd = fx * fy;
    a = swap565(a); b = swap565(b); c = swap565(c); d = swap565(d);
    unsigned red = ((a >> 11) * wa + (b >> 11) * wb + (c >> 11) * wc + (d >> 11) * wd + 32768) >> 16;
    unsigned green = (((a >> 5) & 63) * wa + ((b >> 5) & 63) * wb + ((c >> 5) & 63) * wc + ((d >> 5) & 63) * wd + 32768) >> 16;
    unsigned blue = ((a & 31) * wa + (b & 31) * wb + (c & 31) * wc + (d & 31) * wd + 32768) >> 16;
    return swap565((uint16_t)((red << 11) | (green << 5) | blue));
}

bool screen_rotate_backing(const screen_transform_t *transform, const uint16_t *backing,
                           screen_rect_t dirty, uint16_t *destination, size_t capacity,
                           screen_rect_t *rotated)
{
    if (!transform || !backing || !destination || !rotated || !valid_area(dirty) ||
        backing == destination) return false;
    int32_t cosine = transform->cosine, sine = transform->sine;
    if (cosine < -FIXED_ONE || cosine > FIXED_ONE || sine < -FIXED_ONE || sine > FIXED_ONE) return false;
    /* A changed source pixel influences its four bilinear neighbors. Extend
     * that footprint before rotation, then align the destination for CO5300. */
    int xs[2] = {dirty.x - 1, dirty.x + dirty.width};
    int ys[2] = {dirty.y - 1, dirty.y + dirty.height};
    int32_t min_x = INT32_MAX, min_y = INT32_MAX, max_x = INT32_MIN, max_y = INT32_MIN;
    for (int iy = 0; iy < 2; ++iy) for (int ix = 0; ix < 2; ++ix) {
        int dx = 2 * xs[ix] - (SCREEN_SIDE - 1), dy = 2 * ys[iy] - (SCREEN_SIDE - 1);
        int32_t x = CENTER_FIXED + (cosine * dx - sine * dy) / 2;
        int32_t y = CENTER_FIXED + (sine * dx + cosine * dy) / 2;
        if (x < min_x) min_x = x;
        if (x > max_x) max_x = x;
        if (y < min_y) min_y = y;
        if (y > max_y) max_y = y;
    }
    int x1 = (int)floor((double)min_x / FIXED_ONE) - 1;
    int y1 = (int)floor((double)min_y / FIXED_ONE) - 1;
    int x2 = (int)ceil((double)max_x / FIXED_ONE) + 2;
    int y2 = (int)ceil((double)max_y / FIXED_ONE) + 2;
    if (x1 < 0) x1 = 0;
    if (y1 < 0) y1 = 0;
    if (x2 > SCREEN_SIDE) x2 = SCREEN_SIDE;
    if (y2 > SCREEN_SIDE) y2 = SCREEN_SIDE;
    if (x1 >= x2 || y1 >= y2) { *rotated = (screen_rect_t){0}; return true; }
    x1 &= ~1; y1 &= ~1; x2 = (x2 + 1) & ~1; y2 = (y2 + 1) & ~1;
    int width = x2 - x1, height = y2 - y1;
    if ((size_t)width * height > capacity) return false;
    *rotated = (screen_rect_t){x1, y1, width, height};
    for (int y = y1; y < y2; ++y) {
        /* A fixed origin keeps quantization identical for full and partial
         * redraws, including rows whose initial inverse coordinate is negative. */
        int32_t sx = CENTER_FIXED - (cosine + sine) * (SCREEN_SIDE - 1) / 2 + cosine * x1 + sine * y;
        int32_t sy = CENTER_FIXED + (sine - cosine) * (SCREEN_SIDE - 1) / 2 - sine * x1 + cosine * y;
        for (int x = 0; x < width; ++x, sx += cosine, sy -= sine)
            destination[(y - y1) * width + x] = sample_bilinear(backing, sx, sy);
    }
    return true;
}

bool screen_rotate_pixels(unsigned rotation, const uint16_t *source, screen_rect_t area,
                          uint16_t *destination, size_t capacity, screen_rect_t *rotated)
{
    if (rotation > 270 || rotation % 90 || !source || !destination || !rotated ||
        area.x < 0 || area.y < 0 || area.width < 1 || area.height < 1 ||
        area.x > SCREEN_SIDE || area.y > SCREEN_SIDE ||
        area.width > SCREEN_SIDE - area.x || area.height > SCREEN_SIDE - area.y ||
        (size_t)area.width * area.height > capacity) return false;
    if (rotation && source == destination) return false;
    int width = area.width, height = area.height;
    switch (rotation) {
        case 90: *rotated = (screen_rect_t){SCREEN_SIDE - area.y - height, area.x, height, width}; break;
        case 180: *rotated = (screen_rect_t){SCREEN_SIDE - area.x - width, SCREEN_SIDE - area.y - height, width, height}; break;
        case 270: *rotated = (screen_rect_t){area.y, SCREEN_SIDE - area.x - width, height, width}; break;
        default:
            *rotated = area;
            memmove(destination, source, (size_t)width * height * sizeof(*source));
            return true;
    }
    /* Values are already in panel byte order. Move them without decoding RGB565. */
    for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
        size_t target = rotation == 90 ? (size_t)x * height + height - 1 - y :
            rotation == 180 ? (size_t)(height - 1 - y) * width + width - 1 - x :
            (size_t)(width - 1 - x) * height + y;
        destination[target] = source[(size_t)y * width + x];
    }
    return true;
}

void screen_unrotate_point(unsigned rotation, int x, int y, int *logical_x, int *logical_y)
{
    /* The BSP touch mirror can report 466 at an edge; normalize it once here. */
    if (x < 0) x = 0; else if (x >= SCREEN_SIDE) x = SCREEN_SIDE - 1;
    if (y < 0) y = 0; else if (y >= SCREEN_SIDE) y = SCREEN_SIDE - 1;
    switch (rotation) {
        case 90: *logical_x = y; *logical_y = SCREEN_SIDE - 1 - x; break;
        case 180: *logical_x = SCREEN_SIDE - 1 - x; *logical_y = SCREEN_SIDE - 1 - y; break;
        case 270: *logical_x = SCREEN_SIDE - 1 - y; *logical_y = x; break;
        case 0: *logical_x = x; *logical_y = y; break;
        default: {
            screen_transform_t transform;
            if (!screen_transform_init(rotation, &transform)) { *logical_x = x; *logical_y = y; break; }
            int dx = 2 * x - (SCREEN_SIDE - 1), dy = 2 * y - (SCREEN_SIDE - 1);
            double sx = (double)(transform.cosine * dx + transform.sine * dy) / (2 * FIXED_ONE);
            double sy = (double)(-transform.sine * dx + transform.cosine * dy) / (2 * FIXED_ONE);
            /* Keep out-of-square results outside: clamping would create false
             * taps on edge controls when contact lies beyond the rotated UI. */
            *logical_x = (int)lround((SCREEN_SIDE - 1) * 0.5 + sx);
            *logical_y = (int)lround((SCREEN_SIDE - 1) * 0.5 + sy);
            break;
        }
    }
}
