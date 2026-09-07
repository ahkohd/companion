# The pinned Waveshare BSP owns panel/touch drivers, pin assignments and power init.
set(COMPANION_BOARD_SOURCES
    "../boards/waveshare-1.75-b/board.c"
    "../boards/waveshare-1.75-b/panel_psram_dma.c")
set(COMPANION_BOARD_LINK_OPTIONS
    "-Wl,--wrap=esp_lcd_new_panel_io_spi"
    "-Wl,--wrap=spi_bus_initialize"
    "-Wl,--undefined=__wrap_esp_lcd_new_panel_io_spi")
