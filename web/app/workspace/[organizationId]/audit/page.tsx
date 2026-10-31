import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/auth/validation";
import { reportPeriod } from "@/lib/reporting";
import type { Json } from "@/lib/database.types";
import { ResponsiveTable } from "@/components/responsive-table";
export const instant = false;
export const metadata = {title:"Audit history"};
type Query = {actor?:string;action?:string;entity?:string;record?:string;from?:string;until?:string;cursor?:string};
const object = (value:Json): value is {[key:string]:Json|undefined} => value!==null&&typeof value==='object'&&!Array.isArray(value);
export default async function AuditPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<Query>}) {
  const {organizationId}=await params;
  const access=await workspaceRole(organizationId);
  if(!access.canAudit) notFound();
  const query=await searchParams;
  const base=`/workspace/${organizationId}`;
  let validation="";
  let from:string|undefined,until:string|undefined;
  if((query.actor&&!isUuid(query.actor))||(query.record&&!isUuid(query.record))) validation="Enter a valid actor or record ID.";
  try {
    if(query.from){reportPeriod(query.from,undefined,"daily");from=`${query.from}T00:00:00+01:00`;}
    if(query.until){reportPeriod(query.until,undefined,"daily");until=new Date(Date.parse(`${query.until}T00:00:00+01:00`)+86400000).toISOString();}
    if(from&&until&&Date.parse(from)>=Date.parse(until)) validation="The end date must be on or after the start date.";
  }catch{validation="Enter valid audit dates.";}
  if((query.cursor?.length??0)>1024) validation="The audit page link is invalid. Reset filters to continue.";
  const db=await createSupabaseServerClient();
  const people=await db.rpc("operating_people",{p_organization_id:organizationId});
  if(people.error) throw new Error("Could not load the audit actor directory.");
  const actorNames=new Map(people.data.map(person=>[person.user_id,person.display_name]));
  let events: {[key:string]:Json|undefined}[]=[];
  let next:string|undefined;
  if(!validation){
    const {data,error}=await db.rpc("search_audit_events",{p_organization_id:organizationId,p_limit:50,...(query.actor?{p_actor_id:query.actor}:{}),...(query.record?{p_entity_id:query.record}:{}),...(query.action?{p_action:query.action.slice(0,120)}:{}),...(query.entity?{p_entity_type:query.entity.slice(0,120)}:{}),...(query.cursor?{p_cursor:query.cursor}:{}),...(from?{p_from:from}:{}),...(until?{p_until:until}:{})});
    if(error) validation="Could not load audit history with these filters. Reset filters or try again.";
    else if(!data||!object(data)||!Array.isArray(data.events)) throw new Error("Invalid audit response.");
    else{events=data.events.filter(object);if(typeof data.next_cursor==='string')next=data.next_cursor;}
  }
  const nextParams=new URLSearchParams();
  for(const [key,value] of Object.entries(query))if(value&&key!=="cursor")nextParams.set(key,value);
  if(next)nextParams.set("cursor",next);
  const recordLink=(event:{[key:string]:Json|undefined})=>{
    const id=typeof event.entity_id==='string'&&isUuid(event.entity_id)?event.entity_id:undefined;
    if(!id)return undefined;
    switch(event.entity_type){
      case 'item':return `${base}/items/${id}`;
      case 'recipe':return `${base}/recipes/${id}`;
      case 'inventory_document':return `${base}/inventory?view=documents&document=${id}`;
      case 'purchase_order':return `${base}/purchasing?record=${id}`;
      case 'stock_requisition':return `${base}/requests?record=${id}`;
      case 'stock_count':return `${base}/counts?record=${id}`;
      default:return undefined;
    }
  };
  return <>
    <div className="page-heading"><div><p className="eyebrow">TRACE CHANGES AND DECISIONS</p><h1>Audit history</h1><p>Recorded actors, changes and approvals. Dates use Africa/Lagos.</p></div></div>
    <section className="panel"><form method="get" className="list-filters" aria-label="Audit filters">
      <label>Action<input name="action" defaultValue={query.action} maxLength={120} placeholder="Exact action name" /></label><label>Record type<input name="entity" defaultValue={query.entity} maxLength={120} /></label><label>Actor<select name="actor" defaultValue={query.actor??""}><option value="">All actors</option>{people.data.map(person=><option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label><label>Record ID<input name="record" defaultValue={query.record} /></label><label>From date<input type="date" name="from" defaultValue={query.from} /></label><label>Until date<input type="date" name="until" defaultValue={query.until} /></label><button className="button button-secondary">Filter audit history</button><Link className="text-link" href={`${base}/audit`}>Reset filters</Link>
    </form>{validation?<p className="notice notice-error" role="alert">{validation}</p>:<>
    <ResponsiveTable label="Audit events" localControls={false}><table className="inventory-table"><thead><tr><th>Recorded (Lagos)</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{events.map((event,index)=><tr key={String(event.id??index)}><td>{typeof event.created_at==='string'?new Date(event.created_at).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):"Unavailable"}</td><td>{event.actor_id ? (actorNames.get(String(event.actor_id)) ?? "Former team member") : "System"}</td><td>{String(event.action??"").replaceAll('_',' ')}</td><td>{recordLink(event)?<Link className="text-link" href={recordLink(event)!}>{String(event.entity_type)} · {String(event.entity_id)}</Link>:`${String(event.entity_type??"")} · ${String(event.entity_id??"")}`}</td><td><details><summary>View recorded change</summary><pre className="audit-json">{JSON.stringify(event.details??{},null,2)}</pre></details></td></tr>)}</tbody></table></ResponsiveTable>
    <nav className="list-pagination" aria-label="Audit pages">{query.cursor&&<Link className="text-link" href={`${base}/audit?${new URLSearchParams(Object.entries(query).filter(([k,v])=>k!=="cursor"&&Boolean(v)) as [string,string][])}`}>Newest matching events</Link>}{next&&<Link className="button button-secondary" href={`${base}/audit?${nextParams}`}>Older events</Link>}</nav>
    </>}</section>
  </>;
}
