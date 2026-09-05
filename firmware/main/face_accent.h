#pragma once
#include "face_model.h"
#include "face_decor.h"

typedef struct {
    float x, y, rotation, scale;
    int count;
    face_polygon_t decor[FACE_DECOR_MAX_ITEMS];
} face_accent_t;
void face_accent_sample(face_state_t state, double age, face_accent_t *out);
void face_accent_eyes(const face_accent_t *accent, face_eye_t eyes[2]);
