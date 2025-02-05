export enum TransformType {
  Translate = 'translate',
  Scale = 'scale',
  Rotate = 'rotate',
  SkewX = 'skewX',
  SkewY = 'skewY',
  Matrix = 'matrix'
}

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

  translate(x: number, y: number): Matrix {
    return this.multiply(new Matrix(1, 0, 0, 1, x, y))
  }

  scale(x: number, y: number): Matrix {
    return this.multiply(new Matrix(x, 0, 0, y, 0, 0))
  }

  rotate(angle: number): Matrix {
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return this.multiply(new Matrix(cos, sin, -sin, cos, 0, 0))
  }

  skewX(angle: number): Matrix {
    const tan = Math.tan((angle * Math.PI) / 180)
    return this.multiply(new Matrix(1, 0, tan, 1, 0, 0))
  }

  skewY(angle: number): Matrix {
    const tan = Math.tan((angle * Math.PI) / 180)
    return this.multiply(new Matrix(1, tan, 0, 1, 0, 0))
  }
}
