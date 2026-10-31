/** Compare displayed decimals without Number rounding, including NGN currency and quantity units. */
export function compareTableValues(a: string, b: string, numeric: boolean) {
  if (numeric) {
    const decimal = /^(-?)(\d+)(?:\.(\d+))?/;
    const clean = (value: string) => value.replaceAll(",", "").replaceAll("₦", "").replace(/^NGN\s*/i, "").trim();
    const left = decimal.exec(clean(a)), right = decimal.exec(clean(b));
    if (left && right) {
      const places = Math.max(left[3]?.length ?? 0, right[3]?.length ?? 0);
      const scaled = (m: RegExpExecArray) => BigInt(`${m[1]}${m[2]}${(m[3] ?? "").padEnd(places, "0")}`);
      const x = scaled(left), y = scaled(right);
      return x < y ? -1 : x > y ? 1 : 0;
    }
  }
  const timestamp = (value: string) => {
    const date = /^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    return date ? Date.UTC(Number(date[3]), Number(date[2])-1, Number(date[1]), Number(date[4]??0), Number(date[5]??0), Number(date[6]??0)) : NaN;
  };
  const x = timestamp(a), y = timestamp(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x-y;
  return a.localeCompare(b, undefined, {numeric:true});
}
