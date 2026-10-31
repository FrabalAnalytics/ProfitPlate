type PageResult<T> = { data: T[] | null; error: unknown; count: number | null };
type Query<T> = PromiseLike<PageResult<T>> & {
  range(from: number, to: number): PromiseLike<PageResult<T>>;
};

/** Read every authorized row, including when the API caps responses below the requested size.
 * Callers must request count: exact and order by a stable, unique key. Never cache permissions.
 * An incomplete read returns no rows, so review/approval screens fail closed.
 */
export async function readAll<T>(query: Query<T>): Promise<{ data: T[]; error: unknown; count: number }> {
  const data: T[] = [];
  let total: number | undefined;
  try {
    for (;;) {
      const page = await query.range(data.length, data.length + 199);
      if (page.error) throw page.error;
      if (page.count === null || !Number.isSafeInteger(page.count) || page.count < 0)
        throw new Error("Could not verify the complete record count.");
      if (total !== undefined && page.count !== total)
        throw new Error("Records changed while loading. Refresh to review the complete list.");
      total = page.count;
      if (!page.data || (!page.data.length && data.length < total))
        throw new Error("Some record details could not be loaded. Refresh before continuing.");
      data.push(...page.data);
      if (data.length === total) return { data, error: null, count: total };
      if (data.length > total) throw new Error("Record count did not match the loaded details.");
    }
  } catch (error) {
    return { data: [], error, count: 0 };
  }
}
