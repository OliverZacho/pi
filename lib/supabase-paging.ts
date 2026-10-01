import type { PostgrestError } from "@supabase/supabase-js";

/**
 * PostgREST's max rows per response (Supabase default). Every select is cut
 * off here whatever `.limit()` asks for, silently and without an error.
 */
export const POSTGREST_MAX_ROWS = 1000;

/**
 * Every row a query matches, read one capped page at a time.
 *
 * `page` builds the query for one `.range(from, to)` window. It must apply a
 * total order (end the `.order()` chain on a unique column such as `id`), or
 * rows can repeat or go missing between pages. Pages are read sequentially:
 * use this for lists that are usually one or two pages, and push anything
 * that only exists to aggregate into SQL instead.
 */
export async function fetchAllRows<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += POSTGREST_MAX_ROWS) {
    const { data, error } = await page(from, from + POSTGREST_MAX_ROWS - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < POSTGREST_MAX_ROWS) return rows;
  }
}
