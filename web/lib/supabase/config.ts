export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase connection is not configured.");
  if (key.startsWith("sb_secret_"))
    throw new Error("A public Supabase key is required.");
  if (key.split(".").length === 3) {
    let role: unknown;
    try {
      role = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ).role;
    } catch {
      throw new Error("The Supabase public key is invalid.");
    }
    if (role !== "anon") throw new Error("A public Supabase key is required.");
  }
  return { url, key };
}
