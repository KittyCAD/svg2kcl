// So I think the broad process here will involve three passes:
//
// First Pass - Path Analysis:
// - Walk path collecting all points/commands using buildPath().
// - Find all self-intersections using findSelfIntersections().
// - Create list of path segments/fragments between intersections.
//   - These mean path fragments are aware of which other fragments they connect to,
//     and by walking these fragments, we can identify closed regions.
// - Create region graph where each closed region has:
//   - Boundary points.
//   - Contributing path segments with references to original commands.
//   - References to neighbouring regions (optional, but would make subsequent steps
//     for hole identification more efficient).
//   - Initial fill status (unset).
//
// Second Pass - Winding Calculation:
// - For each region:
//   - Pick a test point inside the region (e.g., centroid).
//   - Cast ray to right from test point.
//   - Walk original path in order, counting signed crossings:
//     - +1 for upward crossing with point on left.
//     - -1 for downward crossing with point on right.
//   - Store winding number for region.
//   - Set fill status based on winding number (!= 0 means fill, hence 'nonzero').
//
// Third Pass - Region Relationship Analysis:
// Because our kcl `hole` command is a hole in _something_, we need to know about
// parent-child relationships between regions. So:
// - For each unfilled region (wn = 0):
//   - Find all neighboring filled regions.
//   - Determine which filled region this is a hole in.
//   - Store parent-child relationship between regions.
//
// Fourth Pass - Region Processing:
// - Process regions in correct order:
//   - Start with outermost filled regions.
//   - For each filled region:
//     - Generate its sketch commands.
//     - Generate hole commands for all holes belonging to this region.
//     - Ensure each hole command references its parent sketch.
//   - Move to next filled region.
//
// Finally:
// - Return processed commands where:
//   - Each hole is properly associated with its parent shape
//   - Holes are cut from the correct shapes
//   - Order guarantees parent shapes exist before their holes
//

import { v4 as uuidv4 } from 'uuid'
import { FillRule, Point } from '../types/base'
import { PathElement } from '../types/elements'
import { PathCommand, PathCommandType } from '../types/path'
import { BezierUtils } from '../utils/bezier'
import {
  EnrichedCommand,
  EPSILON_INTERSECT,
  findSelfIntersections,
  findIntersectionsBetweenSubpaths,
  Subpath,
  interpolateLine,
  Intersection,
  computePointToPointDistance
} from '../utils/geometry'
import { WindingAnalyzer } from '../utils/winding'

// let DELETE_ME_COUNTER = 0

export interface PathRegion {
  id: string
  fragmentIds: string[] // List of IDs of path fragments forming the region.
  boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number } // Region bounding box.
  testPoint: Point // A point inside the region for winding calculation.
  isHole: boolean // True if this is a hole.
  windingNumber: number // Computed winding number.
  parentRegionId?: string // ID of the parent region (if it's a hole).
  neighborRegionIds?: Set<string> // IDs of neighboring regions.
}

export class PathFragment {
  // An internal, intermediate representation of a path 'fragment'. We may produce
  // a bunch of these when splitting paths, but we need more context than would be
  // provided by the sort of new PathCommand object we produce when re-emitting
  // quasi-SVG.

  // SVG paths are lines, Béziers or arcs. We don't support arcs, and we can simplify
  // things by only considering absolute coordinates and mopping up smoothed
  // (i.e. reflected control point) curves at the layer above this. So.. simple type.
  id: string

  type: 'line' | 'quad' | 'cubic'

  // The main points for this geometry:
  start: Point
  end: Point

  // Optionally store additional data for Bézier curves.
  control1?: Point
  control2?: Point

  // Store a link to the original command index in our input path list.
  iCommand: number

  // Store a list of fragments that are connected to this one.
  connectedFragments?: {
    fragmentId: string
    angle: number // ? For direction, maybe.
  }[]

  constructor(params: {
    type: 'line' | 'quad' | 'cubic'
    start: Point
    end: Point
    commandIndex: number
    control1?: Point
    control2?: Point
    connectedFragments?: { fragmentId: string; angle: number }[]
  }) {
    this.id = this.getNextFragmentId()
    this.type = params.type
    this.start = params.start
    this.end = params.end
    this.iCommand = params.commandIndex
    this.control1 = params.control1
    this.control2 = params.control2
    this.connectedFragments = params.connectedFragments
  }

  private getNextFragmentId(): string {
    return uuidv4()
    // return `frag-${DELETE_ME_COUNTER++}`
  }
}

interface PathSampleResult {
  // Represents a sampled path for self-intersection detection.
  pathSamplePoints: Point[] // Sampled points for the full path.
  pathCommands: EnrichedCommand[] // Set of enriched commands for the full path
}

export class PathProcessor {
  // Input and output buffer.
  private inputCommands: PathCommand[]
  private outputCommands: PathCommand[] = []

  // Other props of use.
  private fillRule: FillRule

  // Some state tracking. We need previous control point to handle smoothed Beziers.
  private previousControlPoint: Point | null = null
  private currentPoint: Point = { x: 0, y: 0 }

  // Sampled points and the enriched command set for the path.
  private fullPathSamplePoints: Point[] = []
  private fullPathCommandSet: EnrichedCommand[] = []

  // Split plan. This is a map of command indices to arrays of t-values where the
  // command should be split.
  private splitPlan: Map<number, number[]> = new Map()

  // Self-intersection data.
  private intersections: Intersection[] = []

  // Post-splitting fragments.
  private fragments: PathFragment[] = []
  private fragmentMap: Map<string, PathFragment> = new Map()
  private regions: PathRegion[] = []

  constructor(element: PathElement) {
    // Pull commands and fill rule.
    this.inputCommands = [...element.commands]
    this.fillRule = element.fillRule as FillRule
  }

  private getPreviousControlPoint(): Point {
    if (this.previousControlPoint === null) {
      return this.currentPoint
    }

    return this.previousControlPoint
  }

  private setPreviousControlPoint(point: Point): void {
    this.previousControlPoint = {
      x: point.x,
      y: point.y
    }
  }

  public process(): { regions: PathRegion[]; commands: PathCommand[] } {
    if (this.fillRule === FillRule.EvenOdd) {
      return { regions: [], commands: this.inputCommands }
    }

    this.analyzePath()

    // Get regions in a structured order (parents first, then holes)
    const orderedRegions = this.getOrderedRegions()

    const commands: PathCommand[] = []
    for (const region of orderedRegions) {
      const regionFragments = region.fragmentIds.map((id) => this.fragmentMap.get(id)!)
      const regionCommands = this.convertFragmentsToCommands(regionFragments)
      commands.push(...regionCommands)
    }

    return { regions: orderedRegions, commands }
  }

  // Centralized logic to order regions correctly
  private getOrderedRegions(): PathRegion[] {
    const parentMap = new Map<string, PathRegion[]>()

    for (const region of this.regions) {
      if (region.parentRegionId) {
        if (!parentMap.has(region.parentRegionId)) {
          parentMap.set(region.parentRegionId, [])
        }
        parentMap.get(region.parentRegionId)!.push(region)
      } else {
        parentMap.set(region.id, [region]) // Ensure all parents exist
      }
    }

    // Flatten parent-first ordering
    const orderedRegions: PathRegion[] = []
    for (const [parentId, group] of parentMap.entries()) {
      orderedRegions.push(...group)
    }

    return orderedRegions
  }

  private convertFragmentsToCommands(fragments: PathFragment[]): PathCommand[] {
    const commands: PathCommand[] = []

    if (fragments.length === 0) return commands

    let currentPoint = fragments[0].start

    // Start with a move to the first point
    commands.push({
      type: PathCommandType.MoveAbsolute,
      parameters: [currentPoint.x, currentPoint.y],
      startPositionAbsolute: currentPoint,
      endPositionAbsolute: currentPoint
    })

    // Convert each fragment to appropriate command type
    for (const fragment of fragments) {
      switch (fragment.type) {
        case 'line':
          commands.push({
            type: PathCommandType.LineAbsolute,
            parameters: [fragment.end.x, fragment.end.y],
            startPositionAbsolute: currentPoint,
            endPositionAbsolute: fragment.end
          })
          break

        case 'quad':
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

        case 'cubic':
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

    // Close the path
    commands.push({
      type: PathCommandType.StopAbsolute,
      parameters: [],
      startPositionAbsolute: currentPoint,
      endPositionAbsolute: fragments[0].start
    })

    return commands
  }

  public getFragment(id: string): PathFragment {
    const fragment = this.fragmentMap.get(id)
    if (!fragment) {
      throw new Error(`Fragment ${id} not found`)
    }
    return fragment
  }

  public getCommandsForFragments(fragments: PathFragment[]): PathCommand[] {
    return this.convertFragmentsToCommands(fragments)
  }

  // Make regions accessible
  public getRegions(): PathRegion[] {
    return this.regions
  }

  // Build the whole thing for self-intersection detection.
  // -----------------------------------------------------------------------------------
  private buildPath(): PathSampleResult {
    const points: Point[] = []
    const commands: EnrichedCommand[] = []
    let currentPoint = { x: 0, y: 0 }

    // Loop over each of our original input commands.
    for (let i = 0; i < this.inputCommands.length; i++) {
      const command = this.inputCommands[i]

      // Get the (global point set) index of this command's first point.
      const iFirstPoint = points.length

      switch (command.type) {
        case PathCommandType.MoveAbsolute:
        case PathCommandType.MoveRelative: {
          points.push(command.endPositionAbsolute)
          currentPoint = command.endPositionAbsolute
          break
        }

        case PathCommandType.LineAbsolute:
        case PathCommandType.LineRelative:
        case PathCommandType.HorizontalLineAbsolute:
        case PathCommandType.HorizontalLineRelative:
        case PathCommandType.VerticalLineAbsolute:
        case PathCommandType.VerticalLineRelative: {
          points.push(currentPoint, command.endPositionAbsolute)
          currentPoint = command.endPositionAbsolute
          break
        }

        case PathCommandType.QuadraticBezierAbsolute:
        case PathCommandType.QuadraticBezierRelative: {
          // Get absolute control point.
          let [x1, y1] = command.parameters
          if (command.type === PathCommandType.QuadraticBezierRelative) {
            x1 += currentPoint.x
            y1 += currentPoint.y
          }

          // Sample the curve.
          const sampledPoints = BezierUtils.sampleQuadraticBezier(
            currentPoint,
            { x: x1, y: y1 },
            command.endPositionAbsolute
          )
          points.push(...sampledPoints)
          currentPoint = command.endPositionAbsolute
          break
        }
      }

      // Get the (global point set) index of this command's last point.
      const iLastPoint = points.length - 1

      // Append to our enriched commands.
      commands.push({
        ...command,
        iFirstPoint,
        iLastPoint,
        iCommand: i
      })
    }

    return { pathSamplePoints: points, pathCommands: commands }
  }

  // The harder bits.
  // -----------------------------------------------------------------------------------
  private processQuadraticBezierCommand(command: PathCommand, iCommand: number): void {
    const splitRequired = this.splitPlan.has(iCommand)
    const splitData = this.splitPlan.get(iCommand) || []

    // Get absolute control point
    let [x1, y1, x, y] = command.parameters

    if (command.type === PathCommandType.QuadraticBezierRelative) {
      x1 += this.currentPoint.x
      y1 += this.currentPoint.y
    }

    // Get our points.
    const p0 = this.currentPoint
    const p1 = { x: x1, y: y1 }
    const p2 = command.endPositionAbsolute

    if (!splitRequired) {
      // No splits, just push the original command.
      this.outputCommands.push(command)
    } else {
      // Sort the split points just in case they are out of order.
      splitData.sort((a, b) => a - b)

      let startPoint = { x: p0.x, y: p0.y }
      let controlPoint = { x: p1.x, y: p1.y }
      let endPoint = { x: p2.x, y: p2.y }

      for (const t of splitData) {
        const splitResult = BezierUtils.splitQuadraticBezier(
          { start: startPoint, control: controlPoint, end: endPoint },
          t
        )

        // Push first half.
        // Parameters are control point and end point.
        const parameters = [
          splitResult.first[1].x,
          splitResult.first[1].y,
          splitResult.first[2].x,
          splitResult.first[2].y
        ]
        this.outputCommands.push({
          type: PathCommandType.QuadraticBezierAbsolute,
          parameters: parameters,
          startPositionAbsolute: splitResult.first[0], // Start point.
          endPositionAbsolute: splitResult.first[2] // End point.
        })

        // Update start point for the next segment.
        startPoint = splitResult.second[0]
        controlPoint = splitResult.second[1]
      }

      // Push last segment.
      this.outputCommands.push({
        type: PathCommandType.QuadraticBezierAbsolute,
        parameters: [controlPoint.x, controlPoint.y, endPoint.x, endPoint.y],
        startPositionAbsolute: startPoint, // We updated this in the loop.
        endPositionAbsolute: endPoint
      })
    }

    // Update state.
    this.currentPoint = p2
    this.setPreviousControlPoint(p1)
  }

  // Some utilities.
  // -----------------------------------------------------------------------------------
  private getReflectedControlPoint(): Point {
    const prevControl = this.getPreviousControlPoint()
    const current = this.currentPoint

    return {
      x: current.x + (current.x - prevControl.x),
      y: current.y + (current.y - prevControl.y)
    }
  }

  private findCommandIndexForPoint(commands: EnrichedCommand[], iPoint: number): number {
    // Look through commands to find which one contains this point index.
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]
      if (iPoint >= command.iFirstPoint && iPoint <= command.iLastPoint) {
        return i
      }
    }
    throw new Error(`No command found containing point index ${iPoint}`)
  }

  private convertSegmentTtoCommandT(
    commands: EnrichedCommand[],
    iSegmentStart: number,
    tLocal: number
  ): number {
    // Converts a localised segment T value to a global (command scope) T value.

    // Find the command that owns this segment.
    const iCommand = this.findCommandIndexForPoint(commands, iSegmentStart)
    const command = commands[iCommand]

    // If it's a line, segment t is already correct.
    if (command.type.includes('Line') || command.type.includes('Move')) {
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

    // Get the length of the command as sampled.
    const lCommand = command.iLastPoint - command.iFirstPoint

    // Then we want to work out how far along the command this point is.
    const lToIntersection = iSegmentStart - command.iFirstPoint + tLocal
    const tGlobal = lToIntersection / lCommand

    return tGlobal
  }

  private identifySubpaths(commands: EnrichedCommand[], samplePoints: Point[]): Subpath[] {
    const subpaths: Subpath[] = []
    let currentStart = 0
    let currentSampleStart = 0

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]

      // Check for move commands that start new subpaths
      if (
        i > 0 &&
        (command.type === PathCommandType.MoveAbsolute ||
          command.type === PathCommandType.MoveRelative)
      ) {
        // End previous subpath
        subpaths.push({
          startIndex: currentStart,
          endIndex: i - 1,
          commands: commands.slice(currentStart, i),
          samplePoints: samplePoints.slice(currentSampleStart, command.iFirstPoint)
        })

        currentStart = i
        currentSampleStart = command.iFirstPoint
      }
    }

    // Add final subpath
    if (currentStart < commands.length) {
      subpaths.push({
        startIndex: currentStart,
        endIndex: commands.length - 1,
        commands: commands.slice(currentStart),
        samplePoints: samplePoints.slice(currentSampleStart)
      })
    }

    return subpaths
  }

  private findAllIntersections(subpaths: Subpath[]): Intersection[] {
    const allIntersections: Intersection[] = []

    // Find intersections within each subpath
    for (const subpath of subpaths) {
      const internalIntersections = findSelfIntersections(subpath.samplePoints)
      allIntersections.push(...internalIntersections)
    }

    // Find intersections between different subpaths
    for (let i = 0; i < subpaths.length; i++) {
      for (let j = i + 1; j < subpaths.length; j++) {
        const intersections = findIntersectionsBetweenSubpaths(subpaths[i], subpaths[j])
        allIntersections.push(...intersections)
      }
    }

    return allIntersections
  }

  private createFragmentsForSubpath(
    commands: EnrichedCommand[],
    splitPlan: Map<number, number[]>
  ): PathFragment[] {
    const fragments: PathFragment[] = []

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]
      const tVals = [...(splitPlan.get(cmd.iCommand) || []), 0, 1].sort((a, b) => a - b)

      for (let j = 0; j < tVals.length - 1; j++) {
        const tMin = tVals[j]
        const tMax = tVals[j + 1]

        if (tMax - tMin < EPSILON_INTERSECT) continue

        const fragment = this.subdivideCommand(cmd, tMin, tMax)
        if (fragment) fragments.push(fragment)
      }
    }

    return fragments
  }

  private ensureSubpathClosure(fragments: PathFragment[]): PathFragment[] {
    if (fragments.length < 1) return fragments

    const firstPoint = fragments[0].start
    const lastPoint = fragments[fragments.length - 1].end
    const dMag = computePointToPointDistance(firstPoint, lastPoint)

    if (dMag > EPSILON_INTERSECT) {
      // Add closing fragment
      const closingFragment = new PathFragment({
        type: 'line',
        start: lastPoint,
        end: firstPoint,
        commandIndex: fragments[fragments.length - 1].iCommand
      })

      return [...fragments, closingFragment]
    }

    return fragments
  }

  // First pass.
  // -----------------------------------------------------------------------------------
  public analyzePath(): void {
    // Build sampled path we'll use for self-intersection detection.
    const { pathSamplePoints: pathSamplePoints, pathCommands: pathCommands } = this.buildPath()

    this.fullPathCommandSet = pathCommands
    this.fullPathSamplePoints = pathSamplePoints

    // Immediately identify subpaths
    const subpaths = this.identifySubpaths(pathCommands, pathSamplePoints)

    // Get the intersections. Note that segment index values here refer to the sampled
    // path, not the original commands.
    this.intersections = this.findAllIntersections(subpaths)

    // Start building the split plan. This is a map of command indices to arrays of
    // t-values where the command should be split.
    let splitPlan = new Map<number, number[]>()

    for (const intersection of this.intersections) {
      // Each intersection has two colliding segments: A and B. Pull the sampled path
      // segment indices for these intersecting segments
      const iSegmentA = intersection.iSegmentA
      const iSegmentB = intersection.iSegmentB

      // Find the index of the original commands that 'own' segmentA and segmentB.
      const iCommandA = this.findCommandIndexForPoint(pathCommands, iSegmentA)
      const iCommandB = this.findCommandIndexForPoint(pathCommands, iSegmentB)

      // Convert segment-relative t-values into original command t-values.
      const tA = this.convertSegmentTtoCommandT(pathCommands, iSegmentA, intersection.tA)
      const tB = this.convertSegmentTtoCommandT(pathCommands, iSegmentB, intersection.tB)

      // Store in splitPlan. Each command index gets a list of T-values to split at.
      if (!splitPlan.has(iCommandA)) {
        splitPlan.set(iCommandA, [])
      }
      splitPlan.get(iCommandA)!.push(tA)

      if (!splitPlan.has(iCommandB)) {
        splitPlan.set(iCommandB, [])
      }
      splitPlan.get(iCommandB)!.push(tB)
    }

    // After collecting all splits, sort each command's t-values.
    for (const tValues of splitPlan.values()) {
      tValues.sort((a, b) => a - b)
    }

    // Set the split plan.
    this.splitPlan = splitPlan

    // ---------------------------------------------------------------------------------

    // Process each subpath independently. We need to:
    // 1. Create fragments for each command in the subpath
    // 2. Ensure each subpath is properly closed
    // 3. Collect all fragments for later processing
    let allFragments: PathFragment[] = []

    for (const subpath of subpaths) {
      let subpathFragments: PathFragment[] = []

      // Create fragments for each command in this subpath
      for (let i = subpath.startIndex; i <= subpath.endIndex; i++) {
        const cmd = pathCommands[i]

        // Pull out the t-values for this command, plus ensure 0 & 1 are included.
        // This is so our later subdivide calls can see the whole thing.
        const tVals = [...(splitPlan.get(i) || []), 0, 1]

        // Sort.
        tVals.sort((a, b) => a - b)

        // For each adjacent pair of t-values, produce one fragment.
        for (let j = 0; j < tVals.length - 1; j++) {
          const tMin = tVals[j]
          const tMax = tVals[j + 1]
          if (tMax - tMin < EPSILON_INTERSECT) {
            // Skip trivial zero-length splits from repeated t-values. Should hopefully
            // not see any of this since the intersection finder should have removed them.
            continue
          }

          // Subdivide this command from [tMin..tMax] into a PathFragment.
          const fragment = this.subdivideCommand(cmd, tMin, tMax)
          if (fragment) {
            subpathFragments.push(fragment)
          }
        }
      }

      // We need to account for an implicit close; SVG renderers do this for fills.
      // https://www.w3.org/TR/SVG/painting.html#FillProperties
      // The fill operation fills open subpaths by performing the fill operation as if an
      // additional "closepath" command were added to the path to connect the last point
      // of the subpath with the first point of the subpath. Thus, fill operations apply
      // to both open subpaths within 'path' elements
      // (i.e., subpaths without a closepath command) and 'polyline' elements.

      // Ensure this subpath is closed by checking its endpoints
      if (subpathFragments.length > 0) {
        const firstPoint = subpathFragments[0].start
        const lastPoint = subpathFragments[subpathFragments.length - 1].end
        const dMag = computePointToPointDistance(firstPoint, lastPoint)

        if (dMag > EPSILON_INTERSECT) {
          // Path is not closed; add a final fragment to close it.
          const closingFragment = new PathFragment({
            type: 'line',
            start: lastPoint,
            end: firstPoint,
            commandIndex: subpath.endIndex
          })

          subpathFragments.push(closingFragment)
        }
      }

      // Add this subpath's fragments to our collection
      allFragments.push(...subpathFragments)
    }

    // ---------------------------------------------------------------------------------

    // We now want to walk the fragment list and build a set that tells us which
    // fragments are connected to which other fragments. This will allow us to build
    // closed regions later on.
    this.connectFragments(allFragments)

    // Build the fragment map.
    this.fragments = allFragments

    for (const fragment of allFragments) {
      this.fragmentMap.set(fragment.id, fragment)
    }

    // Find closed regions. Note that the outer boundary of the shape may be included
    // even if its subregions are also included. This _should_ be captured by
    // winding number analysis later on.
    this.regions = this.identifyClosedRegions(allFragments)

    // Winding?
    const analyzer = new WindingAnalyzer(allFragments)
    analyzer.computeWindingNumbers(this.regions)

    // Detect holes.
    analyzer.assignParentRegions(this.regions)

    // Done?
    let x = 1
  }

  public identifyClosedRegions(fragments: PathFragment[]): PathRegion[] {
    const detectedRegions: PathRegion[] = []
    const processedLoops = new Set<string>()

    for (const startFragment of fragments) {
      const startConnections = startFragment.connectedFragments || []

      for (const startConnection of startConnections) {
        // Start the path with just our first fragment, and follow the specific connection
        const loop = this.dfsFindLoop(startConnection.fragmentId, startFragment.start, [
          startFragment.id
        ])

        if (loop) {
          const loopKey = [...loop].sort().join(',')
          if (!processedLoops.has(loopKey)) {
            detectedRegions.push({
              id: uuidv4(),
              fragmentIds: loop,
              boundingBox: this.calculateBoundingBox(loop),
              testPoint: this.calculateTestPoint(loop),
              isHole: false,
              windingNumber: 0
            })
            processedLoops.add(loopKey)
          }
        }
      }
    }

    // Special case for scenario where a polygon doesn't self intersect, but does include
    // a coincident meeting point... e.g.
    // M 150,5 l 100,10 -50,50 -30,-30 0,60 30,-30 50,50 -100,10 z
    //
    // With either fill rule pattern, this is the same—we have a path which describes
    // this kind of shape:
    // |-----
    // |    /
    // | |\/ <---- Common vertex just down here.
    // | |/\
    // |    \
    // |-----
    // However, each of the line fragments are independent; there are no intersections,
    // just a single common vertex for the inner and outer shapes. So when we detect
    // the inner region, it is a subset of the outer region—and we can remove it.

    // Special case: Remove subregions fully contained in a larger region.
    const fragIds = detectedRegions.map((r) => r.fragmentIds)
    const iRemove = new Set<number>() // Use a Set to avoid duplicate removals.

    for (let i = 0; i < fragIds.length; i++) {
      for (let j = 0; j < fragIds.length; j++) {
        if (i === j) continue

        let currentSet = fragIds[i]
        let compareSet = fragIds[j]

        // Check if compareSet is a subset of currentSet.
        if (compareSet.every((value) => currentSet.includes(value))) {
          iRemove.add(j)
        }
      }
    }

    // Remove detected subset regions before proceeding.
    const filteredRegions = detectedRegions.filter((_, index) => !iRemove.has(index))

    // Build fragment to region map.
    const fragmentToRegions = new Map<string, string[]>()

    for (const region of filteredRegions) {
      for (const fragmentId of region.fragmentIds) {
        if (!fragmentToRegions.has(fragmentId)) {
          fragmentToRegions.set(fragmentId, [])
        }
        fragmentToRegions.get(fragmentId)?.push(region.id)
      }
    }

    // Now we need to find the neighbors of each region.
    for (const region of filteredRegions) {
      for (const fragmentId of region.fragmentIds) {
        const neighborRegions = fragmentToRegions.get(fragmentId) || []
        for (const neighborId of neighborRegions) {
          if (neighborId !== region.id) {
            if (!region.neighborRegionIds) {
              region.neighborRegionIds = new Set()
            }
            region.neighborRegionIds.add(neighborId)
          }
        }
      }
    }

    return filteredRegions
  }

  private dfsFindLoop(currentId: string, startPoint: Point, path: string[]): string[] | null {
    const fragment = this.fragmentMap.get(currentId)
    if (!fragment) return null

    // Check if we've made it back to start
    if (computePointToPointDistance(fragment.end, startPoint) < EPSILON_INTERSECT) {
      return [...path, currentId]
    }

    // Continue exploring only if we haven't visited this fragment
    if (path.includes(currentId)) return null

    // Add current fragment to path
    path = [...path, currentId]

    // Try each connection
    for (const connection of fragment.connectedFragments || []) {
      const result = this.dfsFindLoop(connection.fragmentId, startPoint, path)
      if (result) {
        return result
      }
    }

    return null
  }

  private areFragmentsConnected(f1: PathFragment, f2: PathFragment): boolean {
    // Check end-to-start connection.
    const endToStart = computePointToPointDistance(f1.end, f2.start) < EPSILON_INTERSECT

    // Check start-to-end connection
    const startToEnd = computePointToPointDistance(f1.start, f2.end) < EPSILON_INTERSECT

    return endToStart || startToEnd
  }

  private calculateBoundingBox(fragmentIds: string[]): {
    xMin: number
    yMin: number
    xMax: number
    yMax: number
  } {
    let xMin = Infinity,
      yMin = Infinity,
      xMax = -Infinity,
      yMax = -Infinity

    for (const id of fragmentIds) {
      const fragment = this.fragmentMap.get(id)
      if (!fragment) continue

      xMin = Math.min(xMin, fragment.start.x, fragment.end.x)
      yMin = Math.min(yMin, fragment.start.y, fragment.end.y)
      xMax = Math.max(xMax, fragment.start.x, fragment.end.x)
      yMax = Math.max(yMax, fragment.start.y, fragment.end.y)
    }

    return { xMin: xMin, yMin: yMin, xMax: xMax, yMax: yMax }
  }

  private calculateTestPoint(fragmentIds: string[]): Point {
    // Use centroid of bounding box as a simple approximation.
    const bbox = this.calculateBoundingBox(fragmentIds)
    return {
      x: (bbox.xMin + bbox.xMax) / 2,
      y: (bbox.yMin + bbox.yMax) / 2
    }
  }

  private calculateConnectionAngle(from: PathFragment, to: PathFragment): number {
    // We need to compute the angle between the two fragments, i.e.
    // the angle between a line tangent to the end of 'from' and a line tangent to the
    // start of 'to'. We could use our sampled points or do this by actually
    // computing the tangent.
    // Actual tangent of a Bezier:
    // https://stackoverflow.com/questions/4089443/find-the-tangent-of-a-point-on-a-cubic-bezier-curve

    // Get tangents.
    const tangentFrom = this.getFragmentTangent(from, 1)
    const tangentTo = this.getFragmentTangent(to, 0)

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

  private getFragmentTangent(fragment: PathFragment, t: number): Point {
    if (fragment.type === 'line') {
      // Line tangent is just the difference vector.
      return {
        x: fragment.end.x - fragment.start.x,
        y: fragment.end.y - fragment.start.y
      }
    } else if (fragment.type === 'quad') {
      // Quadratic Bézier derivative.
      // https://en.wikipedia.org/wiki/B%C3%A9zier_curve
      const { start, control1, end } = fragment
      return {
        x: 2 * (1 - t) * (control1!.x - start.x) + 2 * t * (end.x - control1!.x),
        y: 2 * (1 - t) * (control1!.y - start.y) + 2 * t * (end.y - control1!.y)
      }
    } else if (fragment.type === 'cubic') {
      // Cubic Bézier derivative.
      // https://stackoverflow.com/questions/4089443/find-the-tangent-of-a-point-on-a-cubic-bezier-curve
      // https://en.wikipedia.org/wiki/B%C3%A9zier_curve
      const { start, control1, control2, end } = fragment
      return {
        x:
          3 * (1 - t) ** 2 * (control1!.x - start.x) +
          6 * (1 - t) * t * (control2!.x - control1!.x) +
          3 * t ** 2 * (end.x - control2!.x),
        y:
          3 * (1 - t) ** 2 * (control1!.y - start.y) +
          6 * (1 - t) * t * (control2!.y - control1!.y) +
          3 * t ** 2 * (end.y - control2!.y)
      }
    }

    throw new Error(`Unsupported fragment type: ${fragment.type}`)
  }

  private connectFragments(fragments: PathFragment[]): void {
    // The scenarios under which we would 'connect' fragments are:
    // - A given fragment's endpoint is coincident with the 'next' ordered fragment's
    //   start point, but that coincident point is not an intersection.
    // - A given fragment's endpoint is coincident with an intersection point, and there
    //   exists a fragment starting at that intersection point. This implies that
    //   this fragment was 'created' by a split operation.
    //
    // If we were to connect sequential fragments where start/end points are coincident
    // with an intersection point, we would be double-counting some geometry.

    // Process each fragment in order
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i]
      const connectedFrags: Array<{ fragmentId: string; angle: number }> = []

      // Get the next fragment in sequence (if any)
      const nextFragment = i < fragments.length - 1 ? fragments[i + 1] : null

      // Check if this fragment's endpoint is at an intersection
      const intersectionAtEnd = this.intersections.find(
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
              angle: this.calculateConnectionAngle(fragment, nextFragment)
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
              angle: this.calculateConnectionAngle(fragment, otherFragment)
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
            angle: this.calculateConnectionAngle(fragment, nextFragment)
          })
        }
      }

      // Sort connections by angle for consistent traversal
      connectedFrags.sort((a, b) => a.angle - b.angle)
      fragment.connectedFragments = connectedFrags
    }
  }

  private subdivideCommand(
    command: EnrichedCommand,
    tMin: number,
    tMax: number
  ): PathFragment | null {
    // We only handle lines, quadratics, and cubics here.
    // If other commands (Move, Arc, etc.) appear, return null or handle them as needed.
    switch (command.type) {
      case PathCommandType.LineAbsolute:
      case PathCommandType.LineRelative:
      case PathCommandType.HorizontalLineAbsolute:
      case PathCommandType.HorizontalLineRelative:
      case PathCommandType.VerticalLineAbsolute:
      case PathCommandType.VerticalLineRelative:
        return this.subdivideLine(command, tMin, tMax)
        break
      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.QuadraticBezierRelative:
        return this.subdivideQuadratic(command, tMin, tMax)
        break
    }

    return null
  }

  private subdivideLine(cmd: EnrichedCommand, tMin: number, tMax: number): PathFragment {
    // Line absolute is draw from current point to the specified coords.
    const startPoint = cmd.startPositionAbsolute
    const endPoint = cmd.endPositionAbsolute

    // Interpolate.
    const startOut = interpolateLine(startPoint, endPoint, tMin)
    const endOut = interpolateLine(startPoint, endPoint, tMax)

    let result = new PathFragment({
      type: 'line',
      start: startOut,
      end: endOut,
      commandIndex: cmd.iCommand
    })

    return result
  }

  private subdivideQuadratic(cmd: EnrichedCommand, tMin: number, tMax: number): PathFragment {
    // Get relative flag.
    const isRelative = cmd.type === PathCommandType.QuadraticBezierRelative

    // Pull relevant points.
    const startPoint = cmd.startPositionAbsolute
    const x1 = cmd.parameters[0]
    const y1 = cmd.parameters[1]
    const x = cmd.parameters[2]
    const y = cmd.parameters[3]

    let controlPoint = { x: x1, y: y1 }
    let endPoint = { x: x, y: y }

    // Convert to absolute if needed.
    if (isRelative) {
      controlPoint = {
        x: x1 + startPoint.x,
        y: y1 + startPoint.y
      }
      endPoint = {
        x: x + startPoint.x,
        y: y + startPoint.y
      }
    }

    // Split.
    const splitResult = BezierUtils.splitQuadraticBezierRange(
      { start: startPoint, control: controlPoint, end: endPoint },
      tMin,
      tMax
    )

    // Pull results — only the curve fragment in our range.
    let startOut = splitResult.range[0]
    let controlOut = splitResult.range[1]
    let endOut = splitResult.range[2]

    let result = new PathFragment({
      type: 'quad',
      start: startOut,
      control1: controlOut,
      end: endOut,
      commandIndex: cmd.iCommand
    })

    return result
  }
}
