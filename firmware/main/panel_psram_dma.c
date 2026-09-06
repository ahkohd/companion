#include "esp_lcd_io_spi.h"
#include "driver/spi_master.h"

esp_err_t __real_esp_lcd_new_panel_io_spi(esp_lcd_spi_bus_handle_t bus,
    const esp_lcd_panel_io_spi_config_t *config, esp_lcd_panel_io_handle_t *io);

/* The BSP creates our only SPI panel. Keep its timing, callbacks and commands,
 * but bound its queue to one transfer. The bus wrapper below caps chunks at
 * 8 KB; the driver recycles each internal DMA buffer before queuing the next.
 * This avoids large or concurrent bounce allocations during rotated frames.
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

/* Bound each driver's temporary internal DMA allocation as well as queue depth.
 * The display is the only SPI bus used by this board. Smaller chunks preserve
 * command timing and the driver's single final color-complete callback. */
esp_err_t __real_spi_bus_initialize(spi_host_device_t host, const spi_bus_config_t *config, spi_dma_chan_t dma);
esp_err_t __wrap_spi_bus_initialize(spi_host_device_t host, const spi_bus_config_t *config, spi_dma_chan_t dma)
{
    if (!config) return __real_spi_bus_initialize(host, config, dma);
    spi_bus_config_t bounded = *config;
    /* Two 4092-byte DMA descriptors. 8192 would round up to 12276. */
    if (bounded.max_transfer_sz > 8184) bounded.max_transfer_sz = 8184;
    return __real_spi_bus_initialize(host, &bounded, dma);
}
