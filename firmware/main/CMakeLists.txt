idf_component_register(
    SRCS "main.c" "face_model.c" "face_accent.c" "face_decor.c" "face_shimmer.c" "grok_codec.c" "grok_player.c"
         "display_module.c" "module_view.c" "attention_view.c" "attention_protocol.c" "attention_gesture.c" "module_touch.c" "design_fonts.c" "roon_artwork.c" "usage_pattern.c" "roon_motion.c" "reicon_icons.c"
         "screen_rotation.c" "screen_rotation_runtime.c" "panel_psram_dma.c"
         "fonts/lv_font_geist_16.c" "fonts/lv_font_geist_22.c" "fonts/lv_font_geist_28.c" "fonts/lv_font_geist_44.c"
         "fonts/lv_font_geist_pixel_22.c" "fonts/lv_font_geist_pixel_44.c"
         "fonts/lv_font_geist_pixel_56.c" "fonts/lv_font_geist_pixel_128.c"
    EMBED_FILES "grok_clips.bin" "../../fonts/geist/Geist-Regular.ttf" "../../fonts/geist/GeistPixel-Circle.ttf"
    INCLUDE_DIRS "."
    REQUIRES esp_driver_usb_serial_jtag esp_timer esp_psram json)

target_link_libraries(${COMPONENT_LIB} INTERFACE
    "-Wl,--wrap=esp_lcd_new_panel_io_spi"
    "-Wl,--wrap=spi_bus_initialize"
    "-Wl,--undefined=__wrap_esp_lcd_new_panel_io_spi")
