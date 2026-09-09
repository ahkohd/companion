#include "board.h"
#include "touch_samples.h"
#include "esp_lv_adapter.h"
#include "esp_lcd_touch.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <math.h>

static portMUX_TYPE sample_lock = portMUX_INITIALIZER_UNLOCKED;
static touch_samples_t samples = {.irq_driven = true};
static TaskHandle_t sampler_task;
static uint32_t pending_irqs;
static int64_t first_irq_us;
static uint32_t sample_reads, sample_errors;
static touch_sample_t delivered;
static esp_lcd_touch_handle_t touch_handle;
static float scale_x, scale_y;
static lv_indev_t *sampled_input;

void companion_board_touch_cancel(void)
{
    int64_t now = esp_timer_get_time();
    portENTER_CRITICAL(&sample_lock);
    touch_samples_cancel(&samples, now);
    portEXIT_CRITICAL(&sample_lock);
}

uint32_t companion_board_touch_reads(void)
{
    portENTER_CRITICAL(&sample_lock);
    uint32_t value = sample_reads;
    portEXIT_CRITICAL(&sample_lock);
    return value;
}
uint32_t companion_board_touch_errors(void)
{
    portENTER_CRITICAL(&sample_lock);
    uint32_t value = sample_errors;
    portEXIT_CRITICAL(&sample_lock);
    return value;
}

int64_t companion_board_touch_sample_time_us(void)
{
    portENTER_CRITICAL(&sample_lock);
    int64_t value = delivered.time_us;
    portEXIT_CRITICAL(&sample_lock);
    return value;
}
uint32_t companion_board_touch_revision(void)
{
    portENTER_CRITICAL(&sample_lock);
    uint32_t value = samples.revision;
    portEXIT_CRITICAL(&sample_lock);
    return value;
}
bool companion_board_touch_sample_valid(void)
{
    portENTER_CRITICAL(&sample_lock);
    bool value = delivered.valid;
    portEXIT_CRITICAL(&sample_lock);
    return value;
}

static void IRAM_ATTR touch_interrupt(esp_lcd_touch_handle_t handle)
{
    (void)handle;
    int64_t now = esp_timer_get_time();
    portENTER_CRITICAL_ISR(&sample_lock);
    if (!pending_irqs) first_irq_us = now;
    if (pending_irqs < UINT32_MAX) ++pending_irqs;
    portEXIT_CRITICAL_ISR(&sample_lock);
    BaseType_t awakened = pdFALSE;
    vTaskNotifyGiveFromISR(sampler_task, &awakened);
    if (awakened) portYIELD_FROM_ISR();
}

static void sample_touch(void *unused)
{
    (void)unused;
    for (;;) {
        // CST9217 exposes a report only after its IRQ. Idle polling returns invalid ACK.
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        portENTER_CRITICAL(&sample_lock);
        uint32_t reports = pending_irqs;
        int64_t reported_at = first_irq_us;
        pending_irqs = 0;
        portEXIT_CRITICAL(&sample_lock);
        if (!reports) continue;
        esp_lcd_touch_point_data_t points[2] = {0};
        uint8_t count = 0;
        // This task is the only reader of the touch controller and its driver buffer.
        esp_err_t result = esp_lcd_touch_read_data(touch_handle);
        if (result == ESP_OK) result = esp_lcd_touch_get_data(touch_handle, points, &count, 2);
        int64_t completed_at = esp_timer_get_time();
        bool valid = result == ESP_OK && count <= 1;
        bool lost_report = reports > 1 || completed_at - reported_at > TOUCH_SAMPLE_MAX_GAP_US;
        int x = count == 1 ? (int)(points[0].x * scale_x) : 0;
        int y = count == 1 ? (int)(points[0].y * scale_y) : 0;
        portENTER_CRITICAL(&sample_lock);
        // An IRQ during I2C means the register report may have changed mid-read.
        // Cancel before publishing anything, even if LVGL drains on the other core.
        lost_report = lost_report || pending_irqs > 0;
        ++sample_reads;
        if (!valid || lost_report) ++sample_errors;
        if (lost_report) touch_samples_cancel(&samples, reported_at);
        // An ambiguous read cannot unblock cancellation, even if it looks released.
        touch_samples_push(&samples, x, y, count == 1, valid && !lost_report, reported_at);
        portEXIT_CRITICAL(&sample_lock);
    }
}

static void read_samples(lv_indev_t *input, lv_indev_data_t *data)
{
    (void)input;
    portENTER_CRITICAL(&sample_lock);
    touch_samples_pop(&samples, &delivered);
    data->point.x = delivered.x;
    data->point.y = delivered.y;
    data->state = delivered.pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
    data->continue_reading = samples.count > 0;
    portEXIT_CRITICAL(&sample_lock);
}

// Replace only the BSP's registration boundary, not managed driver implementation.
// The public driver getter applies mirror/swap flags before the adapter's scale.
lv_indev_t *__wrap_esp_lv_adapter_register_touch(const esp_lv_adapter_touch_config_t *config)
{
    if (!config || !config->handle || !config->disp || sampled_input || config->handle->config.int_gpio_num == GPIO_NUM_NC ||
        config->multi_touch.mode != ESP_LV_ADAPTER_TOUCH_MODE_SINGLE ||
        !isfinite(config->scale.x) || !isfinite(config->scale.y) || config->scale.x <= 0 || config->scale.y <= 0) return NULL;
    if (esp_lv_adapter_lock(-1) != ESP_OK) return NULL;
    lv_indev_t *input = lv_indev_create();
    if (!input) { esp_lv_adapter_unlock(); return NULL; }
    touch_handle = config->handle; scale_x = config->scale.x; scale_y = config->scale.y;
    lv_indev_set_type(input, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(input, read_samples);
    lv_indev_set_disp(input, config->disp);
    // Startup stays released until the worker observes the first genuine contact.
    delivered = (touch_sample_t){.time_us=esp_timer_get_time(), .valid=true};
    if (xTaskCreate(sample_touch, "touch_sampler", 4096, NULL, ESP_LV_ADAPTER_DEFAULT_TASK_PRIORITY + 1, &sampler_task) != pdPASS) {
        lv_indev_delete(input); esp_lv_adapter_unlock(); return NULL;
    }
    if (esp_lcd_touch_register_interrupt_callback(touch_handle, touch_interrupt) != ESP_OK) {
        vTaskDelete(sampler_task); sampler_task = NULL;
        lv_indev_delete(input); esp_lv_adapter_unlock(); return NULL;
    }
    sampled_input = input;
    esp_lv_adapter_unlock();
    return input;
}
