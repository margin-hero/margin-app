import Papa from 'papaparse'
import * as XLSX from 'xlsx'

// Reads a CSV or Excel (.xlsx/.xls, first sheet) file into rows of plain text,
// keyed by the (trimmed) column headings in the first row.
// - CSV goes through Papa so every cell is the exact text in the file
//   (e.g. SKU "00123" keeps its leading zeros).
// - Excel date cells in `dateColumns` are turned into YYYY-MM-DD.
// - `headerStartsWith`: for files with notes above the table (e.g. eBay), the heading row
//   is the first row whose first cell is this text; everything above it is ignored.
// - `sheetWithColumn`: for Excel files with several tabs (e.g. TikTok's statement), read the
//   first tab whose heading row has this column, wherever it is. Default: the first tab.
// - Long IDs: an Excel number too big to hold exactly (e.g. TikTok's 19-digit IDs saved as
//   numbers, usually after opening a CSV in Excel) is an error, never a silently rounded ID.
export function readSpreadsheet(
  file: File,
  dateColumns: string[] = [],
  options: { headerStartsWith?: string; sheetWithColumn?: string } = {}
): Promise<Record<string, string>[]> {
  if (options.headerStartsWith) return readWithHeaderRow(file, options.headerStartsWith, dateColumns)
  if (/\.xlsx?$/i.test(file.name)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const workbook = XLSX.read(event.target?.result, { type: 'array' })
          const sheetName = options.sheetWithColumn
            ? workbook.SheetNames.find((name) => {
                const firstRow = (XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })[0] || []) as unknown[]
                return firstRow.some((cell) => String(cell ?? '').trim() === options.sheetWithColumn)
              })
            : workbook.SheetNames[0]
          if (!sheetName) throw new Error(`no tab has a "${options.sheetWithColumn}" column`)
          const sheet = workbook.Sheets[sheetName]
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

// Reads the file as a grid, finds the heading row and turns the rows below it into objects
function readWithHeaderRow(file: File, headerStartsWith: string, dateColumns: string[]): Promise<Record<string, string>[]> {
  const toRows = (grid: unknown[][]) => {
    const headerIndex = grid.findIndex((r) => String(r[0] ?? '').trim() === headerStartsWith)
    if (headerIndex < 0) throw new Error(`no heading row starting "${headerStartsWith}"`)
    const headers = grid[headerIndex].map((h) => String(h ?? '').trim())
    return grid
      .slice(headerIndex + 1)
      .filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, cellToText(h, r[i], dateColumns)])))
  }

  if (/\.xlsx?$/i.test(file.name)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const workbook = XLSX.read(event.target?.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          resolve(toRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })))
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(file)
    })
  }

  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          resolve(toRows(results.data))
        } catch (err) {
          reject(err)
        }
      },
      error: reject,
    })
  })
}

// Excel stores dates as serial numbers (e.g. 46279) — turn those back into YYYY-MM-DD,
// and turn every other cell into plain text so both file types look the same.
function cellToText(key: string, value: unknown, dateColumns: string[]): string {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new Error(
      `the "${key}" column has long ID numbers stored as numbers, so they've been rounded and can't be matched. ` +
      'This usually happens when a CSV is opened and saved in Excel. Download the report again and upload it without opening it in Excel.'
    )
  }
  if (dateColumns.includes(key) && typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  return String(value ?? '').trim()
}

// A typed date from a spreadsheet -> "YYYY-MM-DD", or null if it isn't a real date.
// Accepts 2026-09-01, and UK day-first 01-09-2026 / 01/09/2026 / 1/9/2026 (any time after
// the date is ignored). Never US month-first.
export function toIsoDate(text: string): string | null {
  const value = (text || '').trim()
  let y: string, m: string, d: string
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  const uk = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/)
  if (iso) [, y, m, d] = iso
  else if (uk) [, d, m, y] = uk
  else return null
  const result = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  // Reject impossible dates like 31-02-2026
  const check = new Date(`${result}T00:00:00Z`)
  return !isNaN(check.getTime()) && check.toISOString().slice(0, 10) === result ? result : null
}
