# svg2kcl

Converts the geometry from an SVG file to a KittyCAD `.kcl` file.

## Method

At a high level, the tool converts SVG to KCL by doing the following:

1. Reading the SVG file via the `SvgReader` class.
2. Converting the SVG file into an array of `KclOperation` objects.
3. Writing the `KclOperation` objects to a `.kcl` file using the `KclWriter` class.

This the process performed by `convertSvgToKcl` in `src/main.ts`, and is described in more detail
below.

### Reading the SVG File

- The `SvgReader` class parses the SVG file using `fast-xml-parser`, extracting elements into a
  structured format.
- It converts the SVG structure into `RawSvgElement` objects, handling both geometric elements
  (paths, shapes) and groups, with groups recursively processed.
- The `readElement` method delegates parsing to `PathReader` for paths and `ShapeReader` for other
  geometric elements.
- The final output is an `Svg` object containing:
  - A `viewBox` defining the coordinate system.
  - An array of `Element` objects representing the extracted geometry.

This output element array could be objects such as `RectangleElement`, `CircleElement` etc., which
contain the parsed parameters from the input SVG, e.g.:

```typescript
export interface RectangleElement extends ElementProperties {
  type: ElementType.Rectangle
  x: number
  y: number
  width: number
  height: number
  rx?: number
  ry?: number
}
```

### Converting SVG to KCL Operations

- The `Converter` class transforms parsed `Element` objects into an array of `KclOperation` objects.
- Each element type (paths, rectangles, circles, etc.) is converted using element specific methods.
- Paths are processed using the `PathProcessor`, which breaks paths into discrete, processable
  fragments, then composes these into closed regions. Path processing follows three main steps:

  1. Path Analysis:

  - Identifies subpaths by detecting `Move` commands.
  - Samples each subpath into discrete points for intersection detection.
  - Finds self-intersections within subpaths and between different subpaths.

  2. Fragment Creation:

  - Uses detected intersections to split constituent path commands into `PathFragment` objects.
  - Ensures fragments are properly connected for downstream processing.
  - Samples each fragment for later use in region analysis.

  3. Region Analysis:

  - Constructs closed regions from connected fragments.
  - Computes winding numbers to determine region fill behavior (e.g., even-odd vs. nonzero fill).
  - Identifies holes and removes redundant regions.
  - Outputs an ordered list of `PathRegion` objects with hierarchical containment.

- The final output consists of:

  - A `FragmentMap` which allows fragments to be looked up by ID.
  - A structured list of `PathRegion` objects defining the extracted closed regions.

- For all geometry, paths and otherwise, the `Converter` class then generates `KclOperation`
  objects, which represent the geometry in a format almost suitable for writing to a `.kcl` file.

### Writing KCL Operations to File

- The `KclWriter` class formats `KclOperation` objects into a structured `.kcl` file using the
  `Formatter` class.
- The `formatAndWrite` method writes the formatted output to disk, assigning each shape a unique
  variable name (e.g., `sketch001`).

## Path Processing Notes

### Key Concepts:

- Path: A sequence of SVG commands (`Move`, `Line`, `CubicBezier` etc.) forming a continuous shape.
- Subpath: A wholly contained subset of a path starting with a `Move` command and ending at the next
  `Move` or `Close` command.
- Fragment: A section of a path command split at intersection points, forming a connected graph.
- Face: A closed cycle of fragments in the planar graph, representing potential regions.
- Region: A processed face classified as either a filled shape or a hole using winding rules.

### Path Processing Algorithm:

Nomenclature:

- 'path-global': Refers to the original path-level command set or path-level sampling.
- 'subpath-local': Refers to a the subpath-level command set or subpath-level sampling.
- 'fragment-local': Refers to a fragment-level command set or fragment-level sampling.
- 'command-local': Refers to the position of a feature within a command (e.g., a point within a
  Bézier curve).

#### 1. Path Analysis & Sampling

- Splitting into subpaths:

  - Paths are divided at `Move` commands (`splitSubpaths`).
  - Ensures each subpath starts at a `Move` and ends at a `Close` or another `Move`.
  - Subpaths are stored with `iFirstCommand` and `iLastCommand` indexes, linking them to the
    path-global command set.

- Sampling subpaths (`sampleSubpath`):
  - Paths are sampled into discrete points, with each line/curve element producing `N_CURVE_SAMPLES`
    points.
  - Each command element from the path/subpath are back-filled with `iFirstPoint` and `iLastPoint`
    indexes, linking the sampled points to both the path-global and subpath-local command sets.

#### 2. Intersection Detection

- Finding self-intersections (`findSelfIntersections`):

  - Checks each subpath for self-overlapping curves.
  - Uses bounding box filtering for efficiency, then computes segment intersections.

- Detecting intersections between subpaths (`findIntersectionsBetweenSubpaths`):
  - Compares segments from different subpaths to find crossing points.
  - Intersection points are stored with `t` values representing the command-local position along the
    curve at which the intersection is found.
  - Each intersection is then mapped back to a both a path-global command index and an path-global
    sample segment index.

#### 3. Path Splitting into Fragments

- Building a split plan (`buildSplitPlan`):

  - Uses detected intersections to generate a path-global map of split points (`t-values`) for each
    command.
  - Each `t-value` corresponds to a command-local position along a curve at which an intersection
    occurs.
  - The split plan ensures that every resulting fragment corresponds to a non-intersecting section
    of the original path.

- Subdividing commands (`subdivideCommand`):

  - Each path-global command is subdivided into fragments at the intersection points.
  - Lines are split at intersection points into two smaller line segments.
  - Bézier curves are split into two Béziers using De Casteljau's algorithm.
  - Each newly generated fragment inherits path-global and command-local indices, preserving
    relationships to the original path.

- Fragment connectivity (`connectFragments`):
  - Establishes valid connections between fragment-local start and end points.
  - Fragments are stored in a fragment graph, where edges define adjacency and valid transitions
    between segments.
  - Ensures that split paths remain traversable for later region detection.

#### 4. Planar Face Detection

- Constructing the planar graph (`buildPlanarGraphFromFragments`):

  - The fragment graph is used to construct a planar graph, where:
    - Fragments act as edges.
    - Intersection points and path endpoints serve as graph nodes.
  - This representation allows for efficient cycle detection, which is critical for identifying
    closed shapes.

- Detecting closed cycles (faces) (`getFaces`):
  - Faces are formed by detecting closed cycles in the planar graph.
  - A valid face is a loop of connected fragments, defining a potential filled region or hole.
  - Faces are extracted and labeled with their associated fragment connections.

#### 5. Region Construction & Winding Rule Calculation

- Classifying faces into regions (`buildRegions`):

  - Faces are converted into `PathRegion` objects, where:
    - Each region stores the fragments that define its boundary.
    - Regions are associated with path-global indices for tracking.

- Applying winding rules (`determineInsideness`):
  - Each region's winding number is calculated to determine fill behavior:
    - Nonzero winding rule: A point is inside if its winding number is nonzero.
    - Even-odd rule: A point is inside if it crosses an odd number of edges.
  - Determines nested relationships between regions, classifying them as filled areas or holes.

#### 6. Cleanup & Optimization

- Resolve containment hierarchy (`resolveContainmentHierarchy`):

  - Analyzes region nesting to establish a parent-child hierarchy.
  - Holes are assigned to the correct parent region.
  - Ensures no misclassified filled regions or orphan holes exist.

- Removing redundant regions (`cleanup`):

  - Detects small enclosed regions that do not contribute to the final shape.
  - Ensures no overlapping duplicates or unnecessary subdivisions exist.

## Limitations

### Unsupported Features

The following SVG geometry features are not supported:

- Text elements.
- Elliptical arcs.
- Ellipses.
- Rounded rectangles with diverging `rx` and `ry` values.
- Paths with `arc` commands.

### Path Processing

As described above, the path processing approach is dependent on a number of operations with sampled
and discretized representations of underlying geometry.

For example, the intersection detection samples each subpath's commands at fixed density, with each
command being sampled at `N_CURVE_SAMPLES` points. Intersections are then identified within these
sampled points, and constituent lines, Bèzier curves etc. are split into 'fragments' at these
intersection points.

Similarly, region analysis is based on winding number calculations, which are performed on 'dumb'
representations of closed regions constructed from sampled representations of fragments. This
approach determines the even-odd or non-zero fill status. Because the series of points which are
subject to this test are offset from the polygon boundary towards the polygon centroid, this
approach is likely to fall over for U-shaped and other complex polygons.

Parameters that drive these processes are defined in `src/constants.ts`.

## Usage

To use the tool from the command line, run:

```bash
ts-node src/main.ts ./tests/data/examples/project_payload.svg
```

To specify an output file, use:

```bash
ts-node src/main.ts ./tests/data/examples/project_payload.svg ./output.kcl
```

To center the geometry on x=0, y=0, use:

```bash
ts-node src/main.ts ./tests/data/examples/project_payload.svg ./output.kcl --center
```
