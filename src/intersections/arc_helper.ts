export function normalizeAngle(a: number, ref: number): number {
  const diff = a - ref
  if (diff >= 0) {
    return diff
  } else {
    return diff + 2 * Math.PI
  }
}
