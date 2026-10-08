// Supabase returns at most 1,000 rows per request, and silently drops the rest.
// fetchAll asks for 1,000 rows at a time until it has them all.
//
// Usage — the query MUST be ordered by something unique (e.g. id), or rows can be
// skipped or repeated between pages:
//
//   const { data, error } = await fetchAll((from, to) =>
//     supabase.from('order_margins').select('...').order('order_line_item_id').range(from, to)
//   )

const PAGE_SIZE = 1000

// For the big margin views (margin_lines): fetches 1,000 rows at a time by ID ("the next
// 1,000 after the last one seen") instead of by row number. With row numbers (.range) the
// database works out every row before the page just to find where the page starts, so the
// work repeats on every page; by ID, each row is worked out once. Much faster on big ranges.
//
// query() builds the query with its select and filters (the select MUST include idColumn);
// fetchAllById adds the ordering, the "after" filter and the page size itself:
//
//   const { data, error } = await fetchAllById('order_line_item_id', () =>
//     supabase.from('margin_lines').select('order_line_item_id, ...').gte('order_date', from)
//   )
export async function fetchAllById<T = any>(
  idColumn: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: () => any
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = []
  let after: string | null = null
  for (;;) {
    let q = query()
    if (after !== null) q = q.gt(idColumn, after)
    const { data, error } = (await q.order(idColumn).limit(PAGE_SIZE)) as { data: T[] | null; error: { message: string } | null }
    if (error) return { data: all, error }
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) return { data: all, error: null }
    after = String((data[data.length - 1] as Record<string, unknown>)[idColumn])
  }
}

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) return { data: all, error }
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) return { data: all, error: null }
  }
}
