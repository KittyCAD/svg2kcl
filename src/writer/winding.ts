import { KclOperation, KclOperationType } from '../types/kcl'
import { PathCommand } from '../types/path'
import { Transform } from '../utils/transform'
import { WindingRegion } from '../utils/winding'

export function convertNonZeroPathsToKcl(
  regions: WindingRegion[],
  subpaths: { commands: PathCommand[] }[],
  transform: Transform,
  convertCommandsFn: (commands: PathCommand[], transform: Transform) => KclOperation[]
): KclOperation[] {
  const operations: KclOperation[] = []
  const processedPaths = new Set<number>()

  // Sort regions by containment depth first, then by winding number magnitude.
  const sortedRegions = [...regions].sort((a, b) => {
    const depthA = a.containedBy.length
    const depthB = b.containedBy.length
    return depthA !== depthB
      ? depthA - depthB
      : Math.abs(a.windingNumber) - Math.abs(b.windingNumber)
  })

  // Process each region in sorted order.
  for (const region of sortedRegions) {
    if (processedPaths.has(region.pathIndex)) continue

    const kclOps = convertCommandsFn(subpaths[region.pathIndex].commands, transform)
    const isHole = region.containedBy.length % 2 !== 0 // Odd depth means it's a hole.

    if (isHole) {
      operations.push({
        type: KclOperationType.Hole,
        params: { operations: kclOps }
      })
    } else {
      operations.push(...kclOps)
    }

    processedPaths.add(region.pathIndex)
  }

  return operations
}
