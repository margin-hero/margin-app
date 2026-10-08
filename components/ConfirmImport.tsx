'use client'

import { useEffect, useState } from 'react'
import { ImportSummaryData } from '@/lib/importEngine'
import ImportSummary from '@/components/ImportSummary'
import { muted, primaryButton, statusColor } from '@/lib/theme'

// The Confirm import button for every import page. While the import runs the button is
// locked (a second click mid-import would race the duplicate check) and progress is shown
// right under it, where you are when you click; the results appear there too.
//
// run(progress) does the import and returns either the results (one per store) or a
// message to show instead (e.g. "Please choose a store first").
export default function ConfirmImport({
  label = 'Confirm import (every order line in the file, not just the ones shown)',
  run,
  resetOn,
}: {
  label?: string
  run: (progress: (message: string) => void) => Promise<ImportSummaryData[] | string>
  resetOn?: unknown // when this changes (e.g. a new file's orders), old results are cleared
}) {
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<ImportSummaryData[]>([])

  useEffect(() => {
    setResults([])
    setMessage('')
  }, [resetOn])

  async function handleClick() {
    if (importing) return
    setImporting(true)
    setResults([])
    setMessage('')
    try {
      const outcome = await run(setMessage)
      if (typeof outcome === 'string') {
        setMessage(outcome)
      } else {
        setResults(outcome)
        setMessage('')
      }
    } catch (err) {
      setMessage(`Error: the import stopped: ${err instanceof Error ? err.message : String(err)}. Uploading the same file again is safe: already-imported orders are skipped.`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={importing}
        style={{ ...primaryButton, marginTop: '18px', ...(importing ? { opacity: 0.6, cursor: 'wait' } : {}) }}
      >
        {importing ? 'Importing, please wait...' : label}
      </button>
      {message && (
        <p style={{ color: importing ? muted : statusColor(message), fontSize: '14px', fontWeight: 600, margin: '14px 0 0', lineHeight: 1.5 }}>
          {message}
        </p>
      )}
      {results.map((r) => <ImportSummary key={r.headline} summary={r} />)}
    </>
  )
}
