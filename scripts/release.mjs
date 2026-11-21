// Builds and publishes the desktop app's downloads: the files behind getcopyshop.com/download.
//
//   node scripts/release.mjs mac                  Build the Mac app (Apple silicon and Intel in one),
//                                                 sign, notarize and staple its .dmg, then upload it.
//   node scripts/release.mjs pc --run <id>        Take the Windows and Linux builds from a GitHub
//                                                 Actions run of .github/workflows/desktop.yml, and upload them.
//   node scripts/release.mjs pc --from <folder>   The same, from the run's artifacts downloaded by hand.
//
// Add --dry-run to build and check without uploading.
//
// Each file goes to the R2 bucket copyshop-site-files twice: under its plain name, which the download
// page links to (downloads/copyshop.dmg, copyshop-setup.exe, copyshop.AppImage, copyshop.deb), and
// under its version (downloads/1.2.0/…) so earlier releases stay at hand.
//
// Once, before the first Mac release:
//   rustup target add x86_64-apple-darwin
//   xcrun notarytool store-credentials copyshop-notary --apple-id <your Apple ID> --team-id WN95M5DDRZ
//     (it asks for an app-specific password, made at account.apple.com; it stays in your keychain)
//
// The version is src-tauri/tauri.conf.json's "version": raise it before building a release.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { basename, join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const BUCKET = 'copyshop-site-files'
const NOTARY_PROFILE = 'copyshop-notary'
const { version } = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const env = { ...process.env, PATH: `${homedir()}/.cargo/bin:${process.env.PATH}` }

const run = (cmd, cmdArgs, opts = {}) => {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`)
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', env, ...opts })
}
const quiet = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: ROOT, env, encoding: 'utf8' })
const fail = (message) => { console.error(`\n${message}`); process.exit(1) }

/** Every file under a folder, at any depth. */
const filesIn = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? filesIn(path) : [path]
})

function upload(file, name) {
  const mb = (statSync(file).size / 1024 / 1024).toFixed(1)
  if (dry) return console.log(`(dry run) would upload ${file} (${mb} MB) as downloads/${name} and downloads/${version}/${name}`)
  for (const key of [`downloads/${name}`, `downloads/${version}/${name}`])
    run('npx', ['--yes', 'wrangler@4', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--remote'], { cwd: ROOT })
}

/**
 * Updates (Tauri's updater): latest.json beside the downloads names the newest
 * version and, per platform, a signed file to update from. Each release adds
 * its platforms to what is there, so the Mac and the PC builds, made apart,
 * end up in one list. The signature is the .sig the build wrote with the
 * update key (Keychain "copyshop-updater-key", GitHub secret TAURI_SIGNING_PRIVATE_KEY).
 */
const SITE = 'https://getcopyshop.com'
function publishUpdates(entries) {
  const out = mkdtempSync(join(tmpdir(), 'copyshop-latest-'))
  const path = join(out, 'latest.json')
  let latest = { version, notes: `copyshop ${version}`, pub_date: new Date().toISOString(), platforms: {} }
  try {
    const now = JSON.parse(execFileSync('curl', ['-sf', `${SITE}/downloads/latest.json`], { encoding: 'utf8' }))
    // The same version: this release adds its platforms. An older one: replaced.
    if (now.version === version) latest = { ...now, platforms: { ...now.platforms } }
  } catch {
    /* none yet */
  }
  for (const { platforms, file, name, sig } of entries) {
    upload(file, name)
    for (const p of platforms) latest.platforms[p] = { signature: readFileSync(sig, 'utf8').trim(), url: `${SITE}/downloads/${version}/${name}` }
  }
  writeFileSync(path, JSON.stringify(latest, null, 2))
  console.log(`\nlatest.json: ${version}, ${Object.keys(latest.platforms).join(', ')}`)
  if (dry) return console.log('(dry run) would upload latest.json')
  run('npx', ['--yes', 'wrangler@4', 'r2', 'object', 'put', `${BUCKET}/downloads/latest.json`, '--file', path, '--remote', '--content-type', 'application/json', '--cache-control', 'no-cache'], { cwd: ROOT })
}

/** The update key, from the Keychain, for the Mac build to sign its update with. */
function signingEnv() {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) return {}
  try {
    const key = quiet('security', ['find-generic-password', '-s', 'copyshop-updater-key', '-w']).trim()
    const password = quiet('security', ['find-generic-password', '-s', 'copyshop-updater-key-password', '-w']).trim()
    return { TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password }
  } catch {
    fail('No update key in the Keychain (copyshop-updater-key): updates would not be signed.')
  }
}

function mac() {
  const targets = quiet('rustup', ['target', 'list', '--installed'])
  for (const t of ['aarch64-apple-darwin', 'x86_64-apple-darwin'])
    if (!targets.includes(t)) fail(`The Rust target ${t} is missing. Add it once with: rustup target add ${t}`)
  try { quiet('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE]) }
  catch { fail(`No notarization login saved. Save it once with:\n  xcrun notarytool store-credentials ${NOTARY_PROFILE} --apple-id <your Apple ID> --team-id WN95M5DDRZ`) }

  // An official build (COPYSHOP_OFFICIAL): signed with the Developer ID and making update files
  // (tauri.release.conf.json), and the .dmg with its background.
  run('npx', ['tauri', 'build', '--target', 'universal-apple-darwin', '--config', 'src-tauri/tauri.release.conf.json'], { env: { ...env, ...signingEnv(), COPYSHOP_OFFICIAL: '1' } })
  const dir = join(ROOT, 'src-tauri/target/universal-apple-darwin/release/bundle/dmg')
  const dmg = readdirSync(dir).filter((f) => f.endsWith('.dmg') && f.includes(version)).map((f) => join(dir, f))[0]
  if (!dmg) fail(`No .dmg for ${version} in ${dir}`)

  // Apple checks it and vouches for it; the stapled ticket lets it open offline without a warning.
  run('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', NOTARY_PROFILE, '--wait'])
  run('xcrun', ['stapler', 'staple', dmg])
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose', dmg])
  upload(dmg, 'copyshop.dmg')

  // The update: the signed app itself, zipped, for both kinds of Mac.
  const appDir = join(ROOT, 'src-tauri/target/universal-apple-darwin/release/bundle/macos')
  const tarball = readdirSync(appDir).filter((f) => f.endsWith('.app.tar.gz')).map((f) => join(appDir, f))[0]
  if (!tarball || !existsSync(`${tarball}.sig`)) fail(`No signed update (.app.tar.gz and .sig) in ${appDir}`)
  publishUpdates([{ platforms: ['darwin-aarch64', 'darwin-x86_64'], file: tarball, name: 'copyshop-mac.app.tar.gz', sig: `${tarball}.sig` }])
}

function pc() {
  let dir = flag('--from')
  const id = flag('--run')
  if (!dir && !id) fail('Say where the builds are: --run <GitHub Actions run id> or --from <folder>')
  if (id) {
    dir = mkdtempSync(join(tmpdir(), 'copyshop-builds-'))
    run('gh', ['run', 'download', id, '--dir', dir])
  }
  if (!existsSync(dir)) fail(`${dir} is not there`)
  const files = filesIn(dir)
  const find = (test, what) => files.find(test) ?? fail(`No ${what} for ${version} in ${dir}`)
  const builds = [
    [find((f) => f.endsWith('-setup.exe') && f.includes(version), 'Windows installer (…-setup.exe)'), 'copyshop-setup.exe'],
    [find((f) => f.endsWith('.AppImage') && f.includes(version), 'AppImage'), 'copyshop.AppImage'],
    [find((f) => f.endsWith('.deb') && f.includes(version), '.deb'), 'copyshop.deb'],
  ]
  for (const [file, name] of builds) upload(file, name)

  // Updates: the installer and the AppImage are what Windows and Linux update from.
  // Beside the file, or in the run's update-signatures artifacts.
  const sigOf = (file, what) => files.find((f) => f.endsWith(`${basename(file)}.sig`)) ?? fail(`No update signature for the ${what} (${basename(file)}.sig)`)
  publishUpdates([
    { platforms: ['windows-x86_64'], file: builds[0][0], name: 'copyshop-setup.exe', sig: sigOf(builds[0][0], 'Windows installer') },
    { platforms: ['linux-x86_64'], file: builds[1][0], name: 'copyshop.AppImage', sig: sigOf(builds[1][0], 'AppImage') },
  ])
}

const what = args.find((a) => !a.startsWith('--') && !['--run', '--from'].includes(args[args.indexOf(a) - 1]))
if (what === 'mac') mac()
else if (what === 'pc') pc()
else fail('Usage: node scripts/release.mjs mac | pc --run <id> | pc --from <folder>  [--dry-run]')
console.log(`\nDone: copyshop ${version}${dry ? ' (dry run, nothing uploaded)' : ', live at https://getcopyshop.com/download'}`)
