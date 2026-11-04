import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { convertSvgToKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

type WorkerArgs = {
  center: boolean
  emitRegions: boolean
  inputPath: string
  outputPath: string
}

function parseArgs(args: string[]): WorkerArgs {
  const center = args.includes('--center')
  const emitRegions = !args.includes('--no-regions')
  const fileArgs = args.filter((arg) => !arg.startsWith('--'))

  if (fileArgs.length !== 2) {
    throw new Error(
      'Usage: rebuild-kcl-worker.ts <input.svg> <output.kcl> [--center] [--no-regions]'
    )
  }

  return {
    center,
    emitRegions,
    inputPath: fileArgs[0],
    outputPath: fileArgs[1]
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2))
    const options: KclOptions = { centerOnViewBox: args.center, emitRegions: args.emitRegions }

    await mkdir(path.dirname(args.outputPath), { recursive: true })
    await convertSvgToKcl(args.inputPath, args.outputPath, options)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

void main()
