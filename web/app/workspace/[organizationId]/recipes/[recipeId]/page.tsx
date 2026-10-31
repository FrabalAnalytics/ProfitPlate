import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/auth/validation";
import { readAll } from "@/lib/read-all";
import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import { BusinessForm, hiddenField } from "@/components/business-form";
import { ResponsiveTable } from "@/components/responsive-table";
export const instant = false;
export const metadata = {title:"Recipe details"};
export default async function RecipePage({params,searchParams}:{params:Promise<{organizationId:string;recipeId:string}>;searchParams:Promise<{version?:string}>}) {
  const {organizationId,recipeId}=await params;
  const query=await searchParams;
  if(!isUuid(recipeId)||(query.version&&!isUuid(query.version))) notFound();
  const access=await workspaceRole(organizationId);
  const db=await createSupabaseServerClient();
  const [recipe,versions,items]=await Promise.all([
    db.from("recipes").select("*").eq("organization_id",organizationId).eq("id",recipeId).maybeSingle(),
    readAll(db.from("recipe_versions").select("id,revision,standard_output::text,created_at",{count:"exact"}).eq("organization_id",organizationId).eq("recipe_id",recipeId).order("revision",{ascending:false}).order("id")),
    readAll(db.from("items").select("id,name,sku,stock_unit_label,base_uom_code,is_active,category",{count:"exact"}).eq("organization_id",organizationId).order("name").order("id")),
  ]);
  if(recipe.error||versions.error||items.error) throw new Error("Could not load the complete recipe definition.");
  if(!recipe.data) notFound();
  const version=versions.data.find(v=>v.id===(query.version??versions.data[0]?.id));
  if(!version) notFound();
  const ingredients=await readAll(db.from("recipe_ingredients").select("item_id,quantity::text",{count:"exact"}).eq("organization_id",organizationId).eq("version_id",version.id).order("item_id"));
  if(ingredients.error) throw new Error("Could not load all ingredients. Refresh before revising this recipe.");
  const current=version.id===versions.data[0]?.id;
  const live=current?await db.rpc("current_recipe_cost",{p_organization_id:organizationId,p_recipe_id:recipeId}):null;
  if(live?.error) throw new Error("Could not load the current recipe cost.");
  const cost=live?.data;
  const canEdit=["owner","admin","inventory_manager","kitchen_lead"].includes(access.primaryRole)||access.isManager;
  const names=new Map(items.data.map(i=>[i.id,i]));
  return <>
    <Link className="text-link" href={`/workspace/${organizationId}/inventory?view=recipes`}>Back to recipes</Link>
    <div className="page-heading"><div><p className="eyebrow">RECIPE DEFINITION</p><h1>{recipe.data.name}</h1><p>{recipe.data.code} · {recipe.data.kind.replaceAll("_"," ")}</p></div><span className="role-pill">Version {version.revision}{current?" · Current":" · Historical"}</span></div>
    <div className="inventory-sections"><section className="panel"><h2>Ingredients and yield</h2><p className="inventory-intro">Standard output: {formatInventoryNumber(version.standard_output)} {recipe.data.kind==="final"?"portions":"stock units"}. Ingredient quantities below cover this entire yield.</p>
    <form method="get" className="list-filters"><label>Recipe version<select name="version" defaultValue={version.id}>{versions.data.map(v=><option key={v.id} value={v.id}>Version {v.revision}{v.id===versions.data[0]?.id?" · Current":""}</option>)}</select></label><button className="button button-secondary">View version</button></form>
    <ResponsiveTable label="Recipe ingredients"><table className="inventory-table"><thead><tr><th>Ingredient</th><th>SKU</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>{ingredients.data.map(line=><tr key={line.item_id}><td>{names.get(line.item_id)?.name??"Unavailable item"}</td><td>{names.get(line.item_id)?.sku}</td><td>{formatInventoryNumber(line.quantity)}</td><td>{names.get(line.item_id)?.stock_unit_label??names.get(line.item_id)?.base_uom_code}</td></tr>)}</tbody></table></ResponsiveTable>
    <p className="inventory-intro">{current?`Current recipe unit cost (NGN): ${cost&&typeof cost==='object'&&!Array.isArray(cost)&&cost.complete?formatAmount(String(cost.unit_cost)):"Incomplete — ingredient costs missing"}. This live benchmark does not change historical posting costs.`:"This is an immutable historical definition. Current live costing is available on the current version."}</p></section>
    {canEdit&&<section className="panel inventory-form-panel"><h2>Revise this recipe</h2><p className="inventory-intro">This copies the selected definition into a new version. Review the full ingredient list before saving. Existing versions and historical transactions are preserved.</p><BusinessForm key={version.id} organizationId={organizationId} intent="revise_recipe" button="Save new version" fields={[hiddenField("id",recipeId),hiddenField("return_to","recipe_details"),{name:"standard_output",label:"Standard output quantity",value:version.standard_output}]} items={items.data.filter(i=>i.category!=="general"&&(i.is_active||ingredients.data.some(l=>l.item_id===i.id))).map(i=>({value:i.id,label:`${i.name} (${i.stock_unit_label??i.base_uom_code})${i.is_active?"":" · Inactive"}`,keywords:i.sku}))} initialLines={ingredients.data.map(l=>({item_id:l.item_id,quantity:l.quantity}))} /></section>}
    </div>
  </>;
}
