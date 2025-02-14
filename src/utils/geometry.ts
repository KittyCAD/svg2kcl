import { Point } from '../types/base'
import { PathElement } from '../types/elements'
import { PathCommand, PathCommandType } from '../types/path'
import { BezierUtils } from './bezier'

export interface LineSegment {
  start: Point
  end: Point
}

export interface SampledPathSegment {
  points: Point[]
  sourceCommand: PathCommand // Keep reference to original command.
  startIndex: number // Index where this segment starts in flattened points.
}

export interface Intersection {
  segmentAIndex: number
  segmentBIndex: number
  intersectionPoint: Point
  tA: number // Parametric value on segment A.
  tB: number // Parametric value on segment B.

  segments?: {
    a: SampledPathSegment
    b: SampledPathSegment
  }
}

export function isClockwise(points: Point[]): boolean {
  let sum = 0
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i]
    const next = points[i + 1]
    sum += (next.x - curr.x) * (next.y + curr.y)
  }
  return sum > 0
}

export function separateSubpaths(path: PathElement): {
  commands: PathCommand[]
}[] {
  const subpaths: { commands: PathCommand[] }[] = []
  let currentCommands: PathCommand[] = []

  // First split paths at explicit move commands
  path.commands.forEach((command) => {
    if (
      currentCommands.length > 0 &&
      (command.type === PathCommandType.MoveAbsolute ||
        command.type === PathCommandType.MoveRelative)
    ) {
      subpaths.push({ commands: currentCommands })
      currentCommands = []
    }
    currentCommands.push(command)
  })

  if (currentCommands.length > 0) {
    subpaths.push({ commands: currentCommands })
  }

  // Then check each subpath for self-intersections
  const finalSubpaths: { commands: PathCommand[] }[] = []

  for (const subpath of subpaths) {
    const points = []
    let currentPoint = subpath.commands[0].position

    // Collect all points including bezier curve points
    for (const command of subpath.commands) {
      points.push(currentPoint)
      if (BezierUtils.isBezierCommand(command.type)) {
        points.push(...BezierUtils.getBezierPoints(command))
      }
      currentPoint = command.position
    }

    finalSubpaths.push(subpath)

    // const intersections = findSelfIntersections(points)
    // if (intersections.length > 0) {
    //   // Split at intersections
    //   const splitPaths = splitPathAtIntersections(subpath.commands, intersections)
    //   finalSubpaths.push(...splitPaths.map((commands) => ({ commands })))
    // } else {
    //   finalSubpaths.push(subpath)
    // }
  }

  return finalSubpaths
}

export function findSelfIntersections(points: Point[]): Intersection[] {
  const intersections: Intersection[] = []
  const segments: LineSegment[] = []

  // Break path into segments
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      start: points[i],
      end: points[i + 1]
    } as LineSegment)
  }

  // Compare each segment pair for intersections.
  // Skip adjacent segments because these would always intersect.
  // Segment 1: A----B
  // Segment 2:      B----C
  for (let i = 0; i < segments.length - 1; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      // Compare each segment pair for intersections.
      // Skip adjacent segments because these would always intersect.
      // Segment 1: A----B
      // Segment 2:      B----C
      const seg1 = segments[i]
      const seg2 = segments[j]

      // Cross product of AB and CD. Our vectors are 2D, so we only need the z component.
      // https://www.mathsisfun.com/algebra/vectors-cross-product.html
      // KA Stroud, Engineering Mathematics, 7th Edition, p535
      const [abx, aby, ,] = [seg1.end.x - seg1.start.x, seg1.end.y - seg1.start.y, 0]
      const [cdx, cdy, ,] = [seg2.end.x - seg2.start.x, seg2.end.y - seg2.start.y, 0]

      // const cx = aby * cdz - abz * cdy // Will always be zero.
      // const cy = abz * cdx - abx * cdz // Will always be zero.
      const cz = abx * cdy - aby * cdx

      // Handily, cz is the determinant of the matrix:
      const det = cz

      // If A cross B is zero, then the two segments are parallel.
      if (det === 0) continue

      // Using parametric equations for the two lines, we can find intersection point.
      // P(t) = P1 + t(P2 - P1)
      // http://www.it.hiof.no/~borres/j3d/math/param/p-param.html
      //
      // This gives us a t value that increases as we move along the line; fraction
      // into the segment where the intersection occurs.
      //
      // Do the actual solve with Cramer's Rule.
      // https://en.wikipedia.org/wiki/Cramer%27s_rule
      //
      // Ax=b
      // xi = det(Ai)/det(A) for i = 1:n, where Ai is A with column i replaced by b.
      const detA1 =
        (seg2.end.x - seg2.start.x) * (seg1.start.y - seg2.start.y) -
        (seg2.end.y - seg2.start.y) * (seg1.start.x - seg2.start.x)
      const ua = detA1 / det

      const detA2 =
        (seg1.end.x - seg1.start.x) * (seg1.start.y - seg2.start.y) -
        (seg1.end.y - seg1.start.y) * (seg1.start.x - seg2.start.x)
      const ub = detA2 / det

      // Check if intersection lies within both segments, excluding endpoints.
      const EPSILON_END = 1e-10

      if (ua > EPSILON_END && ua < 1 - EPSILON_END && ub > EPSILON_END && ub < 1 - EPSILON_END) {
        const intersectionPoint = {
          x: seg1.start.x + ua * (seg1.end.x - seg1.start.x),
          y: seg1.start.y + ua * (seg1.end.y - seg1.start.y)
        }

        intersections.push({
          segmentAIndex: i,
          segmentBIndex: j,
          intersectionPoint, // Actual coordinates of the intersection.
          tA: ua, // Fraction along segment A: ua.
          tB: ub // Fraction along segment B: ub.
        })
      }
    }
  }

  return intersections
}

export function interpolateLine(p0: Point, p1: Point, t: number): Point {
  return {
    x: (1 - t) * p0.x + t * p1.x,
    y: (1 - t) * p0.y + t * p1.y
  }
}

// function splitPathAtIntersections(
//   commands: PathCommand[],
//   intersections: number[]
// ): PathCommand[][] {
//   if (intersections.length === 0) return [commands]

//   const subpaths: PathCommand[][] = []
//   let currentPath: PathCommand[] = []
//   let currentPoint = commands[0].position
//   let pointIdx = 0
//   let splitCurve: SplitBezierResult | null = null // Declare splitCurve outside the loop

//   for (const command of commands) {
//     if (BezierUtils.isBezierCommand(command.type)) {
//       let controlPoints: Point[] = []

//       // Extract the correct control points for the current command
//       if (
//         command.type === PathCommandType.QuadraticBezierAbsolute ||
//         command.type === PathCommandType.QuadraticBezierRelative
//       ) {
//         // For quadratic Bézier: 3 control points (start, control, end)
//         controlPoints = [
//           { x: command.position.x, y: command.position.y }, // Start point
//           { x: command.parameters[0], y: command.parameters[1] }, // Control point
//           { x: command.parameters[2], y: command.parameters[3] } // End point
//         ]
//       } else if (
//         command.type === PathCommandType.CubicBezierAbsolute ||
//         command.type === PathCommandType.CubicBezierRelative
//       ) {
//         // For cubic Bézier: 4 control points (start, control1, control2, end)
//         controlPoints = [
//           { x: command.position.x, y: command.position.y }, // Start point
//           { x: command.parameters[0], y: command.parameters[1] }, // Control point 1
//           { x: command.parameters[2], y: command.parameters[3] }, // Control point 2
//           { x: command.parameters[4], y: command.parameters[5] } // End point
//         ]
//       }

//       // Ensure controlPoints has been assigned correctly
//       if (controlPoints.length === 0) {
//         continue // Skip this iteration if controlPoints is still empty
//       }

//       // Get intersection t-values for this segment
//       const splits = intersections.filter((t) => Math.floor(t) === pointIdx)

//       if (splits.length > 0) {
//         let lastT = 0
//         for (const t of splits) {
//           const fraction = t - Math.floor(t)
//           splitCurve = BezierUtils.splitBezierAt(controlPoints, fraction)

//           // Fix 1: Convert split curve points into command parameters
//           let firstParams: number[] = []
//           let secondParams: number[] = []

//           if (controlPoints.length === 3) {
//             // Quadratic
//             let x = 1
//             firstParams = [
//               splitCurve.first[1].x,
//               splitCurve.first[1].y, // control point
//               splitCurve.first[2].x,
//               splitCurve.first[2].y // end point
//             ]
//             secondParams = [
//               splitCurve.second[1].x,
//               splitCurve.second[1].y, // control point
//               splitCurve.second[2].x,
//               splitCurve.second[2].y // end point
//             ]
//             let y = 1
//           } else {
//             // Cubic
//             firstParams = [
//               splitCurve.first[1].x,
//               splitCurve.first[1].y, // control point 1
//               splitCurve.first[2].x,
//               splitCurve.first[2].y, // control point 2
//               splitCurve.first[3].x,
//               splitCurve.first[3].y // end point
//             ]
//             secondParams = [
//               splitCurve.second[1].x,
//               splitCurve.second[1].y, // control point 1
//               splitCurve.second[2].x,
//               splitCurve.second[2].y, // control point 2
//               splitCurve.second[3].x,
//               splitCurve.second[3].y // end point
//             ]
//           }

//           // We're splitting a bezier into two beziers..
//           // Both SVG and KCL need to know control and end point only,
//           // start point is already known from the previous command.

//           // Add first part with correct parameters
//           currentPath.push({
//             type: command.type,
//             parameters: firstParams,
//             position: splitCurve.splitPoint
//           })

//           // Insert a Stop command at the split point
//           currentPath.push({
//             type: PathCommandType.StopAbsolute,
//             parameters: [],
//             position: splitCurve.splitPoint
//           })

//           // Add this split to the subpaths
//           subpaths.push(currentPath)

//           // Start a new path for the second part of the split
//           currentPath = [
//             {
//               type: PathCommandType.MoveAbsolute,
//               parameters: [splitCurve.splitPoint.x, splitCurve.splitPoint.y],
//               position: splitCurve.splitPoint
//             }
//           ]
//           currentPoint = splitCurve.splitPoint
//           lastT = fraction
//         }

//         // Now handle the remaining part of the curve if necessary
//         if (lastT < 1) {
//           if (splitCurve) {
//             // Ensure splitCurve is available
//             currentPath.push({
//               type: command.type,
//               parameters: splitCurve.second.flatMap((point) => [point.x, point.y]), // The control points for the second part
//               position: currentPoint
//             })
//           }
//         }
//       } else {
//         // No intersections; just add the current command
//         currentPath.push(command)
//       }
//       pointIdx += controlPoints.length - 1
//     } else {
//       currentPath.push(command)
//       if (command.type !== PathCommandType.StopAbsolute) {
//         pointIdx++
//       }
//     }
//     currentPoint = command.position
//   }

//   if (currentPath.length > 0) {
//     subpaths.push(currentPath)
//   }

//   return subpaths
// }
