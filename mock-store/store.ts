import { readFileSync } from "node:fs";

export interface LineItem {
  id: string;
  sku: string;
  quantity: number;
}
export type Order = {
  id: string;
  name: string;
  lineItems: LineItem[];
};

export type Session = {
  id: string;
  orderId: string;
  lineItems: LineItem[];
  changed: Set<string>;
};

const SEED = new URL("../fixtures/sample-orders.anon.csv", import.meta.url);

export function loadOrders(): Order[] {
  const [header, ...rows] = readFileSync(SEED, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(","));

  const col = (name: string) => header!.indexOf(name);
  const byPo = new Map<string, LineItem[]>();

  for (const row of rows) {
    const po = row[col("PO No.")];
    if (!po || !row[col("Item")]) continue;
    const lines = byPo.get(po) ?? [];
    lines.push({
      id: `gid://toy-shop/LineItem/${po}${lines.length + 1}`,
      sku: row[col("Item")]!,
      quantity: Number(row[col("Pieces Ordered")]),
    });
    byPo.set(po, lines);
  }
  return [...byPo].map(([po, lineItems]) => ({
    id: `gid://toy-shop/Order/${po}`,
    name: `#${po}`,
    lineItems,
  }));
}
