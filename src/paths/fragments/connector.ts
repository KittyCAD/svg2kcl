import { EPSILON_INTERSECT } from '../../constants'
import { PathFragment } from '../../paths/fragments/fragment'
import { Vector } from '../../types/base'
import { PathFragmentType } from '../../types/fragments'
import { computePointToPointDistance } from '../../utils/geometry'
import {
  computeTangentToCubicFragment,
  computeTangentToLineFragment,
  computeTangentToQuadraticFragment
} from '../../paths/fragments/fragment'

export function connectFragments(fragments: PathFragment[]): void {
  // Process each fragment in order.
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]
    const connectedFrags: Array<{ fragmentId: string }> = []

    // For each fragment, check all other fragments for possible connections.
    for (const otherFragment of fragments) {
      // Skip self-connection.
      if (otherFragment === fragment) continue

      // Connect if the other fragment's start matches current fragment's end.
      if (computePointToPointDistance(fragment.end, otherFragment.start) < EPSILON_INTERSECT) {
        connectedFrags.push({
          fragmentId: otherFragment.id
        })
      }

      // Connect if the other fragment's end matches current fragment's end.
      if (computePointToPointDistance(fragment.end, otherFragment.end) < EPSILON_INTERSECT) {
        connectedFrags.push({
          fragmentId: otherFragment.id
        })
      }
    }

    fragment.connectedFragments = connectedFrags
  }
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
