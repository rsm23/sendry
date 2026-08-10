import * as XLSX from 'xlsx'

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const workbook = XLSX.read(event.data, { type: 'array', cellFormula: true, cellStyles: true, cellDates: true, dense: true })
    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name]
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, raw: false, defval: '' })
      const columns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
      if (rows.length * columns > 1_000_000 || rows.length > 100_000 || columns > 2_000) throw new Error('Workbook exceeds the safe browser grid limit')
      return { name, rows, merges: (sheet['!merges'] ?? []).map((merge) => XLSX.utils.encode_range(merge)) }
    })
    self.postMessage({ sheets })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Workbook parsing failed' })
  }
}
