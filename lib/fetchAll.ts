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
