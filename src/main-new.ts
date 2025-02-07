import { BaseReader } from './reader/base'

async function main() {
  const inputFile = './tests/data/project_payload.svg'

  const baseReader = new BaseReader()
  const svg = await baseReader.readFile(inputFile)

  console.log('Read SVG:', svg)
}

main().catch(console.error)
