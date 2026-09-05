#include "roon_motion.h"
#include <math.h>

static double ease(double elapsed, double duration)
{
    double t = elapsed / duration;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    double left = 1 - t;
    return 1 - left * left * left;
}
static double mix(double from, double to, double amount) { return from + (to - from) * amount; }

bool roon_motion_settled(const roon_motion_t *motion)
{
    return motion->initialized && motion->pose.x == motion->target.x && motion->pose.y == motion->target.y &&
        motion->pose.size == motion->target.size && motion->pose.radius == motion->target.radius && motion->pose.chrome == motion->target.chrome;
}

roon_pose_t roon_motion_sample(roon_motion_t *motion, double now)
{
    if (!motion->initialized || !isfinite(now)) return motion->pose;
    double delta = now - motion->last_time;
    if (delta < 0) { motion->started += delta; motion->angle_started += delta; delta = 0; }
    motion->last_time = now;
    double amount = motion->animate ? ease(now - motion->started, .280) : 1;
    motion->pose.x = mix(motion->from.x, motion->target.x, amount);
    motion->pose.y = mix(motion->from.y, motion->target.y, amount);
    motion->pose.size = mix(motion->from.size, motion->target.size, amount);
    motion->pose.radius = mix(motion->from.radius, motion->target.radius, amount);
    motion->pose.chrome = mix(motion->from.chrome, motion->target.chrome, motion->animate ? ease(now - motion->started, .180) : 1);
    if (motion->expanded && motion->spin) {
        if (motion->playing) motion->pose.angle = fmod(motion->pose.angle + delta * 18, 360);
    } else motion->pose.angle = mix(motion->angle_from, motion->angle_to, motion->animate ? ease(now - motion->angle_started, .280) : 1);
    return motion->pose;
}

void roon_motion_set(roon_motion_t *motion, bool expanded, bool animate, bool spin, bool playing,
                     double x, double y, double size, double radius, double now)
{
    if (!isfinite(now)) now = 0;
    roon_pose_t target = expanded ? (roon_pose_t){18, 18, 430, 215, 0, 0} : (roon_pose_t){x, y, size, radius, 1, 0};
    if (!motion->initialized) {
        *motion = (roon_motion_t){ .initialized = true, .expanded = expanded, .animate = animate, .spin = spin, .playing = playing,
            .started = now, .last_time = now, .angle_started = now, .from = target, .target = target, .pose = target };
        return;
    }
    roon_motion_sample(motion, now);
    if (motion->expanded != expanded || motion->target.x != target.x || motion->target.y != target.y ||
        motion->target.size != target.size || motion->target.radius != target.radius) {
        motion->from = motion->pose; motion->target = target; motion->started = now;
    }
    if ((motion->expanded && !expanded) || (motion->spin && !spin)) {
        motion->angle_from = motion->pose.angle;
        motion->angle_to = round(motion->pose.angle / 360) * 360;
        motion->angle_started = now;
    }
    motion->expanded = expanded; motion->animate = animate; motion->spin = spin; motion->playing = playing;
    /* Apply opt-out immediately, including when changed halfway through a transition. */
    roon_motion_sample(motion, now);
    if (!animate) {
        /* Re-enabling animation must not resurrect the already completed transition. */
        motion->from = motion->pose;
        motion->started = now;
        motion->angle_from = motion->angle_to = motion->pose.angle;
        motion->angle_started = now;
    }
}
