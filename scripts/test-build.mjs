// Builds the desktop app as it is now and puts it on this Mac, in place of the
// installed one (without quitting or opening it): for trying the latest work
// before it is released.
//
//   npm run app:test              The latest commit, in a clean copy (work not yet committed is left out).
//   npm run app:test -- --working This folder as it is, uncommitted work and all.
//
// Only this Mac's kind of processor, signed but not notarized (a build made
// here opens without Apple's check), and no update files. Its version reads
// like 1.0.7+test.4772610 (the commit), in Settings and in crash reports. The
// installed app is kept in ~/Library/Caches/copyshop-old;
// the photos, edits and settings are the same app's, so nothing moves.
//
// When a release newer than it comes out, the app's own updater replaces it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAIN = new URL('..', import.meta.url).pathname
const working = process.argv.includes('--working')
const env = { ...process.env, PATH: `${homedir()}/.cargo/bin:${process.env.PATH}` }
const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, { stdio: 'inherit', env, ...opts })
}
const quiet = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', env, ...opts }).trim()
const fail = (message) => {
  console.error(`\n${message}`)
  process.exit(1)
}

const sha = quiet('git', ['-C', MAIN, 'rev-parse', '--short', 'HEAD'])
let root = MAIN
if (!working) {
  // A clean copy of the latest commit, kept between builds (Rust's and npm's
  // files are shared with this folder, so a build only redoes what changed).
  root = join(homedir(), 'Library/Caches/copyshop-test-build')
  if (existsSync(root)) {
    run('git', ['-C', root, 'checkout', '--quiet', '--detach', '--force', quiet('git', ['-C', MAIN, 'rev-parse', 'HEAD'])])
    run('git', ['-C', root, 'clean', '-fdq', '-e', 'node_modules', '-e', 'site/node_modules', '-e', 'src-tauri/target'])
  } else {
    run('git', ['-C', MAIN, 'worktree', 'add', '--detach', root, 'HEAD'])
  }
  for (const link of ['node_modules', 'site/node_modules', 'src-tauri/target'])
    if (!existsSync(join(root, link))) symlinkSync(join(MAIN, link), join(root, link))
}

const { version } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const label = `${version}+test.${sha}${working ? '.working' : ''}`
const arch = quiet('uname', ['-m']) === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
console.log(`\nTest build ${label} (${working ? 'this folder as it is' : 'the latest commit'}), ${arch}`)

// The app alone, signed as releases are: no .dmg, and no update files (they need the release's key).
const release = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.release.conf.json'), 'utf8'))
const config = { bundle: { createUpdaterArtifacts: false, macOS: release.bundle.macOS } }
run('npx', ['tauri', 'build', '--target', arch, '--bundles', 'app', '--config', JSON.stringify(config)], {
  cwd: root,
  env: { ...env, COPYSHOP_TEST_VERSION: label, COPYSHOP_OFFICIAL: '1' },
})
const built = join(root, `src-tauri/target/${arch}/release/bundle/macos/copyshop.app`)
if (!existsSync(built)) fail(`No app at ${built}`)

// The installed app kept aside and replaced, without quitting or opening it:
// a copy that is open carries on as it is, and the next launch is the new one.
const installed = '/Applications/copyshop.app'
if (existsSync(installed)) {
  const keep = join(homedir(), 'Library/Caches/copyshop-old')
  mkdirSync(keep, { recursive: true })
  rmSync(join(keep, 'copyshop-previous.app'), { recursive: true, force: true })
  run('mv', [installed, join(keep, 'copyshop-previous.app')])
}
run('ditto', [built, installed])
console.log(`\nInstalled copyshop ${label}; it opens the next time copyshop is launched. The one before it is in ~/Library/Caches/copyshop-old/copyshop-previous.app.`)
