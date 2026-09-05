Animation engine from https://github.com/jeremy-prt/bloub
Revision: b4bb3c1b5f93c7b87a2e8d620f667c4093d97749
Copyright Jeremy Perret. Distributed under the MIT license in LICENSE.
Local patch: zero-duration gaze changes return the target directly, avoiding
NaN eye transforms when reduced motion is disabled after mouse updates.
The blink calendar repeats every 15 minutes, without interrupting a blink at
the boundary, so a long-running face continues blinking.
The renderer is separate.
