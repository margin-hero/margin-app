import Papa from 'papaparse'
import * as XLSX from 'xlsx'

// Reads a CSV or Excel (.xlsx/.xls, first sheet) file into rows of plain text,
// keyed by the (trimmed) column headings in the first row.
// - CSV goes through Papa so every cell is the exact text in the file
//   (e.g. SKU "00123" keeps its leading zeros).
// - Excel date cells in `dateColumns` are turned into YYYY-MM-DD.
export function readSpreadsheet(file: File, dateColumns: string[] = []): Promise<Record<string, string>[]> {
  if (/\.xlsx?$/i.test(file.name)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const workbook = XLSX.read(event.target?.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          resolve(raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), cellToText(k.trim(), v, dateColumns)]))))
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(file)
    })
  }

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => resolve(results.data),
      error: reject,
    })
  })
}

// Excel stores dates as serial numbers (e.g. 46279) — turn those back into YYYY-MM-DD,
// and turn every other cell into plain text so both file types look the same.
function cellToText(key: string, value: unknown, dateColumns: string[]): string {
  if (dateColumns.includes(key) && typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  return String(value ?? '').trim()
}
