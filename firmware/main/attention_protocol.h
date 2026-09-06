#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "cJSON.h"

typedef struct {
    bool active, detail;
    char id[37];
    uint32_t revision;
    char body[1921];
    unsigned count;
    struct { char id[33], label[65]; } actions[2];
} attention_snapshot_t;

bool attention_parse(const cJSON *root, attention_snapshot_t *out);
