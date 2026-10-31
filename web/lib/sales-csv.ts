export type ImportedSale = {
  external_id: string;
  menu_code: string;
  quantity: string;
  location: string;
  net_sales?: string;
};
/** Strict CSV reader: quoted fields/escaped quotes/CRLF supported; one event date per import. */
export function parseSalesCsv(text: string): ImportedSale[] {
  if (new TextEncoder().encode(text).length > 200000)
    throw new Error("Use a CSV file smaller than 200 KB.");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw new Error("Invalid CSV quoting.");
      quoted = true;
      continue;
    }
    if (c === "," || c === "\n" || c === "\r") {
      row.push(field.trim());
      field = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      if (closed && !/\s/.test(c))
        throw new Error("Unexpected text after a quoted CSV field.");
      if (!closed) field += c;
    }
  }
  if (quoted) throw new Error("A CSV quoted field was not closed.");
  if (field || row.length) {
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  const expected = ["external_id", "menu_code", "quantity", "location"];
  const headers = rows.shift()?.map((h) => h.toLowerCase());
  if (
    !headers ||
    ![4, 5].includes(headers.length) ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !expected.includes(h) && h !== "net_sales") ||
    expected.some((h) => !headers.includes(h))
  )
    throw new Error(
      "CSV headers must be external_id, menu_code, quantity, location, with optional net_sales.",
    );
  if (rows.length < 1 || rows.length > 500)
    throw new Error("Import between 1 and 500 sales lines at a time.");
  const seen = new Set<string>();
  return rows.map((r, index) => {
    if (r.length !== headers.length)
      throw new Error(`Row ${index + 2} has the wrong number of columns.`);
    const obj = Object.fromEntries(
      headers.map((h, i) => [h, r[i]]),
    ) as ImportedSale;
    if (
      !obj.external_id ||
      obj.external_id.length > 160 ||
      !obj.menu_code ||
      obj.menu_code.length > 64 ||
      !obj.location ||
      !/^\d+(\.\d{1,6})?$/.test(obj.quantity) ||
      !/[1-9]/.test(obj.quantity)
    )
      throw new Error(
        `Row ${index + 2} needs an ID, menu code, location and positive decimal quantity.`,
      );
    if (seen.has(obj.external_id))
      throw new Error(`Row ${index + 2} repeats a source line ID.`);
    seen.add(obj.external_id);
    if (obj.net_sales === "") delete obj.net_sales;
    if (
      obj.net_sales !== undefined &&
      (!/^\d+(\.\d{1,8})?$/.test(obj.net_sales) || Number(obj.net_sales) > 1e12)
    )
      throw new Error(
        `Row ${index + 2} needs nonnegative net sales after discounts, excluding tax. Use a plain decimal with at most 8 decimal places.`,
      );
    return obj;
  });
}
