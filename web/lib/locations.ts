export function canManageLocations(role: string) {
  return role === "owner" || role === "admin";
}

export type LocationFormState = { error?: string };
