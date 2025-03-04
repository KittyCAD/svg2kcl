import { debug } from 'console'
import { EPSILON_INTERSECT } from '../../constants'
import { PathFragment } from '../../paths/fragments/fragment'
import { Vector } from '../../types/base'
import { PathFragmentType } from '../../types/fragments'
import {
  computePointToPointDistance,
  computeTangentToCubicFragment,
  computeTangentToLineFragment,
  computeTangentToQuadraticFragment,
  Intersection
} from '../../utils/geometry'

export function connectFragments(fragments: PathFragment[], intersections: Intersection[]): void {
  const debugDict: {
    [key: string]: string[]
  } = {}

  // Process each fragment in order
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]
    const connectedFrags: Array<{ fragmentId: string; angle: number }> = []

    // For each fragment, check all other fragments for possible connections
    for (const otherFragment of fragments) {
      // Skip self-connection
      if (otherFragment === fragment) continue

      // Connect if the other fragment's START matches current fragment's END
      if (computePointToPointDistance(fragment.end, otherFragment.start) < EPSILON_INTERSECT) {
        try {
          const angle = calculateConnectionAngle(fragment, otherFragment)
          connectedFrags.push({
            fragmentId: otherFragment.id,
            angle
          })
        } catch (error) {
          console.warn(
            `Failed to calculate forward angle for ${fragment.id} to ${otherFragment.id}: ${error}`
          )
          // Fallback to a simple direction-based angle if curve calculation fails
          const dx = otherFragment.start.x - fragment.end.x
          const dy = otherFragment.start.y - fragment.end.y
          const angle = Math.atan2(dy, dx)
          connectedFrags.push({
            fragmentId: otherFragment.id,
            angle
          })
        }
      }

      // Connect if the other fragment's END matches current fragment's END
      if (computePointToPointDistance(fragment.end, otherFragment.end) < EPSILON_INTERSECT) {
        try {
          // Use a safer reverse connection angle calculation
          const angle = safeCalculateReverseConnectionAngle(fragment, otherFragment)
          connectedFrags.push({
            fragmentId: otherFragment.id,
            angle
          })
        } catch (error) {
          console.warn(
            `Failed to calculate reverse angle for ${fragment.id} to ${otherFragment.id}: ${error}`
          )
          // Fallback to a simple direction-based angle
          const dx = otherFragment.end.x - fragment.end.x
          const dy = otherFragment.end.y - fragment.end.y
          const angle = Math.atan2(dy, dx)
          connectedFrags.push({
            fragmentId: otherFragment.id,
            angle
          })
        }
      }
    }

    // Sort connections by angle for consistent traversal
    connectedFrags.sort((a, b) => a.angle - b.angle)
    fragment.connectedFragments = connectedFrags

    // console.log(`Fragment ${fragment.id} connected to:`, connectedFrags)
    let connectedIds = connectedFrags.map((frag) => frag.fragmentId)
    debugDict[fragment.id] = connectedIds
  }
}

// A safer function for calculating reverse connection angles
function safeCalculateReverseConnectionAngle(
  fragment1: PathFragment,
  fragment2: PathFragment
): number {
  // For line segments, we can simply reverse direction
  if (fragment2.type === PathFragmentType.Line) {
    // Simple reversal - use end to start direction
    const dx = fragment2.start.x - fragment2.end.x
    const dy = fragment2.start.y - fragment2.end.y
    return Math.atan2(dy, dx)
  }

  // For curved segments, we need special handling based on curve type
  if (fragment2.type === PathFragmentType.Quad) {
    // For quadratic curves, ensure control1 exists
    if (!fragment2.control1) {
      throw new Error('Quadratic curve missing control point')
    }

    // The tangent at the end point of a quadratic curve
    const dx = fragment2.end.x - fragment2.control1.x
    const dy = fragment2.end.y - fragment2.control1.y
    return Math.atan2(-dy, -dx) // Negate to reverse direction
  }

  if (fragment2.type === PathFragmentType.Cubic) {
    // For cubic curves, ensure control2 exists
    if (!fragment2.control2) {
      throw new Error('Cubic curve missing control point')
    }

    // The tangent at the end point of a cubic curve
    const dx = fragment2.end.x - fragment2.control2.x
    const dy = fragment2.end.y - fragment2.control2.y
    return Math.atan2(-dy, -dx) // Negate to reverse direction
  }

  // Fallback - simple direction estimate
  return Math.atan2(fragment2.start.y - fragment2.end.y, fragment2.start.x - fragment2.end.x)
}

export function calculateConnectionAngle(from: PathFragment, to: PathFragment): number {
  // We need to compute the angle between the two fragments, i.e.
  // the angle between a line tangent to the end of 'from' and a line tangent to the
  // start of 'to'. We could use our sampled points or do this by actually
  // computing the tangent.
  // Actual tangent of a Bezier:
  // https://stackoverflow.com/questions/4089443/find-the-tangent-of-a-point-on-a-cubic-bezier-curve

  // Get tangents.
  const tangentFrom = getFragmentTangent(from, 1)
  const tangentTo = getFragmentTangent(to, 0)

  // I need the _signed_ angle between these two vectors.
  // https://wumbo.net/formulas/angle-between-two-vectors-2d/

  // Compute cross and dot products.
  const cross = tangentFrom.x * tangentTo.y - tangentFrom.y * tangentTo.x
  const dot = tangentFrom.x * tangentTo.x + tangentFrom.y * tangentTo.y

  // Compute signed angle in radians (range [-π, π])
  const theta = Math.atan2(cross, dot)

  // I _think_ positive is anticlockwise, negative is clockwise.

  return theta
}

export function getFragmentTangent(fragment: PathFragment, t: number): Vector {
  let tangent: Vector
  if (fragment.type === PathFragmentType.Line) {
    tangent = computeTangentToLineFragment(fragment)
  } else if (fragment.type === PathFragmentType.Quad) {
    tangent = computeTangentToQuadraticFragment(fragment, t)
  } else if (fragment.type === PathFragmentType.Cubic) {
    tangent = computeTangentToCubicFragment(fragment, t)
  } else {
    throw new Error(`Unsupported fragment type: ${fragment.type}`)
  }

  return tangent
}
