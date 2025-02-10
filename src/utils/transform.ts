import { GeometricElement } from '../types/geometric'

export class Matrix {
  // https://www.w3.org/TR/SVG11/coords.html
  // [a, c, e]
  // [b, d, f]
  // [0, 0, 1]
  constructor(
    public a: number = 1,
    public b: number = 0,
    public c: number = 0,
    public d: number = 1,
    public e: number = 0,
    public f: number = 0
  ) {}

  multiply(other: Matrix): Matrix {
    const a = this.a * other.a + this.c * other.b
    const b = this.b * other.a + this.d * other.b
    const c = this.a * other.c + this.c * other.d
    const d = this.b * other.c + this.d * other.d
    const e = this.a * other.e + this.c * other.f + this.e
    const f = this.b * other.e + this.d * other.f + this.f
    return new Matrix(a, b, c, d, e, f)
  }
}

export enum TransformType {
  Translate = 'translate',
  Scale = 'scale',
  Rotate = 'rotate',
  SkewX = 'skewX',
  SkewY = 'skewY',
  Matrix = 'matrix'
}

export class Transform {
  public matrix: Matrix

  constructor(matrix?: Matrix) {
    this.matrix = matrix || new Matrix()
  }

  // Static factory methods.
  static translate(x: number, y: number = 0): Transform {
    return new Transform(new Matrix(1, 0, 0, 1, x, y))
  }

  static scale(x: number, y: number = x): Transform {
    return new Transform(new Matrix(x, 0, 0, y, 0, 0))
  }

  static rotate(angle: number, cx: number = 0, cy: number = 0): Transform {
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const matrix = new Matrix(cos, sin, -sin, cos, 0, 0)

    if (cx || cy) {
      return Transform.translate(cx, cy)
        .combine(new Transform(matrix))
        .combine(Transform.translate(-cx, -cy))
    }

    return new Transform(matrix)
  }

  static skewX(angle: number): Transform {
    const tan = Math.tan((angle * Math.PI) / 180)
    return new Transform(new Matrix(1, 0, tan, 1, 0, 0))
  }

  static skewY(angle: number): Transform {
    const tan = Math.tan((angle * Math.PI) / 180)
    return new Transform(new Matrix(1, tan, 0, 1, 0, 0))
  }

  static fromMatrix(matrix: Matrix): Transform {
    return new Transform(matrix)
  }

  // Instance methods for chaining transformations.
  translate(x: number, y: number = 0): Transform {
    return this.combine(Transform.translate(x, y))
  }

  scale(x: number, y: number = x): Transform {
    return this.combine(Transform.scale(x, y))
  }

  rotate(angle: number, cx: number = 0, cy: number = 0): Transform {
    return this.combine(Transform.rotate(angle, cx, cy))
  }

  skewX(angle: number): Transform {
    return this.combine(Transform.skewX(angle))
  }

  skewY(angle: number): Transform {
    return this.combine(Transform.skewY(angle))
  }

  // Combine two transforms.
  combine(other: Transform): Transform {
    return new Transform(this.matrix.multiply(other.matrix))
  }

  // Get the underlying matrix.
  toMatrix(): Matrix {
    return this.matrix
  }

  // Parse SVG transform string.
  static fromString(transformStr: string): Transform {
    if (!transformStr) {
      return new Transform()
    }

    const transformRegex = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([-\d\s,.e]+)\)/g
    let transform = new Transform()
    let match

    while ((match = transformRegex.exec(transformStr)) !== null) {
      const [, type, valuesStr] = match
      const values = valuesStr.split(/[\s,]+/).map(Number)

      switch (type) {
        case TransformType.Translate: {
          const [tx = 0, ty = 0] = values
          transform = transform.translate(tx, ty)
          break
        }
        case TransformType.Scale: {
          const [sx = 1, sy = sx] = values
          transform = transform.scale(sx, sy)
          break
        }
        case TransformType.Rotate: {
          const [angle = 0, cx = 0, cy = 0] = values
          transform = transform.rotate(angle, cx, cy)
          break
        }
        case TransformType.SkewX: {
          transform = transform.skewX(values[0] || 0)
          break
        }
        case TransformType.SkewY: {
          transform = transform.skewY(values[0] || 0)
          break
        }
        case TransformType.Matrix: {
          if (values.length === 6) {
            transform = transform.combine(Transform.fromMatrix(new Matrix(...values)))
          }
          break
        }
      }
    }

    return transform
  }
}

export function getCombinedTransform(element: GeometricElement): Transform {
  // Start with the element's own transform or identity transform.
  let transform = element.transform || new Transform()

  // Walk up the parent chain, combining transforms.
  let currentElement = element.parentElement
  while (currentElement) {
    if (currentElement.transform) {
      // Combine transforms from parent to child.
      // Parent transform should be applied first, then child.
      transform = currentElement.transform.combine(transform)
    }
    currentElement = currentElement.parentElement
  }

  return transform
}
