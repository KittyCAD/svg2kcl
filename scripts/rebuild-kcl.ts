import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

type RebuildMode = 'all' | 'baselines'

type ParsedArgs = {
  center: boolean
  dataDir: string
  emitRegions: boolean
  help: boolean
  inputPaths: string[]
  mode: RebuildMode
  outputDir?: string
}

type RebuildResult = {
  inputPath: string
  message?: string
  outputPath: string
  status: 'failed' | 'rebuilt'
}

const DEFAULT_DATA_DIR = 'tests/data'

function usage(): string {
  return [
    'Usage:',
    '  npm run rebuild:kcl -- [--all] [--center] [--no-regions] [--data-dir <dir>] [--out-dir <dir>]',
    '  npm run rebuild:kcl -- --baselines [--center] [--no-regions] [--data-dir <dir>] [--out-dir <dir>]',
    '  npm run rebuild:kcl -- <svg-file> [<svg-file> ...] [--center] [--no-regions] [--out-dir <dir>]',
    '',
    'Examples:',
    '  npm run rebuild:kcl -- --all',
    '  npm run rebuild:kcl -- --all --out-dir /tmp/svg2kcl-rebuild',
    '  npm run rebuild:kcl -- --baselines',
    '  npm run rebuild:kcl -- tests/data/elements/basic_rectangle.svg'
  ].join('\n')
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    center: false,
    dataDir: DEFAULT_DATA_DIR,
    emitRegions: true,
    help: false,
    inputPaths: [],
    mode: 'all'
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--all') {
      parsed.mode = 'all'
    } else if (arg === '--baselines') {
      parsed.mode = 'baselines'
    } else if (arg === '--center') {
      parsed.center = true
    } else if (arg === '--no-regions') {
      parsed.emitRegions = false
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true
    } else if (arg === '--data-dir') {
      parsed.dataDir = takeValue(args, i, arg)
      i++
    } else if (arg.startsWith('--data-dir=')) {
      parsed.dataDir = arg.slice('--data-dir='.length)
    } else if (arg === '--out-dir') {
      parsed.outputDir = takeValue(args, i, arg)
      i++
    } else if (arg.startsWith('--out-dir=')) {
      parsed.outputDir = arg.slice('--out-dir='.length)
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      parsed.inputPaths.push(arg)
    }
  }

  return parsed
}

function replaceSvgExtension(filepath: string): string {
  if (!filepath.toLowerCase().endsWith('.svg')) {
    throw new Error(`Expected an SVG path, got: ${filepath}`)
  }
  return filepath.replace(/\.svg$/i, '.kcl')
}

function toPosixPath(filepath: string): string {
  return filepath.split(path.sep).join(path.posix.sep)
}

function relativeRepoPath(filepath: string, repoRoot: string): string | undefined {
  const relative = path.relative(repoRoot, filepath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined
  }
  return toPosixPath(relative)
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filepath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return walk(filepath)
      }
      return [filepath]
    })
  )
  return files.flat()
}

async function discoverSvgs(repoRoot: string, dataDir: string): Promise<string[]> {
  const root = path.resolve(repoRoot, dataDir)
  const files = await walk(root)
  return files.filter((file) => file.toLowerCase().endsWith('.svg')).sort()
}

function outputPathForSvg(svgPath: string, parsed: ParsedArgs, repoRoot: string): string {
  if (!parsed.outputDir) {
    return replaceSvgExtension(svgPath)
  }

  const relative = relativeRepoPath(svgPath, repoRoot)
  const mirroredPath = relative
    ? replaceSvgExtension(relative)
    : replaceSvgExtension(path.basename(svgPath))
  return path.resolve(repoRoot, parsed.outputDir, mirroredPath)
}

async function rebuildSvg(
  svgPath: string,
  parsed: ParsedArgs,
  repoRoot: string
): Promise<RebuildResult> {
  const outputPath = outputPathForSvg(svgPath, parsed, repoRoot)
  const workerPath = path.join(repoRoot, 'scripts', 'rebuild-kcl-worker.ts')
  const workerArgs = [
    '-r',
    'ts-node/register',
    workerPath,
    svgPath,
    outputPath,
    ...(parsed.center ? ['--center'] : []),
    ...(parsed.emitRegions ? [] : ['--no-regions'])
  ]
  const result = spawnSync(process.execPath, workerArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (!result.error && result.status === 0) {
    return {
      inputPath: svgPath,
      outputPath,
      status: 'rebuilt'
    }
  }

  const message = result.error
    ? result.error.message
    : compactMessage(result.stderr || result.stdout || `Exited with status ${result.status}`)
  return {
    inputPath: svgPath,
    message,
    outputPath,
    status: 'failed'
  }
}

function compactMessage(message: string): string {
  if (message.includes('Face discovery failed')) {
    return 'Face discovery failed'
  }
  if (message.includes('JavaScript heap out of memory')) {
    return 'JavaScript heap out of memory'
  }

  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const compact = lines.slice(-8).join(' | ')
  return compact.length > 1200 ? `${compact.slice(0, 1197)}...` : compact
}

function printResult(result: RebuildResult, repoRoot: string): void {
  const inputLabel = relativeRepoPath(result.inputPath, repoRoot) ?? result.inputPath
  const outputLabel = relativeRepoPath(result.outputPath, repoRoot) ?? result.outputPath
  const message = result.message ? ` (${result.message})` : ''
  console.log(`${result.status.padEnd(7)} ${inputLabel} -> ${outputLabel}${message}`)
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2))
    if (parsed.help) {
      console.log(usage())
      return
    }

    const repoRoot = process.cwd()
    const discoveredPaths =
      parsed.inputPaths.length > 0
        ? parsed.inputPaths.map((inputPath) => path.resolve(repoRoot, inputPath))
        : await discoverSvgs(repoRoot, parsed.dataDir)
    const svgPaths =
      parsed.mode === 'baselines'
        ? discoveredPaths.filter((svgPath) => existsSync(replaceSvgExtension(svgPath)))
        : discoveredPaths

    if (svgPaths.length === 0) {
      throw new Error('No SVG files found to rebuild')
    }

    const results: RebuildResult[] = []
    for (const svgPath of svgPaths) {
      results.push(await rebuildSvg(svgPath, parsed, repoRoot))
    }

    for (const result of results) {
      printResult(result, repoRoot)
    }

    const rebuilt = results.filter((result) => result.status === 'rebuilt').length
    const failed = results.length - rebuilt
    console.log(`\nAttempted ${results.length} SVG(s), rebuilt ${rebuilt}, failed ${failed}.`)

    if (failed > 0) {
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error('')
    console.error(usage())
    process.exitCode = 1
  }
}

void main()
