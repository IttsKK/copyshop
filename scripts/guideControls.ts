/**
 * The Guide's list of each module's controls, read from the code itself so
 * it is never out of date: every slider, choice, tick box and button that has
 * a tooltip, in the order they are on screen, under the headings, folds and
 * tabs they sit in. A module is its file in src/ui/modules (whose <Module
 * id="…"> says which), with the panels it imports that are its own.
 *
 * Served as `virtual:guide-controls`; in development, changing any of those
 * files brings the Guide up to date.
 */
import ts from 'typescript'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

export interface GuideOption {
  name: string
  text?: string
}
export type GuideEntry = { kind: 'group'; text: string } | { kind: 'control'; name: string; text?: string; options?: GuideOption[] }

const ID = 'virtual:guide-controls'
const RESOLVED = '\0' + ID

/** Imported by modules but shared with others, or drawn on the photo: not a module's own controls. */
const SHARED = new Set(['ColourField', 'ItemList', 'MasksPanel', 'TraceToKey', 'StreakOverlay', 'GrainLoupe', 'CurveEditor', 'ToneCurveEditor', 'controls'])
/** Words on buttons every module has, which say nothing about it. */
const NOISE = new Set(['Done', 'Cancel', 'Close', 'Remove', 'Reset', 'Edit', 'Stop'])

const str = (e: ts.Expression | undefined): string | undefined => {
  if (!e) return undefined
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
  if (ts.isParenthesizedExpression(e)) return str(e.expression)
  if (ts.isConditionalExpression(e)) return str(e.whenTrue) ?? str(e.whenFalse)
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return str(e.right)
  return undefined
}

/** Of a choice of words, the fullest: a tooltip's description rather than its "do this first". */
const fullest = (e: ts.Expression | undefined): string | undefined => {
  if (!e) return undefined
  if (ts.isParenthesizedExpression(e)) return fullest(e.expression)
  if (ts.isConditionalExpression(e)) {
    const [a, b] = [fullest(e.whenTrue), fullest(e.whenFalse)]
    // A "do that first" or "no room" is what it says while it can't be used, not what it does.
    const score = (t: string) => t.length - (/\bfirst\.?$|^(Finish|Stop|No room|Room for|Select something)/i.test(t) ? 1000 : 0)
    return a && b ? (score(b) > score(a) ? b : a) : (a ?? b)
  }
  return str(e)
}

function attr(el: ts.JsxOpeningLikeElement, name: string): string | undefined {
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== name || !p.initializer) continue
    if (ts.isStringLiteral(p.initializer)) return p.initializer.text
    if (ts.isJsxExpression(p.initializer)) return name === 'title' ? fullest(p.initializer.expression) : str(p.initializer.expression)
  }
  return undefined
}

const tagOf = (n: ts.Node) => (ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null)

/** Of a choice of words, the one it shows at rest ("Guides", not "Done with guides" while laying them). */
const resting = (e: ts.Expression | undefined): string | undefined => {
  if (!e) return undefined
  if (ts.isParenthesizedExpression(e)) return resting(e.expression)
  if (ts.isConditionalExpression(e)) return resting(e.whenFalse) ?? resting(e.whenTrue)
  return str(e)
}

/** The words in an element: its text, and plain strings put in it (as it is at rest). */
function textOf(n: ts.Node): string {
  const out: string[] = []
  const go = (c: ts.Node) => {
    if (ts.isJsxText(c)) out.push(c.text)
    else if (ts.isJsxExpression(c)) {
      const s = resting(c.expression as ts.Expression | undefined)
      if (s) out.push(s)
    } else if (ts.isJsxElement(c)) c.children.forEach(go)
  }
  if (ts.isJsxElement(n)) n.children.forEach(go)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/** Worth listing: words, not a mark, and not a state ("Selecting on the photo…"). */
const worthy = (name: string) => name.length >= 2 && name.length <= 48 && /[A-Za-z]/.test(name) && !NOISE.has(name) && !name.includes('…')
const tidy = (name: string) => name.replace(/^\+\s*/, '')

/** Options drawn from a list in the code: [id, label, hint] tuples. */
function tupleOptions(n: ts.Node): GuideOption[] {
  const out: GuideOption[] = []
  const go = (c: ts.Node) => {
    if (ts.isArrayLiteralExpression(c) && c.elements.length >= 2 && c.elements.every((e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))) {
      const [, label, hint] = c.elements.map((e) => (e as ts.StringLiteral).text)
      if (label && worthy(label)) out.push({ name: label, text: hint })
      return
    }
    ts.forEachChild(c, go)
  }
  go(n)
  return out
}

const parsed = new Map<string, ts.SourceFile>()
const sourceOf = (path: string) => {
  let s = parsed.get(path)
  if (!s) parsed.set(path, (s = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)))
  return s
}

/** A component's body, declared as a function or a const in the file. */
function componentIn(src: ts.SourceFile, name: string): ts.Node | null {
  for (const st of src.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st.body ?? null
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return d.initializer
  }
  return null
}

/** Components a file imports from the module's own files (not the shared ones). */
function ownImports(src: ts.SourceFile, path: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const m = /^\.{1,2}\/([A-Z][A-Za-z]+)$/.exec(st.moduleSpecifier.text)
    if (!m || SHARED.has(m[1])) continue
    const file = join(path, '..', st.moduleSpecifier.text + '.tsx')
    const names = st.importClause?.namedBindings
    if (names && ts.isNamedImports(names)) for (const e of names.elements) if (/^[A-Z]/.test(e.name.text)) out.set(e.name.text, file)
  }
  return out
}

/**
 * The controls in component `name` of `path`, in the order they are drawn,
 * with any of the module's own components it draws (a panel, a tab of its
 * own) taken in where they are drawn.
 */
function extractComponent(path: string, name: string, files: Set<string>, done = new Set<string>()): GuideEntry[] {
  const key = `${path}#${name}`
  if (done.has(key)) return []
  done.add(key)
  files.add(path)
  const src = sourceOf(path)
  const body = componentIn(src, name)
  if (!body) return []
  const imports = ownImports(src, path)
  // Tab names, from [id, Label] pairs in the file (a module's tab list).
  const tabNames = new Map<string, string>()
  const pairs = (n: ts.Node) => {
    if (ts.isArrayLiteralExpression(n) && n.elements.length === 2 && ts.isStringLiteral(n.elements[0])) {
      const a = (n.elements[0] as ts.StringLiteral).text
      // The label as it reads with nothing to add ("Mask", not "Mask •"; "Fixes", not "Fixes 2").
      const b = str(n.elements[1] as ts.Expression)?.replace(/[\s•\d]+$/, '')
      if (/^[a-z]+$/.test(a) && b && /^[A-Z]/.test(b) && !tabNames.has(a)) tabNames.set(a, b)
    }
    ts.forEachChild(n, pairs)
  }
  pairs(src)

  // Parts drawn ahead and placed later (`const feather = <…>`, `toneSliders(…)`): taken in where they are placed.
  const locals = new Map<string, ts.Node>()
  const hasJsx = (n: ts.Node): boolean => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) || !!ts.forEachChild(n, (c) => hasJsx(c) || undefined)
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && hasJsx(n.initializer)) locals.set(n.name.text, n.initializer)
    if (n !== body && (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n))) return
    ts.forEachChild(n, collect)
  }
  collect(body)
  const placed = new Set<string>()

  const out: GuideEntry[] = []
  const segmented = (el: ts.JsxOpeningLikeElement) => /\bsegmented\b/.test(attr(el, 'className') ?? '')
  /** A segmented control's choices: its buttons' words and tooltips, or the list they are drawn from. */
  const choices = (n: ts.Node): GuideOption[] => {
    const opts: GuideOption[] = []
    const go = (c: ts.Node) => {
      const t = tagOf(c)
      if (t && t.tagName.getText() === 'button') {
        const name = textOf(c)
        if (worthy(name)) opts.push({ name: tidy(name), text: attr(t, 'title') })
        return
      }
      ts.forEachChild(c, go)
    }
    go(n)
    return opts.length ? opts : tupleOptions(n)
  }
  const visit = (n: ts.Node) => {
    // A special case drawn and returned early (an old kind of streak): the main drawing has its parts.
    if (ts.isIfStatement(n) && !!ts.forEachChild(n.thenStatement, function ret(c): true | undefined {
      return ts.isReturnStatement(c) && !!c.expression && hasJsx(c.expression) ? true : ts.forEachChild(c, ret)
    }) || (ts.isIfStatement(n) && ts.isReturnStatement(n.thenStatement) && !!n.thenStatement.expression && hasJsx(n.thenStatement.expression))) return
    // Drawn ahead: left until it is placed.
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && locals.has(n.name.text)) return
    if (ts.isIdentifier(n) && locals.has(n.text) && !placed.has(n.text) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
      placed.add(n.text)
      const init = locals.get(n.text)!
      visit(ts.isArrowFunction(init) || ts.isFunctionExpression(init) ? init.body : init)
      return
    }
    // A tab's part: `shown === 'way' && (…)`.
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = n.left
      if (ts.isBinaryExpression(l) && l.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isIdentifier(l.left) && /^(shown|tab)$/.test(l.left.text) && ts.isStringLiteral(l.right)) {
        const id = l.right.text
        out.push({ kind: 'group', text: `${tabNames.get(id) ?? id[0].toUpperCase() + id.slice(1)} tab` })
      }
    }
    const t = tagOf(n)
    if (t) {
      const tag = t.tagName.getText()
      // One of the module's own components: its controls, here.
      if (/^[A-Z]/.test(tag) && tag !== 'Slider' && tag !== 'Disclosure') {
        if (componentIn(src, tag)) out.push(...extractComponent(path, tag, files, done))
        else if (imports.has(tag)) out.push(...extractComponent(imports.get(tag)!, tag, files, done))
      }
      const cls = attr(t, 'className') ?? ''
      if (tag === 'Slider') {
        const name = attr(t, 'label')
        if (name) out.push({ kind: 'control', name, text: attr(t, 'title') })
        return
      }
      if (tag === 'Disclosure') {
        const title = attr(t, 'title')
        if (title) out.push({ kind: 'group', text: title })
      }
      if (tag === 'h3') {
        const text = textOf(n)
        if (worthy(text)) out.push({ kind: 'group', text })
        return
      }
      // A named choice: <div className="field"><span title>Name</span><div className="segmented">…
      if (/\bfield\b/.test(cls) && ts.isJsxElement(n)) {
        const span = n.children.map(tagOf).find((c) => c && c.tagName.getText() === 'span')
        const seg = n.children.find((c) => {
          const ct = tagOf(c)
          return ct && segmented(ct)
        })
        if (span && seg) {
          const spanNode = n.children.find((c) => tagOf(c) === span)!
          const name = textOf(spanNode)
          const opts = choices(seg)
          if (worthy(name)) out.push({ kind: 'control', name, text: attr(span, 'title'), ...(opts.length > 1 ? { options: opts } : {}) })
          return
        }
      }
      if (segmented(t)) {
        if (/streak-tabs|repeat-tabs/.test(cls)) return
        const opts = choices(n)
        if (opts.length > 1) out.push({ kind: 'control', name: opts.map((o) => o.name).join(' or '), options: opts })
        return
      }
      if (tag === 'label' && /check-row/.test(cls)) {
        const name = textOf(n)
        if (worthy(name)) out.push({ kind: 'control', name, text: attr(t, 'title') })
        return
      }
      if (tag === 'button') {
        const title = attr(t, 'title')
        const name = textOf(n)
        if (title && worthy(name)) out.push({ kind: 'control', name: tidy(name), text: title })
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  return out
}

/** Each module's id, file and component (src/ui/modules/GrainModule.tsx: <Module id="grain">, GrainModule). */
function moduleFiles(root: string): { id: string; path: string; component: string }[] {
  const dir = join(root, 'src/ui/modules')
  const out: { id: string; path: string; component: string }[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('Module.tsx'))) {
    const path = join(dir, f)
    const id = /<Module[\s\S]*?\bid="([a-z]+)"/.exec(readFileSync(path, 'utf8'))?.[1]
    if (id) out.push({ id, path, component: f.replace(/\.tsx$/, '') })
  }
  return out
}

export function guideControls(): Plugin {
  let root = process.cwd()
  return {
    name: 'guide-controls',
    configResolved(c) {
      root = c.root
    },
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null
      parsed.clear()
      const pages: Record<string, GuideEntry[]> = {}
      for (const m of moduleFiles(root)) {
        const seen = new Set<string>()
        const entries: GuideEntry[] = []
        const files = new Set<string>()
        for (const e of extractComponent(m.path, m.component, files)) {
          const key = e.kind === 'group' ? `g:${e.text}` : `c:${e.name}`
          if (e.kind === 'control' && seen.has(key)) continue
          seen.add(key)
          entries.push(e)
        }
        for (const f of files) this.addWatchFile(f)
        // Headings with nothing under them go.
        pages[m.id] = entries.filter((e, i) => e.kind !== 'group' || entries[i + 1]?.kind === 'control')
      }
      // Each module's example, rendered ahead (scripts/guide/examples.sh): which sample photo it is on.
      const dir = join(root, 'public/guide/examples')
      const examples: Record<string, string> = {}
      if (existsSync(dir))
        for (const f of readdirSync(dir)) {
          const m = /^([a-z]+)@([a-z]+)\.jpg$/.exec(f)
          if (m && m[1] !== 'without') examples[m[1]] = m[2]
        }
      // Finished photos where a module is used well, each beside its original (public/guide/showcase/<module>-<n>-original|finished.jpg).
      const shown = join(root, 'public/guide/showcase')
      const showcase: Record<string, number[]> = {}
      if (existsSync(shown))
        for (const f of readdirSync(shown).sort()) {
          const m = /^([a-z]+)-(\d+)-finished\.jpg$/.exec(f)
          if (m) (showcase[m[1]] ??= []).push(Number(m[2]))
        }
      return `export default ${JSON.stringify(pages)}\nexport const examples = ${JSON.stringify(examples)}\nexport const showcase = ${JSON.stringify(showcase)}`
    },
  }
}
