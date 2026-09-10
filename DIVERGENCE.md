# Divergence log

Departures from the INKFALL build spec, with reasons. Empty means the build followed spec.

## 1. Boost raises the pedal cut-off speed as well as pedal force
**Spec (§3):** "Shift spends it (+30% pedal force, FOV kick, ink speed-strokes)."
**Built:** boost multiplies pedal force by 1.3 *and* raises the pedal cut-off from 32 km/h
to 41.6 km/h for as long as it is held.
**Reason:** pedal torque already fades to zero at 32 km/h, and the descent runs at
40–70 km/h. A pure force multiplier would leave boost with literally no effect for most of
the course, which contradicts its role as a resource you bank on the jump line and spend on
straights (§3, §5 MUN). The FOV kick and speed-strokes are unchanged.

## 2. The air side-dolly holds until the 4 s cut floor, not landing + 0.3 s
**Spec (§7):** "Air side-dolly: … cut back on landing + 0.3 s" and "cuts are hard cuts,
never closer than 4 s apart".
**Built:** the side dolly returns to chase at `max(cutTime + 4 s, landingTime + 0.3 s)`.
**Reason:** the two rules contradict each other. Real air off this course is 0.6–2.3 s, so
"landing + 0.3 s" would always cut back inside the 4 s floor, and kill gate 8 asserts the
floor. The floor wins; the dolly simply keeps tracking the rider for a beat after touchdown,
which is what a side dolly does anyway.
