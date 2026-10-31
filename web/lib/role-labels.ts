export const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  inventory_manager: "Storekeeper / Inventory Manager",
  procurement_officer: "Procurement Officer",
  kitchen_lead: "Kitchen Lead",
  bar_lead: "Bar Lead",
  accountant: "Accountant",
  viewer: "Viewer",
  operations_manager: "Operations Manager",
};
export const memberRoleOptions = Object.entries(roleLabels)
  .filter(
    ([key]) =>
      !["owner", "operations_manager", "general_manager"].includes(key),
  )
  .map(([value, label]) => ({ value, label }));
