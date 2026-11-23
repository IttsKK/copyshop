// Downloads precise selection's models into a folder laid out as the app keeps
// them (models/precise-1 in its data folder), each file checked against its
// SHA-256, and marks them installed: for the self-check in CI, without the app's
// own download. The list is the app's (src/ml/precise/models.ts).
//
//   node scripts/precise-models.mjs <data folder>/models/precise-1 [--find-only]

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const dir = process.argv[2]
if (!dir) {
  console.error('Give the folder: node scripts/precise-models.mjs <data folder>/models/precise-1')
  process.exit(1)
}
const findOnly = process.argv.includes('--find-only')
const source = readFileSync(new URL('../src/ml/precise/models.ts', import.meta.url), 'utf8')
const repos = Object.fromEntries([...source.matchAll(/const (\w+) = \{ repo: '([^']+)', rev: '([0-9a-f]+)' \}/g)].map((m) => [m[1], { repo: m[2], rev: m[3] }]))
const files = [...source.matchAll(/\{ part: '(\w+)', \.\.\.(\w+), path: '([^']+)', size: (\d+), sha256: '([0-9a-f]+)' \}/g)].map((m) => ({
  part: m[1],
  ...repos[m[2]],
  path: m[3],
  size: Number(m[4]),
  sha256: m[5],
}))
if (!files.length) throw new Error('No model files found in src/ml/precise/models.ts')
const parts = findOnly ? ['find'] : ['find', 'edge']

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
for (const f of files.filter((f) => parts.includes(f.part))) {
  const out = join(dir, f.repo.split('/')[1], f.path.split('/').pop())
  if (existsSync(out) && sha(out) === f.sha256) continue
  mkdirSync(dirname(out), { recursive: true })
  const url = `https://huggingface.co/${f.repo}/resolve/${f.rev}/${f.path}`
  console.log(`${url} (${Math.round(f.size / 1e6)} MB)`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out))
  if (sha(out) !== f.sha256) throw new Error(`${out} is not the expected file`)
}
writeFileSync(join(dir, 'installed.json'), JSON.stringify({ set: 'precise-1', parts }))
console.log(`Installed in ${dir}: ${parts.join(' + ')}`)
