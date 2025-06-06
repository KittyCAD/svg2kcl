import { Vector } from '../types/base'

export function computeAngleBetweenVectors(v1: Vector, v2: Vector): number {
  // Calculate cross and dot products
  const cross = v1.x * v2.y - v1.y * v2.x
  const dot = v1.x * v2.x + v1.y * v2.y

  // Compute signed angle in radians (range [-π, π]).
  // Positive angle = anticlockwise rotation from v2 to v1.
  // Negative angle = clockwise rotation from v2 to v1.
  return Math.atan2(cross, dot)
}

export function normalizeVector(vector: Vector): Vector {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y)
  if (length === 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  }
}

export function dotProduct(v1: Vector, v2: Vector): number {
  return v1.x * v2.x + v1.y * v2.y
}

export function crossProduct(v1: Vector, v2: Vector): number {
  return v1.x * v2.y - v1.y * v2.x
}
