#include "esp_lcd_io_spi.h"

esp_err_t __real_esp_lcd_new_panel_io_spi(esp_lcd_spi_bus_handle_t bus,
    const esp_lcd_panel_io_spi_config_t *config, esp_lcd_panel_io_handle_t *io);

/* The BSP creates our only SPI panel. Keep its timing, callbacks and commands,
 * but bound its queue to one transfer. IDF caps each ESP32-S3 SPI chunk at 32 KB
 * and recycles its internal DMA buffer before queuing the next. This prevents
 * ten queued bounce buffers from exhausting internal RAM on a rotated frame.
 * Direct PSRAM DMA produced transfer failures on this board under live load;
 * retain the established internal DMA path. The final chunk still owns the
 * single color-complete callback, so LVGL waits for the complete frame.
 * Link wrapping keeps this board integration outside managed dependencies. */
esp_err_t __wrap_esp_lcd_new_panel_io_spi(esp_lcd_spi_bus_handle_t bus,
    const esp_lcd_panel_io_spi_config_t *config, esp_lcd_panel_io_handle_t *io)
{
    if (!config) return __real_esp_lcd_new_panel_io_spi(bus, config, io);
    esp_lcd_panel_io_spi_config_t bounded = *config;
    bounded.flags.psram_dma_direct = false;
    bounded.trans_queue_depth = 1;
    return __real_esp_lcd_new_panel_io_spi(bus, &bounded, io);
}
