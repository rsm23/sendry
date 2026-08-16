import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { parseKnowledgeDocument } from '../server/knowledge/parsers'

describe('knowledge document parsers', () => {
  it('chunks multilingual text deterministically with stable locations and hashes', async () => {
    const text = ['English product policy.', 'Politique produit en français.', 'سياسة المنتج باللغة العربية.', 'Política del producto en español.'].join('\n\n')
    const first = await parseKnowledgeDocument({ data: Buffer.from(text), name: 'policy.md' })
    const second = await parseKnowledgeDocument({ data: Buffer.from(text), name: 'policy.md' })
    expect(first).toEqual(second)
    expect(first[0]).toMatchObject({ ordinal: 0, location: { kind: 'text' } })
    expect(first[0].content_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('removes executable HTML content before chunking', async () => {
    const chunks = await parseKnowledgeDocument({ data: Buffer.from('<html><body><h1>Refunds</h1><p>Returns are accepted for 30 days.</p><script>stealSecrets()</script><object>hidden</object></body></html>'), name: 'policy.html' })
    expect(chunks.map((item) => item.content).join(' ')).toContain('Returns are accepted')
    expect(chunks.map((item) => item.content).join(' ')).not.toContain('stealSecrets')
  })

  it('preserves spreadsheet sheet and row-group locations', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Plan', 'Price'], ['Starter', '9'], ['Team', '29']]), 'Pricing')
    const data = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const chunks = await parseKnowledgeDocument({ data, name: 'pricing.xlsx' })
    expect(chunks[0].location).toMatchObject({ kind: 'sheet', sheet: 'Pricing', row_start: 2, row_end: 3 })
    expect(chunks[0].content).toContain('Team | 29')
  })

  it('extracts PowerPoint slide text without executing package content', async () => {
    const archive = new JSZip()
    archive.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Safe slide text</a:t></p:sld>')
    const chunks = await parseKnowledgeDocument({ data: await archive.generateAsync({ type: 'nodebuffer' }), name: 'brief.pptx' })
    expect(chunks[0]).toMatchObject({ content: 'Safe slide text', location: { kind: 'slide', slide: 1 } })
  })

  it('rejects legacy Office, empty, malformed, and oversized inputs', async () => {
    await expect(parseKnowledgeDocument({ data: Buffer.from('legacy'), name: 'brief.doc' })).rejects.toMatchObject({ code: 'LEGACY_OFFICE_UNSUPPORTED' })
    await expect(parseKnowledgeDocument({ data: Buffer.alloc(0), name: 'empty.txt' })).rejects.toMatchObject({ code: 'DOCUMENT_EMPTY' })
    await expect(parseKnowledgeDocument({ data: Buffer.from('not-a-zip'), name: 'broken.pptx' })).rejects.toThrow()
    await expect(parseKnowledgeDocument({ data: Buffer.alloc(25 * 1024 * 1024 + 1), name: 'large.txt' })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })
})
