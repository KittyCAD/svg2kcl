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
  // The scenarios under which we would 'connect' fragments are:
  // - A given fragment's endpoint is coincident with the 'next' ordered fragment's
  //   start point, but that coincident point is not an intersection.
  // - A given fragment's endpoint is coincident with an intersection point, and there
  //   exists a fragment starting at that intersection point. This implies that
  //   this fragment was 'created' by a split operation.
  //
  // If we were to connect sequential fragments where start/end points are coincident
  // with an intersection point, we would be double-counting some geometry.

  const debugDict: {
    [key: string]: string[]
  } = {}

  // Process each fragment in order
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]
    const connectedFrags: Array<{ fragmentId: string; angle: number }> = []

    // Get the next fragment in sequence (if any)
    const nextFragment = i < fragments.length - 1 ? fragments[i + 1] : null

    // Check if this fragment's endpoint is at an intersection
    const intersectionAtEnd = intersections.find(
      (intersection) =>
        computePointToPointDistance(fragment.end, intersection.intersectionPoint) <
        EPSILON_INTERSECT
    )

    if (intersectionAtEnd) {
      // We're at an intersection point
      // If the next fragment starts here, this is a break point - DON'T connect them
      const isBreakPoint =
        nextFragment &&
        computePointToPointDistance(nextFragment.start, intersectionAtEnd.intersectionPoint) <
          EPSILON_INTERSECT

      if (!isBreakPoint) {
        // Only connect sequentially if this isn't a break point
        if (
          nextFragment &&
          computePointToPointDistance(fragment.end, nextFragment.start) < EPSILON_INTERSECT
        ) {
          connectedFrags.push({
            fragmentId: nextFragment.id,
            angle: calculateConnectionAngle(fragment, nextFragment)
          })
        }
      }

      // Always look for other fragments starting at this intersection
      // (but not including the next sequential fragment if this is a break point)
      for (const otherFragment of fragments) {
        if (otherFragment === fragment || otherFragment === nextFragment) continue

        if (
          computePointToPointDistance(otherFragment.start, intersectionAtEnd.intersectionPoint) <
          EPSILON_INTERSECT
        ) {
          connectedFrags.push({
            fragmentId: otherFragment.id,
            angle: calculateConnectionAngle(fragment, otherFragment)
          })
        }
      }
    } else {
      // Not at an intersection - simple sequential connection
      if (
        nextFragment &&
        computePointToPointDistance(fragment.end, nextFragment.start) < EPSILON_INTERSECT
      ) {
        connectedFrags.push({
          fragmentId: nextFragment.id,
          angle: calculateConnectionAngle(fragment, nextFragment)
        })
      }
    }

    // Sort connections by angle for consistent traversal
    connectedFrags.sort((a, b) => a.angle - b.angle)
    fragment.connectedFragments = connectedFrags

    console.log(`Fragment ${fragment.id} connected to:`, connectedFrags)
    let connectedIds = connectedFrags.map((frag) => frag.fragmentId)
    debugDict[fragment.id] = connectedIds
  }

  let x = 1
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
