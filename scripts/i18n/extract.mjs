import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const sourceRoots = ['src/pages', 'src/components']
const attributeNames = new Set(['alt', 'aria-label', 'description', 'detail', 'label', 'placeholder', 'title'])
const propertyNames = new Set(['actionLabel', 'description', 'detail', 'label', 'placeholder', 'title'])
const ignoredAncestors = new Set(['className', 'href', 'id', 'src', 'to', 'value'])
const messages = new Set([
  'System', 'Light', 'Dark', 'English', 'French', 'Spanish', 'Arabic',
  'success', 'failed', 'sent', 'active', 'sending', 'queued', 'scheduled', 'unconfirmed', 'draft',
  'stopped', 'unsubscribed', 'bounced', 'complaint', 'open', 'waiting', 'snoozed', 'closed',
])

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : file.endsWith('.tsx') ? [file] : []
  })
}

function add(value) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || text.length > 600 || !/[A-Za-z]/.test(text)) return
  if (/^(?:https?:|\/api\/|#[\da-f]{3,8}$)/i.test(text) || /^[\w.+-]+@[\w.-]+$/.test(text)) return
  messages.add(text)
}

function propertyName(node, sourceFile) {
  return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : node.name?.getText(sourceFile)
}

for (const file of sourceRoots.flatMap((directory) => sourceFiles(path.join(root, directory))).concat(path.join(root, 'src/App.tsx'))) {
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node) {
    if (ts.isJsxText(node)) add(node.text)
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile)
      if (attributeNames.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text)
    }
    if (ts.isPropertyAssignment(node) && propertyNames.has(propertyName(node, sourceFile) ?? '') && ts.isStringLiteralLike(node.initializer)) add(node.initializer.text)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(sourceFile) === 'toast') {
      const first = node.arguments[0]
      if (first && ts.isStringLiteralLike(first)) add(first.text)
    }
    if (ts.isStringLiteralLike(node) && ts.isJsxExpression(node.parent)) add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const catalog = Object.fromEntries([...messages].sort((left, right) => left.localeCompare(right)).map((message) => [message, message]))
const target = path.join(root, 'src/i18n/locales/en.json')
fs.writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`Extracted ${messages.size} English UI messages to ${path.relative(root, target)}.`)
