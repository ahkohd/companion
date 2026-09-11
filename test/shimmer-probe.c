#include "face_shimmer.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static void raster_checks(void)
{
    const uint16_t mask[15] = {0,      0xffff, 0, 0xffff, 0, 0xffff, 0x7bef, 0,
                               0xffff, 0,      0, 0xffff, 0, 0xffff, 0};
    uint16_t first[40], second[40];
    memset(first, 0, sizeof(first));
    memset(second, 0, sizeof(second));
    int ink = face_shimmer_blit(mask, 5, 3, first, 8, 5, 1, 1, .35, false);

    assert(ink == 7);
    assert(face_shimmer_blit(mask, 5, 3, second, 8, 5, 1, 1, 1.1, false) == ink);
    assert(memcmp(first, second, sizeof(first)) != 0);

    for (int y = 0; y < 5; y++)
        for (int x = 0; x < 8; x++) {
            if (y < 1 || y > 3 || x < 1 || x > 5 || !mask[(y - 1) * 5 + x - 1])
                assert(first[y * 8 + x] == 0);
        }

    memset(first, 0, sizeof(first));
    memset(second, 0, sizeof(second));

    assert(face_shimmer_blit(mask, 5, 3, first, 8, 5, 1, 1, .35, true) == ink);
    assert(face_shimmer_blit(mask, 5, 3, second, 8, 5, 1, 1, 1.1, true) == ink);
    assert(memcmp(first, second, sizeof(first)) == 0);
    assert(first[2 * 8 + 2] <
           first[2 * 8 + 1]); // Antialiased edge stays dimmer than full coverage.

    struct {
        uint16_t before[4], pixels[6], after[4];
    } guarded;

    memset(&guarded, 0x34, sizeof(guarded));
    face_shimmer_blit(mask, 5, 3, guarded.pixels, 3, 2, -2, -1, .8, false);

    for (int i = 0; i < 4; i++)
        assert(guarded.before[i] == 0x3434 && guarded.after[i] == 0x3434);

    face_shimmer_blit(mask, 5, 3, guarded.pixels, 3, 2, 20, 20, .8, false);

    assert(face_shimmer_blit(NULL, 5, 3, first, 8, 5, 0, 0, 0, false) == 0);
    assert(face_shimmer_blit(mask, 0, 3, first, 8, 5, 0, 0, 0, false) == 0);

    memset(first, 0, sizeof(first));
    memset(second, 0, sizeof(second));

    assert(face_shimmer_blit_palette(mask, 5, 3, first, 8, 5, 1, 1, .35, false, 0x7e768c,
                                     0xb6aec5) == ink);
    assert(face_shimmer_blit_palette(mask, 5, 3, second, 8, 5, 1, 1, 1.1, false, 0x7e768c,
                                     0xb6aec5) == ink);
    assert(memcmp(first, second, sizeof(first)) != 0);

    for (int y = 0; y < 5; y++)
        for (int x = 0; x < 8; x++) {
            if (y < 1 || y > 3 || x < 1 || x > 5 || !mask[(y - 1) * 5 + x - 1])
                assert(first[y * 8 + x] == 0);
        }

    memset(first, 0, sizeof(first));
    memset(second, 0, sizeof(second));

    assert(face_shimmer_blit_palette(mask, 5, 3, first, 8, 5, 1, 1, .35, true, 0x7e768c,
                                     0xb6aec5) == ink);
    assert(face_shimmer_blit_palette(mask, 5, 3, second, 8, 5, 1, 1, 1.1, true, 0x7e768c,
                                     0xb6aec5) == ink);
    assert(memcmp(first, second, sizeof(first)) == 0);

    uint16_t empty[15] = {0};

    assert(face_shimmer_blit(empty, 5, 3, first, 8, 5, 0, 0, 0, false) == 0);
}

int main(int argc, char **argv)
{
    if (argc > 1 && strcmp(argv[1], "subtitle") == 0) {
        double time, u;
        int reduced;

        while (scanf("%lf %lf %d", &time, &u, &reduced) == 3)
            printf("%u\n", face_name_shimmer_color(time, u, reduced != 0));
        return 0;
    }

    if (argc > 1) {
        raster_checks();
        puts("shimmer raster checks passed");
        return 0;
    }

    double time, u;
    int reduced;

    while (scanf("%lf %lf %d", &time, &u, &reduced) == 3)
        printf("%u\n", face_shimmer_color(time, u, reduced != 0));

    return 0;
}
