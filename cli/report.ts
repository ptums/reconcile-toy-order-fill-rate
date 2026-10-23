import { readFileSync } from "node:fs";

// One order from the report, with the quantity each line must have.
export interface ReportOrder {
  orderId: string; // "gid://toy-shop/Order/1001"
  lines: { sku: string; quantity: number }[]; // quantity: Pieces Shipped, always absolute
}

export function readReport(path: string): ReportOrder[] {
  const [header, ...rows] = readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(","));

  const col = (name: string) => header!.indexOf(name);
  const byPo = new Map<string, ReportOrder>();

  for (const row of rows) {
    const po = row[col("PO No.")];
    const sku = row[col("Item")];
    if (!po || !sku) continue; // the total rows have no Item
    const order = byPo.get(po) ?? {
      orderId: `gid://toy-shop/Order/${po}`,
      lines: [],
    };
    order.lines.push({ sku, quantity: Number(row[col("Pieces Shipped")]) });
    byPo.set(po, order);
  }
  return [...byPo.values()];
}
