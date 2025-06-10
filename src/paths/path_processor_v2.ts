import { EPSILON_INTERSECT } from '../constants'
import { FillRule, Point } from '../types/base'
import { PathElement } from '../types/elements'
import { FragmentMap, PathFragmentType } from '../types/fragments'
import { PathCommand, PathCommandEnriched, PathCommandType, Subpath } from '../types/paths'
import { PathRegion } from '../types/regions'
import {
  computePointToPointDistance,
  findIntersectionsBetweenSubpaths,
  findSelfIntersections,
  getBoundingBoxArea,
  Intersection
} from '../utils/geometry'
import { determineInsideness, isPointInsidePolygon, isPolygonInsidePolygon } from '../utils/polygon'
import { connectFragments } from './fragments/connector'
import { PathFragment, sampleFragment } from './fragments/fragment'
import { buildPlanarGraphFromFragments, buildRegions, getFaces } from './fragments/planar_face'
import { absolutizeSubpath } from './path'
import { getRegionPoints } from './regions'
import { subdivideCommand } from './subdivision'

// First

export class ProcessedPath {
  constructor(private readonly fragmentMap: FragmentMap, public readonly regions: PathRegion[]) {}

  public getFragment(id: string): PathFragment {
    const fragment = this.fragmentMap.get(id)
    if (!fragment) {
      throw new Error(`Fragment ${id} not found.`)
    }
    return fragment
  }
}

export class PathProcessor {
  private readonly inputCommands: PathCommand[]
  private readonly fillRule: FillRule

  constructor(element: PathElement) {
    this.inputCommands = [...element.commands]
    this.fillRule = element.fillRule as FillRule
  }

  public processPath(): ProcessedPath {
    // Analyze path structure and find intersections.
    const { pathCommands, subpaths, intersections } = this.analyzePath()

    // Extract fragments.
    const { fragments, fragmentMap } = this.extractFragments(pathCommands, subpaths, intersections)

    // Now  walk the fragment chain and resample.
    for (const fragment of fragments) {
      fragment.sampledPoints = sampleFragment(fragment)
    }

    // We need to now do planar face discovery.
    const planarGraph = buildPlanarGraphFromFragments(fragments)
    const faceForest = getFaces(planarGraph)

    // Get regions from faces.
    const regions = buildRegions(planarGraph, faceForest, fragments, fragmentMap)

    // Now, for each region, compute the evenodd/nonzero 'insideness'.
    const processedRegions = determineInsideness(regions, fragments, fragmentMap, this.fillRule)

    // Trim out redundant regions.
    const stackedRegions = this.resolveContainmentHierarchy(processedRegions, fragmentMap)
    const finalRegions = this.cleanup(fragments, stackedRegions)

    return new ProcessedPath(fragmentMap, finalRegions)
  }

  // -----------------------------------------------------------------------------------

  private analyzePath(): {
    pathCommands: PathCommandEnriched[]
    subpaths: Subpath[]
    intersections: Intersection[]
  } {
    // Ensure we have explicitly closed subpaths.
    const initialSubpaths = this.splitSubpaths(this.inputCommands)
    const closedSubpaths = initialSubpaths.map((subpath) => this.ensureClosure(subpath))

    // Sample each subpath, keep list of all commands.
    let subpaths: Subpath[] = []
    let pathCommands: PathCommandEnriched[] = []

    // Track each command on the global path command list.
    let globalCommandIndex = 0

    for (const subpath of closedSubpaths) {
      // Walk the subpath to get absolute commands.
      const absoluteCommands = absolutizeSubpath(subpath)

      // Create our subpath object.
      const subpathObject = this.createSubpath(absoluteCommands, globalCommandIndex)
      subpaths.push(subpathObject)

      // Track all commands.
      for (const command of absoluteCommands) {
        pathCommands.push({ ...command })
      }
      globalCommandIndex += absoluteCommands.length
    }

    // Compute intersections.
    const intersections = this.findAllIntersectionsNoSampling(subpaths, pathCommands)

    return {
      pathCommands,
      subpaths,
      intersections: intersections
    }
  }

  private createSubpath(commands: PathCommandEnriched[], iFirstCommand: number): Subpath {
    // This will depend on your Subpath interface
    // You might store just the command indices and start/end points
    return {
      commands,
      iFirstCommand,
      iLastCommand: iFirstCommand + commands.length - 1,
      samplePoints: [] // TODO: Purge.
    }
  }

  private splitSubpaths(commands: PathCommand[]): PathCommand[][] {
    const subpaths: PathCommand[][] = []
    let currentSubpath: PathCommand[] = []

    const moves = [PathCommandType.MoveAbsolute, PathCommandType.MoveRelative]
    const stops = [PathCommandType.StopAbsolute, PathCommandType.StopRelative]

    for (const cmd of commands) {
      // Start new subpath on move (unless it's the first command).
      if (moves.includes(cmd.type) && currentSubpath.length > 0) {
        subpaths.push(currentSubpath)
        currentSubpath = []
      }

      currentSubpath.push(cmd)

      // End subpath on a stop.
      if (stops.includes(cmd.type)) {
        subpaths.push(currentSubpath)
        currentSubpath = []
      }
    }

    // Handle final subpath if not ended with a stop.
    if (currentSubpath.length > 0) {
      subpaths.push(currentSubpath)
    }

    return subpaths
  }

  private ensureClosure(commands: PathCommand[]) {
    // Get our last non-stop command.
    const stops = [PathCommandType.StopAbsolute, PathCommandType.StopRelative]
    let iLastGeomCommand = -1
    for (let i = commands.length - 1; i >= 0; i--) {
      if (!stops.includes(commands[i].type)) {
        iLastGeomCommand = i
        break
      }
    }

    // Check if it meets our first command.
    const firstCommand = commands[0]
    const lastCommand = commands[iLastGeomCommand]

    if (
      computePointToPointDistance(
        lastCommand.endPositionAbsolute,
        firstCommand.endPositionAbsolute // All subpaths start with a move.
      ) <= EPSILON_INTERSECT
    ) {
      // Do nothing.
    } else {
      // Insert a new line command.
      const newCommand = {
        type: PathCommandType.LineAbsolute,
        parameters: [firstCommand.endPositionAbsolute.x, firstCommand.endPositionAbsolute.y],
        startPositionAbsolute: lastCommand.endPositionAbsolute,
        endPositionAbsolute: firstCommand.endPositionAbsolute
      }
      commands.splice(iLastGeomCommand + 1, 0, newCommand)
    }

    return commands
  }

  private extractFragments(
    pathCommands: PathCommandEnriched[],
    subpaths: Subpath[],
    intersections: Intersection[]
  ): { fragments: PathFragment[]; fragmentMap: FragmentMap } {
    const splitPlan = this.buildSplitPlan(pathCommands, intersections)
    const fragments = this.createPathFragments(subpaths, pathCommands, splitPlan)
    connectFragments(fragments)

    const fragmentMap = new Map()
    for (const fragment of fragments) {
      fragmentMap.set(fragment.id, fragment)
    }

    return { fragments, fragmentMap }
  }

  private cleanup(fragments: PathFragment[], regions: PathRegion[]): PathRegion[] {
    const regionsToRemove = new Set<string>()
    const fragmentMap = new Map(fragments.map((f) => [f.id, f]))

    // Build a map of each region's children for fast lookup
    const childrenMap = new Map<string, PathRegion[]>()
    for (const region of regions) {
      if (region.parentRegionId) {
        if (!childrenMap.has(region.parentRegionId)) {
          childrenMap.set(region.parentRegionId, [])
        }
        childrenMap.get(region.parentRegionId)!.push(region)
      }
    }

    // Look for redundant nested regions
    for (const region of regions) {
      if (regionsToRemove.has(region.id)) continue

      const parentRegion = regions.find((r) => r.id === region.parentRegionId)
      if (!parentRegion) continue

      // If parent and child have the same fill status (both holes or both filled regions)
      if (region.isHole === parentRegion.isHole) {
        const regionPoints = getRegionPoints(region, fragmentMap)
        const parentPoints = getRegionPoints(parentRegion, fragmentMap)

        // Check if the child is completely inside the parent
        if (isPolygonInsidePolygon(regionPoints, parentPoints)) {
          // If both are filled regions or both are holes, remove the child (region)
          regionsToRemove.add(region.id)

          // If the child had children, reassign them to the parent
          const children = childrenMap.get(region.id) || []
          for (const child of children) {
            child.parentRegionId = parentRegion.id
          }
        }
      }
    }

    return regions.filter((region) => !regionsToRemove.has(region.id))
  }

  // Some utilities.
  // -----------------------------------------------------------------------------------

  public convertFragmentsToCommands(fragments: PathFragment[]): PathCommand[] {
    const commands: PathCommand[] = []

    if (fragments.length === 0) return commands

    let currentPoint = fragments[0].start
    let startPoint = fragments[0].start

    // Start with a move to the first point.
    commands.push({
      type: PathCommandType.MoveAbsolute,
      parameters: [currentPoint.x, currentPoint.y],
      startPositionAbsolute: currentPoint,
      endPositionAbsolute: currentPoint
    })

    // Convert each fragment to appropriate command type. Note that here we have
    // a subset of commands; we're only dealing with absolute commands, and only
    // lines, quadratic Béziers, and cubic Béziers.
    for (const fragment of fragments) {
      // If our fragment end point is close to the start point, use the start point
      // to avoid floating point errors.
      if (computePointToPointDistance(fragment.end, startPoint) < EPSILON_INTERSECT) {
        fragment.end = startPoint
      }

      switch (fragment.type) {
        case PathFragmentType.Line:
          commands.push({
            type: PathCommandType.LineAbsolute,
            parameters: [fragment.end.x, fragment.end.y],
            startPositionAbsolute: currentPoint,
            endPositionAbsolute: fragment.end
          })
          break

        case PathFragmentType.Quad:
          commands.push({
            type: PathCommandType.QuadraticBezierAbsolute,
            parameters: [
              fragment.control1!.x,
              fragment.control1!.y,
              fragment.end.x,
              fragment.end.y
            ],
            startPositionAbsolute: currentPoint,
            endPositionAbsolute: fragment.end
          })
          break

        case PathFragmentType.Cubic:
          commands.push({
            type: PathCommandType.CubicBezierAbsolute,
            parameters: [
              fragment.control1!.x,
              fragment.control1!.y,
              fragment.control2!.x,
              fragment.control2!.y,
              fragment.end.x,
              fragment.end.y
            ],
            startPositionAbsolute: currentPoint,
            endPositionAbsolute: fragment.end
          })
          break
      }

      currentPoint = fragment.end
    }

    // Close the path.
    commands.push({
      type: PathCommandType.StopAbsolute,
      parameters: [],
      startPositionAbsolute: currentPoint,
      endPositionAbsolute: fragments[0].start
    })

    return commands
  }

  private findCommandIndexForSegment(commands: PathCommandEnriched[], iSegment: number): number {
    // If we have points [p1, p2, p3, p4] that becomes segments
    // [[p1, p2], [p2, p3], [p3, p4]], then the point indices for each
    // segment are [iPoint1, iPoint2] = [iSegment, iSegment+1].

    // Get our point indices.
    const iPoint1 = iSegment
    const iPoint2 = iSegment + 1

    // Validate
    const validPoints = commands.filter((cmd) => cmd.iFirstPoint != null && cmd.iLastPoint != null)
    const iMin = Math.min(
      ...validPoints
        .map((cmd) => cmd.iFirstPoint)
        .filter((point): point is number => point !== null)
    )
    const iMax = Math.max(
      ...validPoints.map((cmd) => cmd.iLastPoint).filter((point): point is number => point !== null)
    )

    if (iPoint1 < iMin || iPoint1 > iMax || iPoint2 < iMin || iPoint2 > iMax) {
      throw new Error(`Index out of range for segement: ${iSegment}`)
    }

    // Iterate over commands, return that which contains both points.

    // Look through commands to find which one contains this point index.
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]
      // Only check commands that have points.
      if (
        command.iFirstPoint !== null &&
        command.iLastPoint !== null &&
        iPoint1 >= command.iFirstPoint &&
        iPoint2 <= command.iLastPoint
      ) {
        return i
      }
    }
    throw new Error(`No command found containing point index ${iSegment}`)
  }

  private convertSegmentTtoCommandT(
    commands: PathCommandEnriched[],
    iSegmentStart: number,
    tLocal: number
  ): number {
    // Converts a localised segment T value to a global (command scope) T value.

    // Find the command that owns this segment.
    const iCommand = this.findCommandIndexForSegment(commands, iSegmentStart)
    const command = commands[iCommand]

    // If it's a line, segment t is already correct.
    const skipCommands = [
      PathCommandType.LineAbsolute,
      PathCommandType.LineRelative,
      PathCommandType.HorizontalLineAbsolute,
      PathCommandType.HorizontalLineRelative,
      PathCommandType.VerticalLineAbsolute,
      PathCommandType.VerticalLineRelative
    ]
    if (skipCommands.includes(command.type)) {
      return tLocal
    }

    // For Bézier curves, we need to map from sample segment space (local) to curve
    // space (global).
    // For example, if we have a sampled cubic Bézier with 5 points, and a point of
    // intersection lying halfway between points 1 and 2:
    //
    // |---|---|---|---|
    // 0   1 X 2   3   4
    //
    // Then we would expect a local t value of 0.5, and an iSegmentStart of 1.
    //
    // We need to map this to the curve's space, so we want to:
    // 1. Work out how long the command is in terms of sampled points.
    // 2. Work out how far along the command our intersection point is.
    //
    // We just need to 'localise' our starting point as our iSegmentStart could be
    // some arbitrary value, not necessarily 0.

    // For Bézier curves we need the indices - verify they exist.
    if (command.iFirstPoint === null || command.iLastPoint === null) {
      throw new Error('Cannot convert t value for command without point indices')
    }

    // Get the length of the command as sampled.
    const lCommand = command.iLastPoint - command.iFirstPoint

    // Then we want to work out how far along the command this point is.
    const lToIntersection = iSegmentStart - command.iFirstPoint + tLocal
    const tGlobal = lToIntersection / lCommand

    return tGlobal
  }

  private findAllIntersectionsNoSampling(
    subpaths: Subpath[],
    pathCommands: PathCommandEnriched[]
  ): Intersection[] {
    return []
  }

  private findAllIntersections(
    subpaths: Subpath[],
    pathCommands: PathCommandEnriched[]
  ): Intersection[] {
    const allIntersections: Intersection[] = []

    // TODO: (Maybe) Make these algebraic and not based on sampled points.
    // Find intersections within each subpath. Intersections should store segment
    // indices that correspond to the full global path sample points, which
    // are also referenced by the `iFirstPoint` and `iLastPoint` values on
    // the full `pathCommands` array.

    let iFirstPoint = 0
    for (const subpath of subpaths) {
      // Get the intersections.
      const internalIntersections = findSelfIntersections(subpath.samplePoints, iFirstPoint)
      allIntersections.push(...internalIntersections)

      // Update offset in global points array.
      iFirstPoint += subpath.samplePoints.length
    }

    // Find intersections between different subpaths.
    for (let i = 0; i < subpaths.length; i++) {
      // 🤮
      // First, get the local (to subpath i) index of the first command that has sample
      // points, then use that to get the index of the first sample point in the
      // global sample points array.
      const iFirstGeomCommandLocalA = subpaths[i].commands.findIndex((x) => x.iFirstPoint !== null)
      const iFirstPointA =
        pathCommands[subpaths[i].iFirstCommand + iFirstGeomCommandLocalA].iFirstPoint

      for (let j = i; j < subpaths.length; j++) {
        if (i == j) {
          continue
        }

        // Similarly, get the local (to subpath k) index of the first command that has sample
        // points, then use that to get the index of the first sample point in the
        // global sample points array.
        const iFirstGeomCommandLocalB = subpaths[j].commands.findIndex(
          (x) => x.iFirstPoint !== null
        )
        const iFirstPointB =
          pathCommands[subpaths[j].iFirstCommand + iFirstGeomCommandLocalB].iFirstPoint

        // Pass those values... they'll be used as offsets for intersection indices,
        // so that the `intersection` object indices are 'global'.
        const intersections = findIntersectionsBetweenSubpaths(
          subpaths[i],
          subpaths[j],
          iFirstPointA!,
          iFirstPointB!
        )
        allIntersections.push(...intersections)
      }
    }

    return allIntersections
  }

  private buildSplitPlan(
    pathCommands: PathCommandEnriched[],
    intersections: Intersection[]
  ): Map<number, number[]> {
    const splitPlan = new Map<number, number[]>()

    // The hard case here is when we have a path composed of two Beziers that
    // 'oscillate' around a straight line. For that case, if the Bezier crosses
    // the line twice, we expect to turn three commands and two intersection points
    // into six fragments.

    // First collect all intersection points for each command.
    for (const intersection of intersections) {
      // Get command indices. Note that the segment is from iPoint to iPoint + 1.
      const iCommandA = this.findCommandIndexForSegment(pathCommands, intersection.iSegmentA)
      const iCommandB = this.findCommandIndexForSegment(pathCommands, intersection.iSegmentB)

      const tA = this.convertSegmentTtoCommandT(
        pathCommands,
        intersection.iSegmentA,
        intersection.tA
      )
      const tB = this.convertSegmentTtoCommandT(
        pathCommands,
        intersection.iSegmentB,
        intersection.tB
      )

      if (tA < 0 || tA > 1 || tB < 0 || tB > 1) {
        throw 'Unexpected t-values found in intersection. This should not happen.'
      }

      if (!splitPlan.has(iCommandA)) splitPlan.set(iCommandA, [])
      if (!splitPlan.has(iCommandB)) splitPlan.set(iCommandB, [])

      splitPlan.get(iCommandA)!.push(tA)
      splitPlan.get(iCommandB)!.push(tB)
    }

    // Sort and deduplicate t-values for each command.
    for (const [cmdIndex, tValues] of splitPlan.entries()) {
      // Sort numerically.
      const uniqueValues = Array.from(new Set(tValues)).sort((a, b) => a - b)

      splitPlan.set(cmdIndex, uniqueValues)
    }

    return splitPlan
  }

  private createPathFragments(
    subpaths: Subpath[],
    pathCommands: PathCommandEnriched[],
    splitPlan: Map<number, number[]>
  ): PathFragment[] {
    const allFragments: PathFragment[] = []

    for (const subpath of subpaths) {
      const subpathFragments = this.createSubpathFragments(subpath, pathCommands, splitPlan)
      allFragments.push(...subpathFragments)
    }

    return allFragments
  }

  private createSubpathFragments(
    subpath: Subpath,
    pathCommands: PathCommandEnriched[],
    splitPlan: Map<number, number[]>
  ): PathFragment[] {
    const fragments: PathFragment[] = []

    // Create fragments for commands
    for (let i = subpath.iFirstCommand; i <= subpath.iLastCommand; i++) {
      const cmd = pathCommands[i]
      const tVals = [...(splitPlan.get(i) || []), 0, 1].sort((a, b) => a - b)

      if (Math.min(...tVals) < 0 || Math.max(...tVals) > 1) {
        throw 'Unexpected t-values found in split plan. This should not happen.'
      }

      for (let j = 0; j < tVals.length - 1; j++) {
        const tMin = tVals[j]
        const tMax = tVals[j + 1]

        if (tMax - tMin < EPSILON_INTERSECT) continue

        const fragment = subdivideCommand(cmd, tMin, tMax)
        if (fragment) fragments.push(fragment)
      }
    }

    // Add closing fragment if needed.
    if (fragments.length > 0) {
      const firstPoint = fragments[0].start
      const lastPoint = fragments[fragments.length - 1].end

      if (computePointToPointDistance(firstPoint, lastPoint) > EPSILON_INTERSECT) {
        console.warn('Unexpected open loop detected in subpath. This should not happen.')
        fragments.push(
          new PathFragment({
            type: PathFragmentType.Line,
            start: lastPoint,
            end: firstPoint,
            iCommand: subpath.iLastCommand
          })
        )
      }
    }

    return fragments
  }

  private resolveContainmentHierarchy(
    regions: PathRegion[],
    fragmentMap: FragmentMap
  ): PathRegion[] {
    if (regions.length <= 1) {
      return regions
    }

    // Create a copy of regions to avoid modifying the original
    const processedRegions = structuredClone(regions)

    // Calculate area for each region based on the bounding box
    const regionsWithArea = processedRegions.map((region) => ({
      region,
      area: getBoundingBoxArea(region.boundingBox)
    }))

    // Sort by area in descending order (largest first)
    regionsWithArea.sort((a, b) => b.area - a.area)

    // Build the containment hierarchy
    for (let i = 0; i < regionsWithArea.length; i++) {
      const current = regionsWithArea[i].region

      // Skip if this is a hole - we'll handle holes in a separate pass
      if (current.isHole) {
        continue
      }

      // Get all regions smaller than the current one
      const smallerRegions = regionsWithArea.slice(i + 1)

      for (const { region: smaller } of smallerRegions) {
        // Skip if already has a parent, if it's a hole, or if it's the same region
        if (smaller.parentRegionId !== undefined || smaller.isHole || smaller.id === current.id) {
          continue
        }

        // Check if the smaller region is contained within the current region
        if (this.isRegionContainedInRegion(smaller, current, fragmentMap)) {
          // Find if there's a more immediate parent
          let mostImmediateParent = current
          let mostImmediateParentArea = regionsWithArea[i].area

          // Check all potential parents between current and smaller
          for (let j = i + 1; j < regionsWithArea.length; j++) {
            const potentialParent = regionsWithArea[j].region

            // Skip holes, regions that already have parents, or the region itself
            if (
              potentialParent.isHole ||
              potentialParent.parentRegionId !== undefined ||
              potentialParent.id === smaller.id
            ) {
              continue
            }

            // If this potential parent contains the smaller region and is itself contained by the current region
            if (
              this.isRegionContainedInRegion(smaller, potentialParent, fragmentMap) &&
              this.isRegionContainedInRegion(potentialParent, current, fragmentMap) &&
              regionsWithArea[j].area < mostImmediateParentArea
            ) {
              mostImmediateParent = potentialParent
              mostImmediateParentArea = regionsWithArea[j].area
            }
          }

          // Double-check we're not setting a region as its own parent
          if (mostImmediateParent.id !== smaller.id) {
            smaller.parentRegionId = mostImmediateParent.id
          }
        }
      }
    }

    // Additional pass to handle holes
    // For each hole, find the smallest non-hole region that contains it
    for (const { region } of regionsWithArea) {
      if (!region.isHole) {
        continue
      }

      let smallestContainingRegion: PathRegion | null = null
      let smallestArea = Infinity

      for (const { region: potentialParent, area } of regionsWithArea) {
        // Skip if potential parent is a hole, is the same region, or is a child of this region
        if (
          potentialParent.isHole ||
          potentialParent.id === region.id ||
          potentialParent.parentRegionId === region.id
        ) {
          continue
        }

        if (
          this.isRegionContainedInRegion(region, potentialParent, fragmentMap) &&
          area < smallestArea
        ) {
          smallestContainingRegion = potentialParent
          smallestArea = area
        }
      }

      if (smallestContainingRegion) {
        region.parentRegionId = smallestContainingRegion.id
      }
    }

    // Final validation pass to ensure no circular references
    this.validateContainmentHierarchy(processedRegions)

    // Build child references
    for (const region of processedRegions) {
      if (region.parentRegionId) {
        const parentIndex = processedRegions.findIndex((r) => r.id === region.parentRegionId)
      }
    }

    return processedRegions
  }

  private validateContainmentHierarchy(regions: PathRegion[]): void {
    const regionMap = new Map<string, PathRegion>()

    // Build a map for easy lookup
    regions.forEach((region) => {
      regionMap.set(region.id, region)
    })

    // Check for self-references and fix them
    for (const region of regions) {
      if (region.parentRegionId === region.id) {
        console.warn(`Region ${region.id} references itself as parent. Fixing.`)
        region.parentRegionId = undefined
      }
    }

    // Check for circular dependencies
    for (const region of regions) {
      if (region.parentRegionId) {
        this.detectCircularReference(region, regionMap, new Set<string>())
      }
    }
  }

  private detectCircularReference(
    region: PathRegion,
    regionMap: Map<string, PathRegion>,
    visitedInPath: Set<string>
  ): boolean {
    // If we've seen this region in the current path, we have a cycle
    if (visitedInPath.has(region.id)) {
      console.warn(`Circular reference detected involving region ${region.id}. Breaking cycle.`)
      region.parentRegionId = undefined
      return true
    }

    // Add this region to the current path
    visitedInPath.add(region.id)

    // If no parent, no cycle possible through this path
    if (!region.parentRegionId) {
      return false
    }

    // Get the parent and continue checking
    const parent = regionMap.get(region.parentRegionId)
    if (!parent) {
      // Parent reference is invalid
      console.warn(
        `Region ${region.id} references non-existent parent ${region.parentRegionId}. Fixing.`
      )
      region.parentRegionId = undefined
      return false
    }

    // Recursively check the parent
    const hasCycle = this.detectCircularReference(parent, regionMap, visitedInPath)

    // If a cycle was detected and fixed higher up, we don't need to do anything else
    return hasCycle
  }

  private isRegionContainedInRegion(
    regionA: PathRegion,
    regionB: PathRegion,
    fragments?: FragmentMap
  ): boolean {
    // Fast rejection: check if A's bounding box is completely inside B's bounding box
    if (
      regionA.boundingBox.xMin < regionB.boundingBox.xMin ||
      regionA.boundingBox.xMax > regionB.boundingBox.xMax ||
      regionA.boundingBox.yMin < regionB.boundingBox.yMin ||
      regionA.boundingBox.yMax > regionB.boundingBox.yMax
    ) {
      return false
    }

    // If we have fragments, we can do an exact polygon check
    if (fragments) {
      // First, collect all points from regionB's fragments to form its polygon
      const polygonB: Point[] = []

      for (let i = 0; i < regionB.fragmentIds.length; i++) {
        const fragmentId = regionB.fragmentIds[i]
        const fragment = fragments.get(fragmentId)

        if (!fragment || !fragment.sampledPoints) {
          console.warn(`Missing or incomplete fragment: ${fragmentId}`)
          continue
        }

        // Get points in the right order based on whether the fragment is reversed
        const points = regionB.fragmentReversed[i]
          ? [...fragment.sampledPoints].reverse()
          : fragment.sampledPoints

        // Add points to the polygon
        for (const point of points) {
          // Avoid duplicate consecutive points
          if (
            polygonB.length === 0 ||
            polygonB[polygonB.length - 1].x !== point.x ||
            polygonB[polygonB.length - 1].y !== point.y
          ) {
            polygonB.push(point)
          }
        }
      }

      // Check if regionA's test point is inside polygonB
      // We have a utility function for this already
      if (polygonB.length >= 3) {
        // Need at least 3 points for a polygon
        return isPointInsidePolygon(regionA.testPoint, polygonB)
      }
    }

    // If we don't have fragments or couldn't form a valid polygon,
    // use a simpler check with just the test point and bounding box
    return true // Assume contained if we've passed the bounding box check
  }
}
