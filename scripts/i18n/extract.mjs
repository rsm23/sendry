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
  'Sendry · Multi-channel operations', 'Self-hosted multi-channel marketing and conversations.',
  '{brand} workspace', 'delivery transport', 'No sends',
  '{count} paused automation', '{count} paused automations',
  'Open Automations to review or resume delivery.', 'Bounce rate needs attention',
  '{percent}% of recent delivery events were bounces.', 'Monthly allowance is nearly used',
  '{percent}% of the configured allowance has been used.',
  'Layout', 'Content', 'Media', 'Social', 'Commerce', 'Interactive', 'Other',
  'Heading', 'Spacer', 'Hero', 'Logo', 'Quote', 'Video', 'Products', 'Coupon', 'Countdown', 'Survey', 'HTML', 'Footer',
  'A contained section with a heading and body.', 'Two responsive content columns.',
  'Adjustable vertical breathing room.', 'A horizontal separator.', 'A strong section title.',
  'Body copy with variables and links.', 'A reliable email call to action.',
  'A testimonial or highlighted quotation.', 'A responsive image with alt text.',
  'Headline, supporting copy and primary action.', 'A brand wordmark or image logo.',
  'A linked video thumbnail.', 'Linked social channels.', 'A compact navigation row.',
  'A two-product recommendation row.', 'A promotional offer and code.',
  'A deadline-oriented countdown display.', 'A one-click feedback question.',
  'Custom trusted email HTML.', 'Company details and subscription links.',
  'First name', 'Contact', 'Job title', 'City', 'Current day', 'Date', 'Current month',
  'Current year', 'Unsubscribe URL', 'Subscription', 'Preferences URL', 'element',
  'Choose or drag content into your email.', 'Select and reorder the email structure.',
  'Edit the selected element and email settings.',
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
