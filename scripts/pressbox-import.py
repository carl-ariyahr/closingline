#!/usr/bin/env python3
"""Phil Steele "Inside the Pressbox" weekly PDF -> JSON of starred plays (Carl 2026-09-04: "PS" plays for Patrick's Variables).
Reads the index page: a ZapfDingbats star glyph sits just before the starred SIDE; the glyph's rendered colour says whose
bet it is (yellow = Computer Best Bet, green = Phil's Best Bet). Game pages supply the Vegas line, total and forecasts.
Usage: python3 scripts/pressbox-import.py <pdf> [--year 2026] > picks.json
"""
import sys, re, json, datetime, fitz

MONTHS = {m: i + 1 for i, m in enumerate(['January','February','March','April','May','June','July','August','September','October','November','December'])}
DAY_RE = re.compile(r'^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Z][a-z]+)\s+(\d+)')
ABBR = {'e': ['eastern', 'east'], 'w': ['western', 'west'], 'n': ['northern', 'north'], 's': ['southern', 'south'], 'st': ['state', 'st'], 'miss': ['mississippi', 'miss'],
        'fiu': ['florida', 'international', 'fiu'], 'usf': ['south', 'florida', 'usf'], 'fau': ['florida', 'atlantic', 'fau'], 'utsa': ['utsa'], 'lsu': ['lsu'], 'byu': ['byu'],
        'ga': ['georgia'], 'la': ['louisiana'], 'jax': ['jacksonville'], 'tenn': ['tennessee'], 'ucf': ['central', 'florida', 'ucf'], 'smu': ['smu'], 'unlv': ['unlv'], 'uab': ['uab'], 'utep': ['utep'], 'wku': ['western', 'kentucky'], 'niu': ['northern', 'illinois'], 'ulm': ['louisiana', 'monroe'], 'oh': ['ohio'], 'fl': ['florida']}

def toks(s):
    out = []
    for w in re.sub(r'[^a-z0-9 ]', ' ', s.lower()).split():
        out.append(ABBR.get(w, [w]))
    return out
def score(short, full):  # how well an index-page name matches a game-page header
    f = set(re.sub(r'[^a-z0-9 ]', ' ', full.lower()).split())
    hits = 0; alts = toks(short)
    for a in alts:
        if any(x in f or any(y.startswith(x) and len(x) >= 4 for y in f) for x in a): hits += 1
    return hits / max(1, len(alts))

def classify(rgb):
    r, g, b = rgb
    if r > 200 and g > 200 and b < 120: return 'computer'   # yellow
    if g > 120 and r < 120 and b < 140: return 'phil'       # green
    return None

def parse_index(page):
    pix = page.get_pixmap(dpi=144); sc = 144 / 72
    def px(x, y):
        X, Y = int(x * sc), int(y * sc)
        return pix.pixel(X, Y)[:3] if 0 <= X < pix.width and 0 <= Y < pix.height else (255, 255, 255)
    words = [(w[0], w[1], w[2], w[3], w[4]) for w in page.get_text('words') if w[4] != 'H']  # drop star glyphs read as 'H'
    # regions: three numbered columns (rotation rows) and the FCS-vs-FBS list (lower middle + right column)
    def region(x, y):
        if x >= 570 or (330 <= x < 520 and y >= 440): return 'fcs'
        if x >= 520: return 'legend'
        return 'n0' if x < 190 else 'n1' if x < 380 else 'n2'
    rows = {}
    for x0, y0, x1, y1, t in words:
        rows.setdefault((region(x0, y0), round((y0 + y1) / 2 / 3)), []).append((x0, x1, t, (y0 + y1) / 2))
    def row_text(ws): return ' '.join(t for _, _, t, _ in sorted(ws))
    # reading order: numbered columns n0 -> n1 -> n2 top-down; FCS: middle block then right column, top-down
    order = {'n0': 0, 'n1': 1, 'n2': 2}
    num_rows = sorted([k for k in rows if k[0] in order], key=lambda k: (order[k[0]], k[1]))
    fcs_rows = sorted([k for k in rows if k[0] == 'fcs'], key=lambda k: (0 if min(w[0] for w in rows[k]) < 520 else 1, k[1]))
    date_of = {}
    for seq in (num_rows, fcs_rows):
        cur = None
        for k in seq:
            m = DAY_RE.match(row_text(rows[k]))
            if m: cur = (MONTHS[m.group(2)], int(m.group(3)))
            date_of[k] = cur
    numbered = {}
    for k in num_rows:
        m = re.match(r'^(\d{3})\s+([A-Z][A-Z0-9 .&\'-]*[A-Z])\s*$', row_text(rows[k]))
        if m: numbered[int(m.group(1))] = (m.group(2).strip(), k)
    stars = []
    d = page.get_text('rawdict')
    for b in d['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                if 'Dingbat' not in s['font'] or s['size'] > 10: continue
                for ch in s['chars']:
                    if ch['c'] != 'H': continue
                    x0, y0, x1, y1 = ch['bbox']
                    who = classify(px((x0 + x1) / 2, (y0 + y1) / 2))
                    if who: stars.append((x0, (y0 + y1) / 2, who))
    picks, seen = [], set()
    for sx, sy, who in stars:
        reg = region(sx, sy)
        key = (reg, round(sy / 3))
        cands = [k for k in rows if k[0] == reg and abs(k[1] * 3 - sy) <= 4]
        if not cands: continue
        k = min(cands, key=lambda k: abs(k[1] * 3 - sy))
        if k in seen: continue
        seen.add(k)
        ws = sorted(rows[k]); text = re.sub(r'\s*=.*$', '', row_text(ws)).strip(); date = date_of.get(k)
        if reg == 'fcs':
            m = re.match(r'^(.*?)\s+vs\s+(.*)$', text)
            if not m: continue
            vs_x = next((x0 for x0, _, t, _ in ws if t == 'vs'), None)
            side = m.group(1).strip() if vs_x is None or sx < vs_x else m.group(2).strip()
            picks.append({'who': who, 'side': side, 'away': m.group(1).strip(), 'home': m.group(2).strip(), 'date': date, 'list': 'fcs-vs-fbs'})
        else:
            m = re.match(r'^(\d{3})\s+(.*)$', text)
            if not m: continue
            n = int(m.group(1)); name = m.group(2).strip()
            mate = numbered.get(n - 1 if n % 2 == 0 else n + 1)
            if not mate: continue
            away, home = (mate[0], name) if n % 2 == 0 else (name, mate[0])
            picks.append({'who': who, 'side': name, 'away': away, 'home': home, 'date': date, 'rot': n, 'list': 'fbs'})
    return picks

def game_pages(doc):
    out = []
    for i in range(1, len(doc)):
        t = doc[i].get_text('text')
        line = re.search(r'VEGAS LINE\s*\n\s*(.+?)\s+By\s+([\d.]+)', t)
        total = re.search(r'VEGAS TOTAL\s*\n\s*([\d.]+)\s+Points', t)
        bb = re.search(r'Best Bet:?\s*\S?\s*(.+?)\s+(\d+)\s+(?:\(\+\)\s+)?(.+?)\s+(\d+)\s*$', t, re.M)
        out.append({'page': i + 1, 'text': t, 'line': (line.group(1).strip(), float(line.group(2))) if line else None,
                    'total': float(total.group(1)) if total else None,
                    'bestBet': {'team': bb.group(1).strip(), 'score': re.sub(r'\s*\(\+\)\s*', ' ', f"{bb.group(1).strip()} {bb.group(2)} {bb.group(3).strip()} {bb.group(4)}")} if bb else None})
    return out

def main():
    pdf = sys.argv[1]; year = int(next((a.split('=')[1] for a in sys.argv[2:] if a.startswith('--year=')), datetime.date.today().year))
    doc = fitz.open(pdf)
    picks = parse_index(doc[0])
    pages = game_pages(doc)
    for p in picks:
        # find the game page: both names must match the page header text
        best = None
        for g in pages:  # a starred game's page carries a "Best Bet:" line naming both teams — anchor on it, fall back to page text
            if g['bestBet']:
                bt = g['bestBet']['score']
                s = 2 * (score(p['away'], bt) + score(p['home'], bt))
            else:
                s = score(p['away'], g['text'][:6000]) + score(p['home'], g['text'][:6000])
            if best is None or s > best[0]: best = (s, g)
        if best and best[0] >= 1.5:
            g = best[1]; p['page'] = g['page']; p['vegasLine'] = g['line']; p['vegasTotal'] = g['total']; p['bestBet'] = g['bestBet']
        if p['date']: p['date'] = f"{year}-{p['date'][0]:02d}-{p['date'][1]:02d}"
    week = re.search(r'Week[-\s]?(\d+)', pdf)
    print(json.dumps({'source': pdf.split('/')[-1], 'week': int(week.group(1)) if week else None, 'sport': 'CFB', 'picks': picks}, indent=1))

main()
