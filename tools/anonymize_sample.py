"""Make an anonymized copy of the supplier fill-rate report.

The output keeps the columns, the row count, the quantities, the fill rates and the
subtotal rows. It replaces every customer, ship-to, PO, order, item code and item
description, and it changes the prices. The original file is not changed.

Usage: python3 -I tools/anonymize_sample.py SAMPLE.XLSX fixtures/sample-orders.anon.csv
"""

import csv
import random
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SEED = 2021

ADJECTIVES = ["Classic", "Deluxe", "Mini", "Mega", "Starter", "Creative", "Junior", "Pro",
              "Rainbow", "Turbo", "Cosmic", "Forest", "Ocean", "City", "Castle", "Arctic"]
THEMES = ["Brick", "Builder", "Robot", "Racer", "Train", "Rocket", "Farm", "Dino",
          "Pirate", "Garden", "Space", "Knight", "Harbor", "Jungle", "Fire Station", "Bakery"]
KINDS = ["Set", "Box", "Kit", "Bundle", "Playset", "Pack", "Bucket", "Collection"]


def col_idx(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    rows = []
    for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter("{%s}row" % NS["m"]):
        row = {}
        for c in r.findall("m:c", NS):
            v, t = c.find("m:v", NS), c.get("t")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is None:
                continue
            elif t == "s":
                val = shared[int(v.text)]
            else:
                val = v.text
            row[col_idx(c.get("r"))] = val
        if row:
            rows.append([row.get(i, "") for i in range(max(row) + 1)])
    return rows


def mapper(make):
    """Give each distinct original value one stable fake value."""
    seen = {}

    def get(value):
        if value == "":
            return ""
        if value not in seen:
            seen[value] = make(len(seen) + 1)
        return seen[value]

    return get


def num(text):
    return float(text) if text not in ("", None) else 0.0


def main(src, dst):
    rng = random.Random(SEED)
    rows = read_xlsx(src)
    header, body = rows[0], rows[1:]
    col = {name: i for i, name in enumerate(header)}

    customer = mapper(lambda n: str(900000 + n))
    customer_name = mapper(lambda n: f"Sample Toy Shop {n} LLC")
    ship_to = mapper(lambda n: f"{n:010d}")
    po = mapper(lambda n: str(1000 + n))
    order = mapper(lambda n: f"00{90000000 + n}")
    item_codes = rng.sample(range(8000000, 8999999), len(body))
    item = mapper(lambda n: str(item_codes[n - 1]))
    descriptions = [f"{a} {t} {k}" for a in ADJECTIVES for t in THEMES for k in KINDS]
    rng.shuffle(descriptions)
    desc = mapper(lambda n: f"{descriptions[n - 1]} #{n:03d}")
    unit_price = {}

    is_total = lambda r: r[col["Currency"]] == ""
    out = []
    for r in body:
        new = list(r)
        new[col["Customer"]] = customer(r[col["Customer"]])
        new[col["Customer Name"]] = customer_name(r[col["Customer Name"]])
        new[col["Ship_to"]] = ship_to(r[col["Ship_to"]])
        name_state = r[col["Name/State"]]
        new[col["Name/State"]] = customer_name(name_state.rsplit("/", 1)[0]) + "/XX" if name_state else ""
        new[col["PO No."]] = po(r[col["PO No."]])
        new[col["Order"]] = order(r[col["Order"]])
        if not is_total(r):
            new[col["Item"]] = item(r[col["Item"]])
            new[col["Item Desc"]] = desc(r[col["Item Desc"]])
            ordered, shipped = num(r[col["Pieces Ordered"]]), num(r[col["Pieces Shipped"]])
            original_unit = num(r[col["Value Ordered"]]) / ordered if ordered else 10.0
            unit = unit_price.setdefault(new[col["Item"]], round(original_unit * rng.uniform(0.7, 1.3), 2))
            new[col["Value Ordered"]] = f"{unit * ordered:.2f}"
            new[col["Value Shipped"]] = f"{unit * shipped:.2f}"
        out.append(new)

    # Subtotal rows: rebuild them from the anonymized item rows they summarize.
    items = [(r, o) for r, o in zip(body, out) if not is_total(r)]
    for r, new in zip(body, out):
        if not is_total(r):
            continue
        key = "PO No." if r[col["PO No."]] else "Customer" if r[col["Customer"]] else None
        group = [o for orig, o in items if key is None or orig[col[key]] == r[col[key]]]
        pieces_ordered = sum(num(o[col["Pieces Ordered"]]) for o in group)
        if pieces_ordered != num(r[col["Pieces Ordered"]]):
            group = [o for _, o in items]  # fall back to the grand total
            pieces_ordered = sum(num(o[col["Pieces Ordered"]]) for o in group)
        if pieces_ordered != num(r[col["Pieces Ordered"]]):
            sys.exit(f"Cannot rebuild a subtotal row: {pieces_ordered} vs {r[col['Pieces Ordered']]}")
        sums = {k: sum(num(o[col[k]]) for o in group)
                for k in ["Pieces Shipped", "Value Ordered", "Value Shipped"]}
        new[col["Value Ordered"]] = f"{sums['Value Ordered']:.2f}"
        new[col["Value Shipped"]] = f"{sums['Value Shipped']:.2f}"
        new[col["Value Fill Rate (%)"]] = (
            f"{sums['Value Shipped'] / sums['Value Ordered']:.10f}" if sums["Value Ordered"] else "0")

    leaks = find_leaks(header, body, out)
    if leaks:
        sys.exit(f"Leak check failed, nothing written. {len(leaks)} problem(s), for example: {leaks[:3]}")

    with open(dst, "w", newline="") as f:
        csv.writer(f).writerows([header] + out)
    print(f"Leak check passed. Wrote {len(out)} rows to {dst}")


IDENTIFYING = ["Customer", "Customer Name", "Ship_to", "Name/State", "PO No.", "Order", "Item", "Item Desc"]
SAFE_WORDS = {w.lower() for w in ADJECTIVES + THEMES + KINDS} | {"sample", "toy", "shop", "llc", "station"}


def find_leaks(header, original, anonymized):
    """Return the leaks found. An empty list means the output is safe to write.

    Two checks, both against every cell of the output:
    1. Exact values: no original identifying cell value appears as an output cell.
    2. Words: no distinctive word (5+ letters) from an original name or description
       appears anywhere in the output. Words the generator itself uses are allowed.
    Matching is on whole cells and whole words, so a fake SKU that contains an
    original PO number as digits is not reported.
    """
    col = {name: i for i, name in enumerate(header)}
    output_cells = {cell.strip().lower() for row in anonymized for cell in row if cell.strip()}
    output_words = {w for cell in output_cells for w in re.findall(r"[a-z]+", cell)}

    leaks = []
    for row in original:
        for name in IDENTIFYING:
            value = row[col[name]].strip()
            if value and value.lower() in output_cells:
                leaks.append(f"{name}: an original value is in the output")
        for name in ["Customer Name", "Name/State", "Item Desc"]:
            for word in re.findall(r"[a-z]+", row[col[name]].lower()):
                if len(word) >= 5 and word not in SAFE_WORDS and word in output_words:
                    leaks.append(f"{name}: the word '{word}' is in the output")
    return sorted(set(leaks))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
