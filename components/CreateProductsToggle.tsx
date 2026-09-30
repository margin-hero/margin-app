'use client'

// Tick-box shown on every sales import page. Off by default, so unmapped SKUs are
// held back and listed instead of creating products you'd have to tidy up later.
export default function CreateProductsToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: 'block', marginTop: '12px', fontSize: '14px', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginRight: '8px' }} />
      Create new products for SKUs that aren&apos;t mapped yet
      <span style={{ display: 'block', fontSize: '12px', opacity: 0.7, marginLeft: '24px' }}>
        Leave unticked to hold those orders back and list the SKUs, so you can map them first (recommended).
      </span>
    </label>
  )
}
