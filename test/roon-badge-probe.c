#include "module_view.c"

int main(void)
{
    lv_init();
    lv_display_create(466, 466);
    module_view_create(lv_screen_active());
    module_snapshot_t module = {.kind = DISPLAY_ROON,
                                .status = MODULE_READY,
                                .page_count = 1,
                                .can_like = true,
                                .has_design = true};
    module_design_default(DISPLAY_ROON, &module.design);
    module.design.roon.animateArtwork = 0;
    module.design.roon.spinArtwork = 0;
    const music_player_t players[] = {MUSIC_ROON, MUSIC_SPOTIFY, MUSIC_APPLE_MUSIC, MUSIC_SYSTEM};
    const int sizes[] = {120, 210, 300};

    for (unsigned size = 0; size < 3; ++size)
        for (unsigned p = 0; p < 4; ++p) {
            module.design.roon.artSize = sizes[size];
            module.player = players[p];
            module_view_update(&module, false);
            module_view_tick(100);
            lv_obj_update_layout(lv_screen_active());
            int x = lv_obj_get_x(roon_art), y = lv_obj_get_y(roon_art);

            for (int dx = -1; dx <= 46; ++dx)
                for (int dy = -1; dy <= 46; ++dy)
                    assert(module_view_roon_badge_hit(x + dx, y + dy, module.player) ==
                           (module.player != MUSIC_SYSTEM && dx >= 1 && dx < 45 && dy >= 1 &&
                            dy < 45));
            assert(!module_view_roon_badge_hit(
                x + 23, y + 23, module.player == MUSIC_ROON ? MUSIC_SPOTIFY : MUSIC_ROON));
            assert(!module_view_roon_badge_hit(233, y + sizes[size] / 2, module.player));
            assert(module_view_roon_art_hit(233, y + sizes[size] / 2));
            assert(module_view_roon_like_hit(x + sizes[size] - 26, y + sizes[size] - 26));

            module.expanded = true;
            module_view_update(&module, false);

            assert(!module_view_roon_badge_hit(x + 23, y + 23, module.player));

            module.expanded = false;
            module.status = MODULE_AUTH;
            module_view_update(&module, false);

            assert(!module_view_roon_badge_hit(x + 23, y + 23, module.player));

            module.status = MODULE_READY;
            module_view_update(&module, true);

            assert(!module_view_roon_badge_hit(x + 23, y + 23, module.player));
        }

    module.player = MUSIC_ROON;
    module.design.roon.animateArtwork = 1;
    module_view_update(&module, false);
    module_view_tick(200);
    module.expanded = true;
    module_view_update(&module, false);
    module_view_tick(200.1);
    module.expanded = false;
    module_view_update(&module, false);

    assert(!module_view_roon_badge_hit(106, 93, MUSIC_ROON));

    module_view_tick(205);

    assert(module_view_roon_badge_hit(lv_obj_get_x(roon_art) + 23, lv_obj_get_y(roon_art) + 23,
                                      MUSIC_ROON));

    module.kind = DISPLAY_CLOCK;
    module_view_update(&module, false);

    assert(!module_view_roon_badge_hit(151, 69, MUSIC_ROON));

    puts("Player badge hit checks passed");
}
