import "server-only";

export function applicationOrigin() {
  const raw =
    process.env.APP_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!raw)
    throw new Error("APP_URL must be configured for authentication emails.");
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  ) {
    throw new Error("APP_URL must be a trusted application origin.");
  }
  return url.origin;
}
