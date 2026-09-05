#pragma once
#include <stdbool.h>

typedef struct { double x, y, size, radius, chrome, angle; } roon_pose_t;
typedef struct {
    bool initialized, expanded, animate, spin, playing;
    double started, last_time, angle_started, angle_from, angle_to;
    roon_pose_t from, target, pose;
} roon_motion_t;

void roon_motion_set(roon_motion_t *motion, bool expanded, bool animate, bool spin, bool playing,
                     double x, double y, double size, double radius, double now);
roon_pose_t roon_motion_sample(roon_motion_t *motion, double now);
bool roon_motion_settled(const roon_motion_t *motion);
