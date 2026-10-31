import { Children, Fragment, isValidElement, type ReactNode, type ReactElement } from "react";
import { DataTable } from "./data-table";
type Element = ReactElement<{children?:ReactNode;className?:string;"aria-label"?:string;"data-sort"?:string}>;
function elements(children: ReactNode): Element[] {
  return Children.toArray(children).flatMap(child => isValidElement(child) ? child.type===Fragment ? elements((child as Element).props.children) : [child as Element] : []);
}
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child==='string'||typeof child==='number'?String(child):isValidElement(child)?text((child as Element).props.children):"").join(" ").replace(/\s+/g," ").trim();
}
/** Turn server-rendered, authorized table rows into a shared sortable and responsive table. */
export function ResponsiveTable({children,label="Records",localControls=true}:{children:ReactNode;label?:string;localControls?:boolean}) {
  const table = elements(children).find(e=>e.type==='table');
  if (!table) return children;
  const parts=elements(table.props.children);
  const header=parts.find(e=>e.type==='thead');
  const body=parts.find(e=>e.type==='tbody');
  const headers=elements(elements(header?.props.children)[0]?.props.children);
  const columns=headers.map(h=>{const label=text(h.props.children);return {label,numeric:Boolean(h.props.className?.split(" ").includes("numeric")) || /quantity|\bqty\b|cost|price|value|margin|profit|revenue|net sales|opening|closing|reserved|available|requested|dispatched|awaiting|accepted|rejected|returned|received|pending|outstanding|physical|variance|^book$|base units|base quantity|factor|revision|^lines$/i.test(label)&&!/^item|^vendor/.test(label.toLowerCase())};});
  const rows=elements(body?.props.children).filter(e=>e.type==='tr').map((row,index)=>{
    const cellElements=elements(row.props.children);
    const cells=cellElements.map(cell=>cell.props.children);
    return {key:String(row.key??index),cells,text:cellElements.map(cell => cell.props['data-sort'] ?? text(cell.props.children))};
  });
  return <DataTable label={table.props['aria-label']??label} className={table.props.className} columns={columns} rows={rows} localControls={localControls} />;
}
