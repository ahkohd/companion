#include "roon_motion.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

static void same(double a, double b) { assert(fabs(a - b) < .000001); }
static void same_pose(roon_pose_t a, roon_pose_t b)
{
    same(a.x, b.x); same(a.y, b.y); same(a.size, b.size); same(a.radius, b.radius); same(a.chrome, b.chrome); same(a.angle, b.angle);
}
int main(void)
{
    roon_motion_t motion = {0};
    roon_motion_set(&motion, false, true, false, false, 138, 70, 190, 16, 0);
    roon_pose_t p = roon_motion_sample(&motion, 1);
    same(p.x, 138); same(p.size, 190); same(p.chrome, 1);
    assert(roon_motion_settled(&motion));
    roon_motion_set(&motion, true, true, false, false, 138, 70, 190, 16, 1);
    p = roon_motion_sample(&motion, 1); same(p.size, 190); same(p.chrome, 1);
    assert(!roon_motion_settled(&motion));
    p = roon_motion_sample(&motion, 1.140); same(p.size, 400); assert(p.chrome > 0 && p.chrome < .02);
    p = roon_motion_sample(&motion, 1.180); same(p.chrome, 0); assert(p.size < 430);
    p = roon_motion_sample(&motion, 1.280); same(p.x, 18); same(p.y, 18); same(p.size, 430); same(p.radius, 215);
    assert(roon_motion_settled(&motion));
    roon_pose_t settled = p;
    for (unsigned second = 2; second < 62; ++second) same_pose(roon_motion_sample(&motion, second), settled);
    roon_motion_set(&motion, false, true, false, false, 138, 70, 190, 16, 61);
    assert(!roon_motion_settled(&motion));
    p = roon_motion_sample(&motion, 61.14); same(p.size, 220);
    roon_motion_set(&motion, true, true, false, false, 138, 70, 190, 16, 61.14);
    same_pose(p, roon_motion_sample(&motion, 61.14));
    p = roon_motion_sample(&motion, 61.42); same(p.size, 430);
    roon_motion_set(&motion, false, true, false, false, 133, 82, 200, 24, 61.42);
    p = roon_motion_sample(&motion, 61.70);
    same(p.x, 133); same(p.y, 82); same(p.size, 200); same(p.radius, 24); same(p.chrome, 1);
    assert(roon_motion_settled(&motion));
    roon_motion_set(&motion, true, true, false, false, 133, 82, 200, 24, 62);
    p = roon_motion_sample(&motion, 62.1);
    same_pose(p, roon_motion_sample(&motion, 1));
    roon_motion_sample(&motion, 1.18);
    unsigned cases = 0;
    for (int i = 0; i < 1000; ++i) {
        double now = 2 + i / 100.0;
        p = roon_motion_sample(&motion, now);
        roon_motion_set(&motion, i % 2, true, false, false, 93, 100, 280, 40, now);
        same_pose(p, roon_motion_sample(&motion, now));
        assert(p.size >= 200 && p.size <= 430 && p.chrome >= 0 && p.chrome <= 1);
        cases++;
    }
    for (int animate = 0; animate <= 1; ++animate) for (int spin = 0; spin <= 1; ++spin) {
        motion = (roon_motion_t){0};
        roon_motion_set(&motion, false, animate, spin, true, 138, 70, 190, 16, 0);
        roon_motion_set(&motion, true, animate, spin, true, 138, 70, 190, 16, 1);
        p = roon_motion_sample(&motion, 1);
        same(p.size, animate ? 190 : 430); same(p.chrome, animate ? 1 : 0);
        assert(roon_motion_settled(&motion) == !animate);
        p = roon_motion_sample(&motion, 6); same(p.size, 430); same(p.angle, spin ? 90 : 0);
        roon_motion_set(&motion, true, animate, spin, false, 138, 70, 190, 16, 6);
        same_pose(p, roon_motion_sample(&motion, 11));
        roon_motion_set(&motion, true, animate, spin, true, 138, 70, 190, 16, 11);
        p = roon_motion_sample(&motion, 21); same(p.angle, spin ? 270 : 0);
        roon_motion_set(&motion, false, animate, spin, true, 138, 70, 190, 16, 21);
        p = roon_motion_sample(&motion, 21);
        same(p.size, animate ? 430 : 190);
        same(fmod(p.angle, 360), animate && spin ? 270 : 0);
        p = roon_motion_sample(&motion, 21.14);
        same(p.size, animate ? 220 : 190);
        same(fmod(p.angle, 360), animate && spin ? 348.75 : 0);
        p = roon_motion_sample(&motion, 21.28); same(p.size, 190); same(fmod(p.angle, 360), 0);
        assert(roon_motion_settled(&motion));
    }
    motion = (roon_motion_t){0};
    roon_motion_set(&motion, true, true, true, true, 138, 70, 190, 16, 0);
    p = roon_motion_sample(&motion, 5); same(p.angle, 90);
    roon_motion_set(&motion, true, true, false, true, 138, 70, 190, 16, 5);
    same(roon_motion_sample(&motion, 5.14).angle, 11.25);
    same(roon_motion_sample(&motion, 5.28).angle, 0);
    roon_motion_set(&motion, true, true, true, true, 138, 70, 190, 16, 6);
    same(roon_motion_sample(&motion, 11).angle, 90);
    roon_motion_set(&motion, true, false, false, true, 138, 70, 190, 16, 11);
    same(motion.pose.angle, 0);
    roon_motion_set(&motion, false, true, false, true, 138, 70, 190, 16, 12);
    p = roon_motion_sample(&motion, 12.14); assert(p.size > 190);
    roon_motion_set(&motion, false, false, false, true, 138, 70, 190, 16, 12.14);
    same(motion.pose.size, 190); same(motion.pose.chrome, 1); assert(roon_motion_settled(&motion));
    roon_motion_set(&motion, true, false, false, true, 138, 70, 190, 16, 13);
    same(motion.pose.size, 430);
    roon_motion_set(&motion, true, true, false, true, 138, 70, 190, 16, 13.05);
    same(motion.pose.size, 430); same(motion.pose.chrome, 0); assert(roon_motion_settled(&motion));
    roon_motion_set(&motion, false, true, false, true, 138, 70, 190, 16, 14);
    roon_motion_set(&motion, false, false, false, true, 138, 70, 190, 16, 14.05);
    roon_motion_set(&motion, false, true, false, true, 138, 70, 190, 16, 14.06);
    same(motion.pose.size, 190); same(motion.pose.chrome, 1); assert(roon_motion_settled(&motion));
    printf("PASS: all4 motion settings, instant default,280ms geometry,180ms chrome,20s spin, pause/resume, opt-out upright, custom restore, clock reset and %u interruption cases\n", cases);
}
