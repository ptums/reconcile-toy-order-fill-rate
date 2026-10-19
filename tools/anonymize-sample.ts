/**
 * Make an anonymized copy of the supplier fill-rate report.
 *
 * The output keeps the columns, the row count, the quantities, the fill rates and the
 * subtotal rows. It replaces every customer, ship-to, PO, order, item code and item
 * description, and it changes the prices. The original file is not changed.
 *
 * Usage: pnpm --filter @reconcile/tools anonymize SAMPLE.XLSX ../fixtures/sample-orders.anon.csv
 *    or: pnpm exec tsx tools/anonymize-sample.ts SAMPLE.XLSX fixtures/sample-orders.anon.csv
 *
 * The Python version (until commit daefe65) used Python's random module. This port uses
 * its own seeded generator, so the same seed gives different fake values. The rules
 * (what is kept and what is replaced) are the same.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { strFromU8, unzipSync } from "fflate";

const SEED = 2021;

const ADJECTIVES = ["Classic", "Deluxe", "Mini", "Mega", "Starter", "Creative", "Junior", "Pro",
  "Rainbow", "Turbo", "Cosmic", "Forest", "Ocean", "City", "Castle", "Arctic"];
const THEMES = ["Brick", "Builder", "Robot", "Racer", "Train", "Rocket", "Farm", "Dino",
  "Pirate", "Garden", "Space", "Knight", "Harbor", "Jungle", "Fire Station", "Bakery"];
const KINDS = ["Set", "Box", "Kit", "Bundle", "Playset", "Pack", "Bucket", "Collection"];

type Row = string[];

/** A small seeded generator (mulberry32). Same seed, same sequence. */
class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** `k` distinct integers from [start, stop), like Python's random.sample(range(start, stop), k). */
  sample(start: number, stop: number, k: number): number[] {
    const size = stop - start;
    if (k > size) throw new Error("Sample larger than population");
    const picked = new Set<number>();
    const out: number[] = [];
    while (out.length < k) {
      const n = start + Math.floor(this.random() * size);
      if (!picked.has(n)) {
        picked.add(n);
        out.push(n);
      }
    }
    return out;
  }

  /** Fisher-Yates shuffle in place. */
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
  }
}

function colIdx(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "") n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? _;
  });
}

/** The text of every <t> element inside `xml`, joined (rich-text runs included). */
function allText(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) out += decodeXml(m[1] ?? "");
  return out;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1] as string] = decodeXml(m[2] as string);
  return out;
}

/** Read the first sheet of an .xlsx file as rows of strings (no XML library: the format is narrow). */
export function readXlsx(path: string): Row[] {
  const files = unzipSync(readFileSync(path));
  const shared: string[] = [];
  const sharedXml = files["xl/sharedStrings.xml"];
  if (sharedXml) {
    for (const m of strFromU8(sharedXml).matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
      shared.push(allText(m[1] ?? ""));
    }
  }
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet) throw new Error("No xl/worksheets/sheet1.xml in the file");

  const rows: Row[] = [];
  for (const r of strFromU8(sheet).matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const row = new Map<number, string>();
    for (const c of (r[1] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = attrs(c[1] ?? "");
      const inner = c[2] ?? "";
      const v = /<(?:\w+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?v>)/.exec(inner);
      let val: string;
      if (a.t === "inlineStr") val = allText(inner);
      else if (!v) continue;
      else if (a.t === "s") val = shared[Number(v[1])] ?? "";
      else val = decodeXml(v[1] ?? "");
      row.set(colIdx(a.r ?? ""), val);
    }
    if (row.size > 0) {
      const width = Math.max(...row.keys()) + 1;
      rows.push(Array.from({ length: width }, (_, i) => row.get(i) ?? ""));
    }
  }
  return rows;
}

/** Give each distinct original value one stable fake value. */
function mapper(make: (n: number) => string): (value: string) => string {
  const seen = new Map<string, string>();
  return (value) => {
    if (value === "") return "";
    let fake = seen.get(value);
    if (fake === undefined) {
      fake = make(seen.size + 1);
      seen.set(value, fake);
    }
    return fake;
  };
}

function num(text: string | undefined): number {
  return text !== undefined && text !== "" ? Number(text) : 0;
}

/** Round half away from zero to 2 places (close to Python's round(x, 2)). */
function round2(x: number): number {
  return Number(x.toFixed(2));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** One CSV field, quoted only when needed (like Python's csv QUOTE_MINIMAL). */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function anonymize(header: Row, body: Row[]): Row[] {
  const rng = new Random(SEED);
  const col = Object.fromEntries(header.map((name, i) => [name, i])) as Record<string, number>;
  const idx = (name: string): number => {
    const i = col[name];
    if (i === undefined) throw new Error(`Missing column: ${name}`);
    return i;
  };
  const get = (r: Row, name: string): string => r[idx(name)] ?? "";

  const customer = mapper((n) => String(900000 + n));
  const customerName = mapper((n) => `Sample Toy Shop ${n} LLC`);
  const shipTo = mapper((n) => String(n).padStart(10, "0"));
  const po = mapper((n) => String(1000 + n));
  const order = mapper((n) => `00${90000000 + n}`);
  const itemCodes = rng.sample(8000000, 8999999, body.length);
  const item = mapper((n) => String(itemCodes[n - 1]));
  const descriptions = ADJECTIVES.flatMap((a) => THEMES.flatMap((t) => KINDS.map((k) => `${a} ${t} ${k}`)));
  rng.shuffle(descriptions);
  const desc = mapper((n) => {
    const d = descriptions[n - 1];
    if (d === undefined) throw new Error("More distinct item descriptions than fake ones");
    return `${d} #${String(n).padStart(3, "0")}`;
  });
  const unitPrice = new Map<string, number>();

  const isTotal = (r: Row): boolean => get(r, "Currency") === "";
  const out: Row[] = [];
  for (const r of body) {
    const next = [...r];
    const set = (name: string, value: string): void => {
      next[idx(name)] = value;
    };
    set("Customer", customer(get(r, "Customer")));
    set("Customer Name", customerName(get(r, "Customer Name")));
    set("Ship_to", shipTo(get(r, "Ship_to")));
    const nameState = get(r, "Name/State");
    const slash = nameState.lastIndexOf("/");
    set("Name/State", nameState ? `${customerName(slash >= 0 ? nameState.slice(0, slash) : nameState)}/XX` : "");
    set("PO No.", po(get(r, "PO No.")));
    set("Order", order(get(r, "Order")));
    if (!isTotal(r)) {
      set("Item", item(get(r, "Item")));
      set("Item Desc", desc(get(r, "Item Desc")));
      const ordered = num(get(r, "Pieces Ordered"));
      const shipped = num(get(r, "Pieces Shipped"));
      const originalUnit = ordered ? num(get(r, "Value Ordered")) / ordered : 10.0;
      const itemKey = get(next, "Item");
      let unit = unitPrice.get(itemKey);
      if (unit === undefined) {
        unit = round2(originalUnit * rng.uniform(0.7, 1.3));
        unitPrice.set(itemKey, unit);
      }
      set("Value Ordered", (unit * ordered).toFixed(2));
      set("Value Shipped", (unit * shipped).toFixed(2));
    }
    out.push(next);
  }

  // Subtotal rows: rebuild them from the anonymized item rows they summarize.
  const items = body.flatMap((r, i) => (isTotal(r) ? [] : [[r, out[i] as Row] as const]));
  const sum = (group: Row[], name: string): number => group.reduce((s, o) => s + num(get(o, name)), 0);
  body.forEach((r, i) => {
    if (!isTotal(r)) return;
    const next = out[i] as Row;
    const key = get(r, "PO No.") ? "PO No." : get(r, "Customer") ? "Customer" : null;
    let group = items.filter(([orig]) => key === null || get(orig, key) === get(r, key)).map(([, o]) => o);
    let piecesOrdered = sum(group, "Pieces Ordered");
    if (piecesOrdered !== num(get(r, "Pieces Ordered"))) {
      group = items.map(([, o]) => o); // fall back to the grand total
      piecesOrdered = sum(group, "Pieces Ordered");
    }
    if (piecesOrdered !== num(get(r, "Pieces Ordered"))) {
      fail(`Cannot rebuild a subtotal row: ${piecesOrdered} vs ${get(r, "Pieces Ordered")}`);
    }
    const valueOrdered = sum(group, "Value Ordered");
    const valueShipped = sum(group, "Value Shipped");
    next[idx("Value Ordered")] = valueOrdered.toFixed(2);
    next[idx("Value Shipped")] = valueShipped.toFixed(2);
    next[idx("Value Fill Rate (%)")] = valueOrdered ? (valueShipped / valueOrdered).toFixed(10) : "0";
  });
  return out;
}

const IDENTIFYING = ["Customer", "Customer Name", "Ship_to", "Name/State", "PO No.", "Order", "Item", "Item Desc"];
const SAFE_WORDS = new Set([...ADJECTIVES, ...THEMES, ...KINDS].map((w) => w.toLowerCase()).concat(["sample", "toy", "shop", "llc", "station"]));

const words = (text: string): string[] => text.match(/[a-z]+/g) ?? [];

/**
 * Return the leaks found. An empty list means the output is safe to write.
 *
 * Two checks, both against every cell of the output:
 * 1. Exact values: no original identifying cell value appears as an output cell.
 * 2. Words: no distinctive word (5+ letters) from an original name or description
 *    appears anywhere in the output. Words the generator itself uses are allowed.
 * Matching is on whole cells and whole words, so a fake SKU that contains an
 * original PO number as digits is not reported.
 */
export function findLeaks(header: Row, original: Row[], anonymized: Row[]): string[] {
  const col = Object.fromEntries(header.map((name, i) => [name, i])) as Record<string, number>;
  const get = (r: Row, name: string): string => r[col[name] ?? -1] ?? "";
  const outputCells = new Set(anonymized.flatMap((row) => row.map((c) => (c ?? "").trim().toLowerCase()).filter(Boolean)));
  const outputWords = new Set([...outputCells].flatMap(words));

  const leaks = new Set<string>();
  for (const row of original) {
    for (const name of IDENTIFYING) {
      const value = get(row, name).trim();
      if (value && outputCells.has(value.toLowerCase())) leaks.add(`${name}: an original value is in the output`);
    }
    for (const name of ["Customer Name", "Name/State", "Item Desc"]) {
      for (const word of words(get(row, name).toLowerCase())) {
        if (word.length >= 5 && !SAFE_WORDS.has(word) && outputWords.has(word)) {
          leaks.add(`${name}: the word '${word}' is in the output`);
        }
      }
    }
  }
  return [...leaks].sort();
}

export function main(src: string, dst: string): void {
  const rows = readXlsx(src);
  const [header, ...body] = rows;
  if (!header) fail("The sheet is empty");
  const out = anonymize(header, body);

  const leaks = findLeaks(header, body, out);
  if (leaks.length > 0) {
    fail(`Leak check failed, nothing written. ${leaks.length} problem(s), for example: ${JSON.stringify(leaks.slice(0, 3))}`);
  }

  // Python's csv module ends each line with \r\n; keep that so the fixture format does not change.
  const csv = [header, ...out].map((row) => Array.from(row, (c) => csvField(c ?? "")).join(",")).join("\r\n") + "\r\n";
  writeFileSync(dst, csv);
  console.log(`Leak check passed. Wrote ${out.length} rows to ${dst}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) fail("Usage: tsx tools/anonymize-sample.ts SAMPLE.XLSX OUTPUT.CSV");
  main(src, dst);
}
