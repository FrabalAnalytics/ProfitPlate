export type ListQuery = { page?: string; q?: string; status?: string; record?: string };
export const pageSize = 25;
export function listState(query: ListQuery) {
  const n = Number(query.page);
  const page = Number.isSafeInteger(n) && n > 0 ? Math.min(n, 1000000) : 1;
  return { page, from: (page - 1) * pageSize, to: page * pageSize - 1, q: (query.q ?? "").trim().slice(0, 100), status: query.status ?? "" };
}
export const likeSearch = (query: string) => `%${query.replace(/[\\%_]/g, "\\$&")}%`;
// Column names are application constants; strip PostgREST expression delimiters from user text.
export const orSearch = (columns: string[], query: string) => columns.map(column => `${column}.ilike.${likeSearch(query.replace(/[(),."\\]/g, " "))}`).join(",");
export function recordHref(path: string, query: Record<string,string|undefined>, record?: string) {
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(query))if(value&&!['record','saved','received','completed','vendor'].includes(key))params.set(key,value);
  if(record)params.set('record',record);
  return `${path}${params.size?`?${params}`:''}`;
}
