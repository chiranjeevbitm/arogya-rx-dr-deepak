"""Builds public/seed/medicines-NN.json.gz from the old app's merged medicine catalogue.
Each row: [name, kind ('ja' Jan Aushadhi | 'brand'), category, manufacturer, pack, price, form]."""
import csv, gzip, json, re, sys, os
SRC = sys.argv[1] if len(sys.argv) > 1 else '../chiranjeevbitm/doctorappointmentform/backend/merged_medicine_catalog.csv'
OUT = 'public/seed'; PARTS = 2
FORMS = [(r'\b(tablet|tab\.?|tabs)\b','TAB'),(r'\brotacap','ROTACAP'),(r'\bcapsule|\bcap\b','CAP'),(r'\bsyrup|\bsyp\b','SYP'),(r'\bsuspension','SUSP'),(r'\binjection|\binj\b|\bvial\b','INJ'),(r'\bdrops?\b','DROP'),(r'\bointment','OINT'),(r'\bcream\b','CREAM'),(r'\bgel\b','GEL'),(r'\binhaler','INH'),(r'\brespules?','RESP'),(r'\bsachet','SACHET'),(r'\bpowder\b','POWDER'),(r'\blotion\b','LOTION'),(r'\bspray\b','SPRAY')]
def form(n):
    s=n.lower()
    for rx,f in FORMS:
        if re.search(rx,s): return f
    return ''
recs = {}
with open(SRC, encoding='utf8') as f:
    for r in csv.DictReader(f):
        name = re.sub(r'\s+',' ', r['product_name']).strip()
        if not name or len(name) > 200: continue
        # Product_List = PMBJP Jan Aushadhi catalogue (SKU < 9100) followed by branded products with MRP (SKU >= 9100,
        # whose category column is wrong). medicine_data = brands with manufacturer and drug class but no price.
        ja = r['source'] == 'Product_List' and r['sku_code'].isdigit() and int(r['sku_code']) < 9100
        kind = 'ja' if ja else 'brand'
        cat = '' if (r['source'] == 'Product_List' and not ja) else r['category']
        try: price = round(float(r['price']), 2) if r['price'] else None
        except ValueError: price = None
        if not price or price <= 0: price = None
        key = (name.lower(), kind)
        cur = recs.get(key)
        if not cur:
            recs[key] = [name, kind, cat or '', r['manufacturer'] or '', r['package_size'] or '', price, form(name)]
        else:  # merge: keep whichever fields are filled
            cur[2] = cur[2] or cat or ''; cur[3] = cur[3] or r['manufacturer'] or ''; cur[4] = cur[4] or r['package_size'] or ''; cur[5] = cur[5] or price
rows = sorted(recs.values(), key=lambda r: (r[1] != 'ja', r[0].lower()))
os.makedirs(OUT, exist_ok=True)
n = -(-len(rows) // PARTS)
for i in range(PARTS):
    part = rows[i*n:(i+1)*n]
    with gzip.open(f'{OUT}/medicines-{i:02d}.json.gz', 'wt', encoding='utf8', compresslevel=9) as g:
        json.dump(part, g, ensure_ascii=False, separators=(',',':'))
print(len(rows), 'rows in', PARTS, 'parts;', sum(1 for r in rows if r[1]=='ja'), 'Jan Aushadhi')
