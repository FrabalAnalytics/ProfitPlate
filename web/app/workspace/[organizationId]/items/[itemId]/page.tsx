import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/auth/validation";
import { BusinessForm, hiddenField, activeField } from "@/components/business-form";
export const instant = false;
export const metadata = {title:"Item details"};
export default async function ItemPage({params,searchParams}:{params:Promise<{organizationId:string;itemId:string}>;searchParams:Promise<{saved?:string}>}) {
  const {organizationId,itemId}=await params;
  if (!isUuid(itemId)) notFound();
  const access=await workspaceRole(organizationId);
  const db=await createSupabaseServerClient();
  const {data:item,error}=await db.from("items").select("id,sku,name,base_uom_code,stock_unit_label,category,is_active").eq("organization_id",organizationId).eq("id",itemId).maybeSingle();
  if(error) throw new Error("Could not load this item.");
  if(!item) notFound();
  const canEdit=["owner","admin","inventory_manager"].includes(access.primaryRole);
  return <>
    <Link className="text-link" href={`/workspace/${organizationId}/inventory?view=items`}>Back to item catalogue</Link>
    <div className="page-heading"><div><p className="eyebrow">ITEM DETAILS</p><h1>{item.name}</h1><p>{item.sku} · {item.category.replaceAll("_"," ")} · {item.stock_unit_label??item.base_uom_code}</p></div><span className="role-pill">{item.is_active?"Active":"Inactive"}</span></div>
    {(await searchParams).saved&&<p className="notice notice-success" role="status">Item details saved.</p>}
    <section className="panel settings-panel"><h2>{canEdit?"Edit item":"Item information"}</h2><p className="inventory-intro">The base unit is {item.base_uom_code}. Deactivation preserves this item and its historical transactions.</p>
    {canEdit?<BusinessForm organizationId={organizationId} intent="update_item" button="Save item changes" fields={[hiddenField("id",item.id),{name:"name",label:"Item name",value:item.name},{name:"sku",label:"SKU",value:item.sku,help:"Codes remain subject to the existing uniqueness and reservation rules."},{...activeField,value:String(item.is_active)}]} />:<p>Your role can view this item. An authorized administrator or inventory manager maintains its details.</p>}
    </section>
  </>;
}
