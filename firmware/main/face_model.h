#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef enum { FACE_WORKING, FACE_BLOCKED, FACE_DONE, FACE_IDLE, FACE_SLEEP, FACE_UNKNOWN, FACE_DISCONNECTED, FACE_STATE_COUNT } face_state_t;
typedef struct { float w, h, open, tilt; } face_eye_config_t;
typedef struct { float gaze[3], split; face_eye_config_t eyes[2]; uint32_t color; } face_profile_t;
typedef struct { float x, y, mix; } face_gaze_t;
typedef struct { float w, h, matrix[6], alpha; } face_eye_t;
typedef struct {
    face_state_t state;
    face_profile_t from, target;
    double since, look_since;
    face_gaze_t look_from, look_target, look_velocity;
} face_motion_t;

void face_motion_init(face_motion_t *motion, face_state_t state, double now);
void face_motion_state(face_motion_t *motion, face_state_t state, double now);
void face_motion_look(face_motion_t *motion, bool enabled, float x, float y, double now);
face_gaze_t face_motion_gaze(const face_motion_t *motion, double now);
void face_motion_sample(const face_motion_t *motion, double now, face_eye_t eyes[2]);
uint32_t face_motion_color(const face_motion_t *motion);
void face_render_eyes(const face_profile_t *profile, double now, face_gaze_t look, face_eye_t eyes[2]);
void face_rasterize(uint16_t *pixels, int width, int height, const face_eye_t eyes[2], uint32_t color);

void face_rasterize_scaled(uint16_t *pixels, int width, int height, const face_eye_t eyes[2], uint32_t color, int face_scale);

void face_rasterize_themed(uint16_t *pixels, int width, int height, const face_eye_t eyes[2], uint32_t color, int face_scale, uint32_t background);
