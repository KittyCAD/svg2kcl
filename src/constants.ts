// Solve tolerance for 'coincident' point distance.
// TODO: Make this better. Probably needs localised resampling on Beziers.
export const EPSILON_INTERSECT = 1e-3

// Number of samples to take when sampling Bézier curves for intersection detection.
export const N_CURVE_SAMPLES = 500

// Number of samples to take when sampling fragments for boundary detection.
export const N_CURVE_SAMPLES_BOUNDARY = 100

// Number of samples to take around polygon boundary for fillrule test.
export const N_BOUNDARY_SAMPLES_FILLRULE = 100
