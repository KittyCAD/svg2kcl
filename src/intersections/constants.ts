// General case. Used for line-line intersection, and for point degeneracy checks etc.
export const EPS_INTERSECTION = 1e-9

// Line-Arc intersection.
export const EPS_ANGLE_INTERSECTION = 1e-6 // Angle difference (radians) small enough to treat as zero.

// Bezier-Bezier intersection.
export const MAX_RECURSION_DEPTH = 50
export const EPS_BBOX = 1e-6 // Bounding box is small enough; stop dividing.
export const EPS_ROOT_DUPE = 1e-5 // Root duplication epsilon.

// Parameter space equivalence.
export const EPS_PARAM = 1e-3 // Two t-values are close enough to be considered equal.
