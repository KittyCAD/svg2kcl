declare module 'earcut-typescript' {
  function earcut(
    vertices: ArrayLike<number>,
    holes?: ArrayLike<number>,
    dimensions?: number
  ): number[]

  namespace earcut {
    function flatten(data: number[][][]): {
      vertices: number[]
      holes: number[]
      dimensions: number
    }

    function deviation(
      vertices: ArrayLike<number>,
      holes: ArrayLike<number>,
      dimensions: number,
      triangles: ArrayLike<number>
    ): number
  }

  export = earcut
}
