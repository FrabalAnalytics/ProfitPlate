"use client";
import { useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { compareTableValues } from "@/lib/table-sort";
const phoneQuery = "(max-width: 600px)";
const subscribePhone = (notify: () => void) => { const media=window.matchMedia(phoneQuery);media.addEventListener("change",notify);return ()=>media.removeEventListener("change",notify); };
const isPhone = () => window.matchMedia(phoneQuery).matches;
type Column = { label: string; numeric: boolean };
type Row = { key: string; cells: ReactNode[]; text: string[] };
export function DataTable({label, columns, rows, className = "inventory-table", localControls = true}: {label:string;columns:Column[];rows:Row[];className?:string;localControls?:boolean}) {
  const id = useId();
  const phone=useSyncExternalStore(subscribePhone,isPhone,()=>false);
  const [search,setSearch] = useState("");
  const [page,setPage] = useState(1);
  const [size,setSize] = useState(25);
  const [sort,setSort] = useState<{column:number;direction:1|-1} | null>(null);
  const filtered = useMemo(() => {
    const result = rows.filter(row => row.text.join(" ").toLowerCase().includes(search.trim().toLowerCase()));
    if (sort) result.sort((a,b) => compareTableValues(a.text[sort.column] ?? "",b.text[sort.column] ?? "", columns[sort.column].numeric)*sort.direction);
    return result;
  },[rows,columns,search,sort]);
  const pages = Math.max(1,Math.ceil(filtered.length/size));
  const current = Math.min(page,pages);
  const visible = localControls ? filtered.slice((current-1)*size,current*size) : filtered;
  return <div className="data-table-browser">
    <label className="mobile-table-sort" htmlFor={`${id}-sort`}>{localControls ? "Sort records" : "Sort this page"}<select id={`${id}-sort`} value={sort?`${sort.column}:${sort.direction}`:""} onChange={event=>{const [column,direction]=event.target.value.split(":");setSort(event.target.value?{column:Number(column),direction:Number(direction) as 1|-1}:null);setPage(1);}}><option value="">Original order</option>{columns.flatMap((column,index)=>[<option key={`${index}:1`} value={`${index}:1`}>{column.label} · Ascending</option>,<option key={`${index}:-1`} value={`${index}:-1`}>{column.label} · Descending</option>])}</select></label>
    {localControls && rows.length > 15 && <div className="table-toolbar">
      <label htmlFor={`${id}-search`}>Search {label}<input id={`${id}-search`} type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search these records" /></label>
      <label htmlFor={`${id}-size`}>Rows per page<select id={`${id}-size`} value={size} onChange={e=>{setSize(Number(e.target.value));setPage(1);}}>{[25,50,100,200].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
    </div>}
    <p className="table-scroll-hint">Scroll across the table to view additional columns.</p>
    <div className="inventory-table-wrap" role="region" aria-label={`${label} table`} tabIndex={0}>
      <table className={`${className} data-table`} aria-label={label}>
        <caption className="sr-only">{label}</caption>
        <thead><tr>{columns.map((column,index)=><th key={index} scope="col" className={column.numeric?"numeric":undefined} aria-sort={sort?.column===index?(sort.direction===1?"ascending":"descending"):"none"}><button type="button" tabIndex={phone?-1:0} title={localControls ? undefined : "Sort this page"} className="column-sort" onClick={()=>{setSort({column:index,direction:sort?.column===index&&sort.direction===1?-1:1});setPage(1);}}>{column.label}<span aria-hidden="true">{sort?.column===index?(sort.direction===1?" ↑":" ↓"):" ↕"}</span></button></th>)}</tr></thead>
        <tbody>{visible.map(row=><tr key={row.key}>{row.cells.map((cell,index)=><td key={index} data-label={columns[index]?.label} className={columns[index]?.numeric?"numeric":undefined}>{cell}</td>)}</tr>)}</tbody>
      </table>
      {!filtered.length && <p className="inventory-empty" role="status">{rows.length?"No matching records. Try another search.":"No records yet."}</p>}
    </div>
    {localControls && rows.length > 15 && <div className="table-pagination"><p role="status">Showing {filtered.length?((current-1)*size+1):0}–{Math.min(current*size,filtered.length)} of {filtered.length} records</p><nav aria-label={`${label} table pages`}><button type="button" className="button button-secondary" disabled={current===1} onClick={()=>setPage(current-1)}>Previous rows</button><button type="button" className="button button-secondary" disabled={current===pages} onClick={()=>setPage(current+1)}>Next rows</button></nav><p className="field-help">Search and sorting change this display only. Transaction actions apply to the complete record.</p></div>}
  </div>;
}
