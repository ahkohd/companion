# IDF evaluates component requirements in a separate CMake process.
set(COMPANION_BOARD "$ENV{COMPANION_BUILD_BOARD}")
include("${CMAKE_CURRENT_LIST_DIR}/../boards/${COMPANION_BOARD}/profile.cmake")

idf_component_register(
    SRCS "main.c" "face_model.c" "face_accent.c" "face_decor.c" "face_shimmer.c" "grok_codec.c" "grok_player.c"
         "display_module.c" "module_view.c" "attention_view.c" "attention_protocol.c" "attention_gesture.c" "module_touch.c" "design_fonts.c" "roon_artwork.c" "usage_pattern.c" "roon_motion.c" "reicon_icons.c"
         "screen_rotation.c" "screen_rotation_runtime.c" ${COMPANION_BOARD_SOURCES}
         "fonts/lv_font_geist_mono_16.c" "fonts/lv_font_geist_16.c" "fonts/lv_font_geist_22.c" "fonts/lv_font_geist_28.c" "fonts/lv_font_geist_44.c"
         "fonts/lv_font_geist_pixel_22.c" "fonts/lv_font_geist_pixel_44.c"
         "fonts/lv_font_geist_pixel_56.c" "fonts/lv_font_geist_pixel_128.c"
    EMBED_FILES "grok_clips.bin" "../../fonts/geist/Geist-Regular.ttf" "../../fonts/geist/GeistPixel-Circle.ttf"
    INCLUDE_DIRS "." "../boards" "../boards/${COMPANION_BOARD}"
    REQUIRES esp_driver_usb_serial_jtag esp_timer esp_psram json)

target_link_libraries(${COMPONENT_LIB} INTERFACE ${COMPANION_BOARD_LINK_OPTIONS})
