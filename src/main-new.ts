import { BaseReader } from './reader/base'

async function main() {
  const inputFile = './tests/data/project_payload.svg'

  const baseReader = new BaseReader()
  const rawSvg = await baseReader.readFile(inputFile)

  console.log('Raw SVG:', rawSvg)
}

main().catch(console.error)
