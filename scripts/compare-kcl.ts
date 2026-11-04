import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_OLD_REF = 'origin/main'
const DEFAULT_OUTPUT_DIR = '/tmp/svg2kcl-comparisons'

type ParsedArgs = {
  svgPath?: string
  all: boolean
  center: boolean
  help: boolean
  oldKclPath?: string
  oldRef: string
  outputDir: string
}

type CompareStatus =
  | 'changed'
  | 'missing-old'
  | 'new-error'
  | 'new-only'
  | 'no-diff'
  | 'old-error'

type ComparisonResult = {
  status: CompareStatus
  svgPath: string
  artifactDir?: string
  message?: string
}

function usage(): string {
  return [
    'Usage:',
    '  npm run compare:kcl -- <svg-file> [--out <dir>] [--old-ref <ref>] [--center]',
    '  npm run compare:kcl -- <svg-file> --old-kcl <old-file> [--out <dir>] [--center]',
    '  npm run compare:kcl -- --all [--out <dir>] [--old-ref <ref>] [--center]',
    '',
    'Examples:',
    '  npm run compare:kcl -- tests/data/elements/basic_rectangle.svg',
    '  npm run compare:kcl -- --all',
    '  npm run compare:kcl -- tests/data/examples/project_payload.svg --out /tmp/project-kcl'
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
    all: false,
    center: false,
    help: false,
    oldRef: DEFAULT_OLD_REF,
    outputDir: DEFAULT_OUTPUT_DIR
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--all') {
      parsed.all = true
    } else if (arg === '--center') {
      parsed.center = true
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true
    } else if (arg === '--out') {
      parsed.outputDir = takeValue(args, i, arg)
      i++
    } else if (arg.startsWith('--out=')) {
      parsed.outputDir = arg.slice('--out='.length)
    } else if (arg === '--old-ref') {
      parsed.oldRef = takeValue(args, i, arg)
      i++
    } else if (arg.startsWith('--old-ref=')) {
      parsed.oldRef = arg.slice('--old-ref='.length)
    } else if (arg === '--old-kcl') {
      parsed.oldKclPath = takeValue(args, i, arg)
      i++
    } else if (arg.startsWith('--old-kcl=')) {
      parsed.oldKclPath = arg.slice('--old-kcl='.length)
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else if (!parsed.svgPath) {
      parsed.svgPath = arg
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (parsed.all && parsed.svgPath) {
    throw new Error('Use either --all or a single SVG path, not both')
  }

  if (parsed.all && parsed.oldKclPath) {
    throw new Error('--old-kcl can only be used with a single SVG path')
  }

  if (!parsed.help && !parsed.all && !parsed.svgPath) {
    throw new Error('Provide an SVG path or use --all')
  }

  return parsed
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

function replaceSvgExtension(filepath: string): string {
  return filepath.replace(/\.svg$/i, '.kcl')
}

function artifactDirForSvg(svgPath: string, repoRoot: string, outputDir: string): string {
  const relative = relativeRepoPath(svgPath, repoRoot)
  const artifactPath = relative
    ? replaceSvgExtension(relative).replace(/\.kcl$/i, '')
    : path.basename(svgPath, path.extname(svgPath))
  return path.resolve(outputDir, artifactPath)
}

function readOldKclFromGit(svgPath: string, repoRoot: string, oldRef: string): string {
  const relativeSvgPath = relativeRepoPath(svgPath, repoRoot)
  if (!relativeSvgPath) {
    throw new Error('SVG is outside this repository; pass --old-kcl to compare an external file')
  }

  const relativeKclPath = replaceSvgExtension(relativeSvgPath)
  return execFileSync('git', ['show', `${oldRef}:${relativeKclPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/)
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

function createDiff(oldKcl: string, newKcl: string): string {
  if (oldKcl === newKcl) {
    return 'No differences.\n'
  }

  const oldLines = splitLines(oldKcl)
  const newLines = splitLines(newKcl)
  const lcsLengths: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0)
  )

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      lcsLengths[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lcsLengths[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lcsLengths[oldIndex + 1][newIndex], lcsLengths[oldIndex][newIndex + 1])
    }
  }

  const diffLines = [
    '--- old.kcl',
    '+++ new.kcl',
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`
  ]
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      diffLines.push(` ${oldLines[oldIndex]}`)
      oldIndex++
      newIndex++
    } else if (
      newIndex >= newLines.length ||
      (oldIndex < oldLines.length &&
        lcsLengths[oldIndex + 1][newIndex] >= lcsLengths[oldIndex][newIndex + 1])
    ) {
      diffLines.push(`-${oldLines[oldIndex]}`)
      oldIndex++
    } else {
      diffLines.push(`+${newLines[newIndex]}`)
      newIndex++
    }
  }

  return `${diffLines.join('\n')}\n`
}

async function discoverFixtureSvgs(repoRoot: string): Promise<ComparisonResult[]> {
  const dataRoot = path.join(repoRoot, 'tests', 'data')

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

  const files = await walk(dataRoot)
  const svgPaths = files.filter((file) => file.endsWith('.svg')).sort()
  return svgPaths.map((svgPath) => ({ status: 'no-diff' as const, svgPath }))
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

function writeNewKclWithWorker(
  svgPath: string,
  newPath: string,
  parsed: ParsedArgs,
  repoRoot: string
): string | undefined {
  const workerPath = path.join(repoRoot, 'scripts', 'rebuild-kcl-worker.ts')
  const workerArgs = [
    '-r',
    'ts-node/register',
    workerPath,
    svgPath,
    newPath,
    ...(parsed.center ? ['--center'] : [])
  ]
  const result = spawnSync(process.execPath, workerArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (!result.error && result.status === 0) {
    return undefined
  }

  return result.error
    ? result.error.message
    : compactMessage(result.stderr || result.stdout || `Exited with status ${result.status}`)
}

async function compareSvg(
  svgPathInput: string,
  parsed: ParsedArgs,
  repoRoot: string
): Promise<ComparisonResult> {
  const svgPath = path.resolve(repoRoot, svgPathInput)
  const artifactDir = artifactDirForSvg(svgPath, repoRoot, parsed.outputDir)
  const copiedSvgPath = path.join(artifactDir, 'input.svg')
  const oldPath = path.join(artifactDir, 'old.kcl')
  const oldMissingPath = path.join(artifactDir, 'old.missing.txt')
  const newPath = path.join(artifactDir, 'new.kcl')
  const diffPath = path.join(artifactDir, 'diff.patch')

  await mkdir(artifactDir, { recursive: true })
  await copyFile(svgPath, copiedSvgPath)

  let oldKcl: string | undefined
  let oldMessage: string | undefined
  try {
    oldKcl = parsed.oldKclPath
      ? await readFile(path.resolve(repoRoot, parsed.oldKclPath), 'utf8')
      : readOldKclFromGit(svgPath, repoRoot, parsed.oldRef)
  } catch (error) {
    oldMessage = error instanceof Error ? error.message : String(error)
  }

  if (oldKcl) {
    await writeFile(oldPath, oldKcl, 'utf8')
  } else {
    await writeFile(
      oldMissingPath,
      `${oldMessage ?? `No old KCL available in ${parsed.oldRef}`}\n`,
      'utf8'
    )
  }

  const newError = writeNewKclWithWorker(svgPath, newPath, parsed, repoRoot)
  if (newError) {
    return {
      status: 'new-error',
      svgPath,
      artifactDir,
      message: newError
    }
  }

  const newKcl = await readFile(newPath, 'utf8')
  if (!oldKcl) {
    await writeFile(diffPath, 'No old KCL available; generated new.kcl only.\n', 'utf8')
    return {
      status: 'new-only',
      svgPath,
      artifactDir,
      message: oldMessage ? compactMessage(oldMessage) : undefined
    }
  }

  const diff = createDiff(oldKcl, newKcl)
  await writeFile(diffPath, diff, 'utf8')

  return {
    status: diff === 'No differences.\n' ? 'no-diff' : 'changed',
    svgPath,
    artifactDir
  }
}

function printResult(result: ComparisonResult, repoRoot: string): void {
  const svgLabel = relativeRepoPath(result.svgPath, repoRoot) ?? result.svgPath
  const artifactLabel = result.artifactDir ? ` -> ${result.artifactDir}` : ''
  const message = result.message ? ` (${result.message})` : ''
  console.log(`${result.status.padEnd(11)} ${svgLabel}${artifactLabel}${message}`)
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2))
    if (parsed.help) {
      console.log(usage())
      return
    }

    const repoRoot = process.cwd()
    const candidates = parsed.all
      ? await discoverFixtureSvgs(repoRoot)
      : [{ status: 'no-diff' as const, svgPath: parsed.svgPath as string }]

    const results: ComparisonResult[] = []
    for (const candidate of candidates) {
      results.push(await compareSvg(candidate.svgPath, parsed, repoRoot))
    }

    for (const result of results) {
      printResult(result, repoRoot)
    }

    const changed = results.filter((result) => result.status === 'changed').length
    const newOnly = results.filter((result) => result.status === 'new-only').length
    const noDiff = results.filter((result) => result.status === 'no-diff').length
    const failed = results.length - changed - newOnly - noDiff
    console.log(
      `\nProcessed ${results.length} SVG(s), ${changed} changed, ${newOnly} new-only, ${noDiff} unchanged, ${failed} failed.`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error('')
    console.error(usage())
    process.exitCode = 1
  }
}

void main()
