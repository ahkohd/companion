#include "screen_rotation.h"
#include "module_touch.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <stdlib.h>

static uint16_t source[SCREEN_SIDE * SCREEN_SIDE], output[SCREEN_SIDE * SCREEN_SIDE + 2], screen[SCREEN_SIDE * SCREEN_SIDE];
static uint16_t backing[SCREEN_SIDE * SCREEN_SIDE], reference[SCREEN_SIDE * SCREEN_SIDE];
static void forward(unsigned rotation, int x, int y, int *px, int *py)
{
    switch (rotation) {
        case 90: *px = SCREEN_SIDE - 1 - y; *py = x; break;
        case 180: *px = SCREEN_SIDE - 1 - x; *py = SCREEN_SIDE - 1 - y; break;
        case 270: *px = y; *py = SCREEN_SIDE - 1 - x; break;
        default: *px = x; *py = y; break;
    }
}
static uint16_t pattern(int x, int y) { return (uint16_t)((x * 7919) ^ (y * 1049)); }
static uint16_t swap565(uint16_t value) { return (uint16_t)((value << 8) | (value >> 8)); }
static void paint(const uint16_t *pixels, screen_rect_t area)
{
    assert(!(area.x % 2) && !(area.y % 2) && !(area.width % 2) && !(area.height % 2));
    assert(area.x >= 0 && area.y >= 0 && area.x + area.width <= SCREEN_SIDE && area.y + area.height <= SCREEN_SIDE);
    for (int row = 0; row < area.height; ++row)
        memcpy(screen + (area.y + row) * SCREEN_SIDE + area.x, pixels + row * area.width, area.width * sizeof(uint16_t));
}
static void arbitrary_updates(void)
{
    const unsigned angles[] = {1, 7, 15, 37, 45, 73, 85, 89, 91, 127, 179, 181, 225, 269, 271, 315, 347, 359};
    const screen_rect_t full = {0, 0, SCREEN_SIDE, SCREEN_SIDE};
    screen_rect_t area;
    for (unsigned n = 0; n < sizeof(angles) / sizeof(*angles); ++n) {
        screen_transform_t transform;
        assert(screen_transform_init(angles[n], &transform));
        for (int y = 0; y < SCREEN_SIDE; ++y) for (int x = 0; x < SCREEN_SIDE; ++x)
            backing[y * SCREEN_SIDE + x] = pattern(x, y);
        assert(screen_rotate_backing(&transform, backing, full, output + 1, SCREEN_SIDE * SCREEN_SIDE, &area));
        paint(output + 1, area);
        for (int i = 0; i < 20; ++i) {
            int x = i * 29 % SCREEN_SIDE, y = i * 37 % SCREEN_SIDE;
            int width = 1 + i * 11 % 28, height = 1 + i * 17 % 32;
            if (x + width > SCREEN_SIDE) width = SCREEN_SIDE - x;
            if (y + height > SCREEN_SIDE) height = SCREEN_SIDE - y;
            screen_rect_t dirty = {x, y, width, height};
            for (int j = 0; j < width * height; ++j) source[j] = (uint16_t)(0x1234 ^ (i * 173 + j * 59));
            assert(screen_backing_update(backing, source, dirty));
            output[0] = output[SCREEN_SIDE * SCREEN_SIDE + 1] = 0xa55a;
            assert(screen_rotate_backing(&transform, backing, dirty, output + 1, SCREEN_SIDE * SCREEN_SIDE, &area));
            assert(output[0] == 0xa55a && output[SCREEN_SIDE * SCREEN_SIDE + 1] == 0xa55a);
            assert(area.width * area.height < 5000); /* Small updates remain small. */
            paint(output + 1, area);
            assert(screen_rotate_backing(&transform, backing, full, reference, SCREEN_SIDE * SCREEN_SIDE, &area));
            assert(memcmp(reference, screen, sizeof(screen)) == 0);
        }
        assert(!screen_rotate_backing(&transform, backing, full, output, 3, &area));
    }
    screen_transform_t transform;
    assert(screen_transform_init(45, &transform));
    assert(screen_rotate_backing(&transform, backing, (screen_rect_t){464, 0, 2, 2}, output, 4, &area));
    assert(area.width == 0 && area.height == 0);
    assert(!screen_transform_init(360, &transform));
    assert(!screen_backing_update(backing, source, (screen_rect_t){466, 0, 1, 1}));
}

static void changed_updates(void)
{
    memset(backing, 0, sizeof(backing));
    for (int i = 0; i < 250; ++i) {
        int x = i * 13 % 400, y = i * 29 % 400;
        screen_rect_t dirty = {x, y, 64, 64}, changed;
        for (int row = 0; row < 64; ++row)
            memcpy(source + row * 64, backing + (y + row) * SCREEN_SIDE + x, 64 * sizeof(uint16_t));
        assert(screen_backing_update_changed(backing, source, dirty, &changed));
        assert(!changed.width && !changed.height);
        int ax = i * 17 % 64, ay = i * 31 % 64;
        int bx = i * 7 % 64, by = i * 11 % 64;
        source[ay * 64 + ax] ^= 0x1234;
        source[by * 64 + bx] ^= 0x5678;
        assert(screen_backing_update_changed(backing, source, dirty, &changed));
        int left = ax < bx ? ax : bx, top = ay < by ? ay : by;
        assert(changed.x == x + left && changed.y == y + top);
        assert(changed.width == abs(ax - bx) + 1 && changed.height == abs(ay - by) + 1);
        for (int row = 0; row < 64; ++row)
            assert(!memcmp(source + row * 64, backing + (y + row) * SCREEN_SIDE + x, 64 * sizeof(uint16_t)));
    }
    puts("PASS: 250 unchanged and sparse source updates preserve backing and minimal dirty bounds");
}

static void arbitrary_quality(void)
{
    /* Compare against an independent floating-point, full-precision filter.
     * Fixed-point quantization may differ by one RGB565 channel level. */
    const unsigned angles[] = {1, 15, 37, 45, 127, 225, 359};
    for (int y = 0; y < SCREEN_SIDE; ++y) for (int x = 0; x < SCREEN_SIDE; ++x)
        backing[y * SCREEN_SIDE + x] = swap565((uint16_t)((((x / 11) % 32) << 11) | (((y / 7) % 64) << 5) | ((x + y) / 17 % 32)));
    unsigned filtered = 0;
    for (unsigned n = 0; n < sizeof(angles) / sizeof(*angles); ++n) {
        screen_transform_t transform; screen_rect_t area;
        assert(screen_transform_init(angles[n], &transform));
        assert(screen_rotate_backing(&transform, backing, (screen_rect_t){0, 0, SCREEN_SIDE, SCREEN_SIDE}, output, SCREEN_SIDE * SCREEN_SIDE, &area));
        double angle = angles[n] * 3.14159265358979323846 / 180.0;
        for (int y = 3; y < SCREEN_SIDE - 3; y += 3) for (int x = 3; x < SCREEN_SIDE - 3; x += 3) {
            double sx = 232.5 + cos(angle) * (x - 232.5) + sin(angle) * (y - 232.5);
            double sy = 232.5 - sin(angle) * (x - 232.5) + cos(angle) * (y - 232.5);
            int ix = (int)floor(sx), iy = (int)floor(sy);
            if (ix < 0 || ix + 1 >= SCREEN_SIDE || iy < 0 || iy + 1 >= SCREEN_SIDE) continue;
            double fx = sx - ix, fy = sy - iy;
            uint16_t actual = swap565(output[y * SCREEN_SIDE + x]);
            const unsigned shifts[] = {11, 5, 0}, masks[] = {31, 63, 31};
            for (unsigned channel = 0; channel < 3; ++channel) {
                unsigned shift = shifts[channel], mask = masks[channel];
                double expected = 0;
                for (int dy = 0; dy < 2; ++dy) for (int dx = 0; dx < 2; ++dx)
                    expected += ((swap565(backing[(iy + dy) * SCREEN_SIDE + ix + dx]) >> shift) & mask) *
                        (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
                assert(abs((int)((actual >> shift) & mask) - (int)lround(expected)) <= 1);
            }
            if (output[y * SCREEN_SIDE + x] != backing[(int)lround(sy) * SCREEN_SIDE + (int)lround(sx)]) filtered++;
        }
    }
    assert(filtered > 1000);
}

static void arbitrary_touch(void)
{
    for (unsigned angle = 0; angle < 360; ++angle) {
        double radians = angle * 3.14159265358979323846 / 180.0;
        const int points[][2] = {{233, 233}, {300, 200}, {200, 200}, {200, 300}, {157, 390}, {233, 1}, {1, 233}};
        int mapped[7][2];
        for (unsigned i = 0; i < 7; ++i) {
            double dx = points[i][0] - 232.5, dy = points[i][1] - 232.5;
            int x = (int)lround(232.5 + cos(radians) * dx - sin(radians) * dy);
            int y = (int)lround(232.5 + sin(radians) * dx + cos(radians) * dy);
            screen_unrotate_point(angle, x, y, &mapped[i][0], &mapped[i][1]);
            assert(abs(mapped[i][0] - points[i][0]) <= 1 && abs(mapped[i][1] - points[i][1]) <= 1);
        }
        module_touch_t touch;
        module_touch_begin(&touch, mapped[1][0], mapped[1][1], 0);
        assert(module_touch_end(&touch, mapped[2][0], mapped[2][1], 100000) == MODULE_TOUCH_NEXT);
        module_touch_begin(&touch, mapped[3][0], mapped[3][1], 0);
        assert(module_touch_end(&touch, mapped[2][0], mapped[2][1], 100000) == MODULE_TOUCH_PAGE_NEXT);
        assert(module_touch_roon(mapped[4][0], mapped[4][1], 358, 64, 12, true, true) == 1);
    }
    int x, y;
    screen_unrotate_point(45, 0, 0, &x, &y);
    assert(x < 0 && y >= 232 && y <= 233); /* No false edge control tap. */
}
int main(void)
{
    unsigned cases = 0;
    for (unsigned rotation = 0; rotation <= 270; rotation += 90) {
        memset(screen, 0, sizeof(screen));
        for (int y = 0; y < SCREEN_SIDE; y += 50) {
            int height = SCREEN_SIDE - y < 50 ? SCREEN_SIDE - y : 50;
            screen_rect_t area;
            for (int row = 0; row < height; ++row) for (int x = 0; x < SCREEN_SIDE; ++x)
                source[row * SCREEN_SIDE + x] = pattern(x, y + row);
            output[0] = output[SCREEN_SIDE * height + 1] = 0xa55a;
            assert(screen_rotate_pixels(rotation, source, (screen_rect_t){0, y, SCREEN_SIDE, height}, output + 1, SCREEN_SIDE * height, &area));
            assert(output[0] == 0xa55a && output[SCREEN_SIDE * height + 1] == 0xa55a);
            for (int row = 0; row < area.height; ++row)
                memcpy(screen + (area.y + row) * SCREEN_SIDE + area.x, output + 1 + row * area.width, area.width * sizeof(uint16_t));
        }
        for (int y = 0; y < SCREEN_SIDE; ++y) for (int x = 0; x < SCREEN_SIDE; ++x) {
            int px, py, lx, ly;
            forward(rotation, x, y, &px, &py);
            assert(screen[py * SCREEN_SIDE + px] == pattern(x, y));
            screen_unrotate_point(rotation, px, py, &lx, &ly);
            assert(lx == x && ly == y);
            cases++;
        }
        module_touch_t touch;
        int px, py, x, y;
        forward(rotation, 300, 200, &px, &py); screen_unrotate_point(rotation, px, py, &x, &y);
        module_touch_begin(&touch, x, y, 0);
        forward(rotation, 200, 200, &px, &py); screen_unrotate_point(rotation, px, py, &x, &y);
        assert(module_touch_end(&touch, x, y, 100000) == MODULE_TOUCH_NEXT);
        forward(rotation, 200, 300, &px, &py); screen_unrotate_point(rotation, px, py, &x, &y);
        module_touch_begin(&touch, x, y, 0);
        forward(rotation, 200, 200, &px, &py); screen_unrotate_point(rotation, px, py, &x, &y);
        assert(module_touch_end(&touch, x, y, 100000) == MODULE_TOUCH_PAGE_NEXT);
        forward(rotation, 157, 390, &px, &py); screen_unrotate_point(rotation, px, py, &x, &y);
        assert(module_touch_roon(x, y, 358, 64, 12, true, true) == 1);
    }
    screen_rect_t result;
    for (unsigned rotation = 0; rotation <= 270; rotation += 90) for (int i = 0; i < 500; ++i) {
        int x = i * 13 % SCREEN_SIDE, y = i * 29 % SCREEN_SIDE;
        int width = 1 + i * 17 % (SCREEN_SIDE - x), height = 1 + i * 31 % (SCREEN_SIDE - y);
        size_t count = (size_t)width * height;
        for (int row = 0; row < height; ++row) for (int col = 0; col < width; ++col) source[row * width + col] = pattern(x + col, y + row);
        output[0] = output[count + 1] = 0xa55a;
        assert(screen_rotate_pixels(rotation, source, (screen_rect_t){x, y, width, height}, output + 1, count, &result));
        for (int row = 0; row < height; ++row) for (int col = 0; col < width; ++col) {
            int px, py; forward(rotation, x + col, y + row, &px, &py);
            assert(output[1 + (py - result.y) * result.width + px - result.x] == pattern(x + col, y + row));
        }
        assert(output[0] == 0xa55a && output[count + 1] == 0xa55a);
        assert(!screen_rotate_pixels(rotation, source, (screen_rect_t){x, y, width, height}, output + 1, count - 1, &result));
    }
    assert(!screen_rotate_pixels(45, source, (screen_rect_t){0, 0, 2, 2}, output, 4, &result));
    assert(!screen_rotate_pixels(90, source, (screen_rect_t){465, 465, 2, 2}, output, 4, &result));
    assert(!screen_rotate_pixels(90, source, (screen_rect_t){-1, 0, 2, 2}, output, 4, &result));
    assert(!screen_rotate_pixels(90, source, (screen_rect_t){0, 0, 2, 2}, source, 4, &result));
    int x,y; screen_unrotate_point(0, 466, -1, &x, &y); assert(x == 465 && y == 0);
    arbitrary_updates(); arbitrary_quality(); arbitrary_touch(); changed_updates();
    printf("PASS: %u complete-frame pixel/touch mappings,2000 arbitrary partial rectangles,swipes,controls,edge clamping and buffer guards\n", cases);
    puts("PASS: 360 filtered dirty updates equal complete redraws; independent bilinear reference and all 360 touch angles");
}
