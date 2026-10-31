import Link from "next/link";
import { listState, pageSize, type ListQuery } from "@/lib/list-query";
export function ListControls({ query, total, statuses = [], label = "records", searchable = true }: {
  query: ListQuery & Record<string, string | undefined>;
  total: number; statuses?: string[]; label?: string; searchable?: boolean;
}) {
  const { page, q, status } = listState(query);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (next: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value && !["page", "saved", "received", "completed", "record"].includes(key)) params.set(key, value);
    params.set("page", String(next));
    return `?${params}`;
  };
  return <div className="list-controls">
    {searchable && <form method="get" className="list-filters" aria-label={`Filter ${label}`}>
      {Object.entries(query).filter(([key, value]) => value && !["page", "q", "status", "saved", "received", "completed", "record"].includes(key)).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      <label>Search {label}<input name="q" type="search" defaultValue={q} placeholder="Search reference or name" maxLength={100} /></label>
      {statuses.length > 0 && <label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>}
      <button className="button button-secondary">Apply filters</button>
    </form>}
    <nav className="list-pagination" aria-label={`${label} pages`}>
      <span>{total === 0 ? `No matching ${label}` : `${total} ${label} · Page ${page} of ${pages}`}</span>
      {page > 1 && <Link className="button button-secondary" href={href(page - 1)}>Previous page</Link>}
      {page < pages && <Link className="button button-secondary" href={href(page + 1)}>Next page</Link>}
      {page > pages && <Link className="text-link" href={href(1)}>Return to first page</Link>}
    </nav>
  </div>;
}
