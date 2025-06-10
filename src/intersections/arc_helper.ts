export function normalizeSweep(start: number, end: number): number {
  let s = end - start
  while (s < 0) s += 2 * Math.PI
  return Math.abs(s)
}

export function normalizeAngle(a: number, ref: number): number {
  const diff = a - ref
  if (diff >= 0) {
    return diff
  } else {
    return diff + 2 * Math.PI
  }
}
