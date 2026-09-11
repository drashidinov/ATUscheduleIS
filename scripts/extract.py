import re, json, sys, os, glob
from pathlib import Path
import openpyxl

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
from teachers import teachers

# UPLOAD_DIR can be overridden via env var so the same script works both for
# manually-uploaded files (Claude chat) and the automated raw/ folder (GitHub Actions).
UPLOAD_DIR = os.environ.get("SCHEDULE_SOURCE_DIR", "/mnt/user-data/uploads")

# Match files by pattern rather than an exact name — the university (and the
# automation's stable raw/ filenames) both vary, so pick the newest file whose
# name matches any pattern for a given level, instead of hardcoding one filename.
# Order matters: more specific patterns (magistracy/doctorate) are checked first
# and claim their file before the generic "N курс" patterns get a chance, since
# e.g. "doktorantura_1kurs.xlsx" would otherwise also match the "1 курс" pattern.
LEVELS = [
    ("Магистратура 1 курс (профильное направление)",  [r'магистратур.*проф', r'magistratura_?profil']),
    ("Магистратура 1 курс (научно-пед. направление)", [r'магистрант.*научно', r'magistratura_?nauchped']),
    ("Магистратура 2 курс",                           [r'магистрант.*2[_\s]?курс', r'magistratura_?2[_\s]?kurs']),
    ("Докторантура 1 курс",                           [r'докторант', r'doktorantura']),
    ("1 курс (бакалавриат)",                          [r'1[_\s]?курс', r'1[_\s]?kurs']),
    ("2 курс (бакалавриат)",                          [r'2[_\s]?курс', r'2[_\s]?kurs']),
    ("3 курс (бакалавриат)",                          [r'3[_\s]?курс', r'3[_\s]?kurs']),
    ("4 курс (бакалавриат)",                          [r'4[_\s]?курс', r'4[_\s]?kurs']),
]

def discover_files():
    """Return [(filename, level_label), ...] — the newest matching .xlsx per level.
    Each file is claimed by at most one level (first match, in LEVELS order),
    so a more specific pattern never loses its file to a more generic one."""
    remaining = glob.glob(os.path.join(UPLOAD_DIR, "*.xlsx"))
    found = []
    for level_label, patterns in LEVELS:
        matches = [
            f for f in remaining
            if any(re.search(p, os.path.basename(f), re.I) for p in patterns)
        ]
        if not matches:
            print(f"WARNING: no file found for level '{level_label}'", file=sys.stderr)
            continue
        matches.sort(key=os.path.getmtime, reverse=True)
        chosen = matches[0]
        found.append((os.path.basename(chosen), level_label))
        remaining = [f for f in remaining if f not in matches]
    # restore original course order (1..4, then magistracy/doctorate) for readable logs
    order = {lbl: i for i, (lbl, _) in enumerate([
        ("1 курс (бакалавриат)", None), ("2 курс (бакалавриат)", None),
        ("3 курс (бакалавриат)", None), ("4 курс (бакалавриат)", None),
        ("Магистратура 1 курс (профильное направление)", None),
        ("Магистратура 1 курс (научно-пед. направление)", None),
        ("Магистратура 2 курс", None), ("Докторантура 1 курс", None),
    ])}
    found.sort(key=lambda x: order.get(x[1], 99))
    return found

FILES = discover_files()

# Kazakh-specific letter normalization (length-preserving, 1 char -> 1 char)
KZ_MAP = str.maketrans({
    'Қ':'К','қ':'к','Ғ':'Г','ғ':'г','Ү':'У','ү':'у','Ұ':'У','ұ':'у',
    'Ә':'А','ә':'а','Ө':'О','ө':'о','Ң':'Н','ң':'н','Һ':'Х','һ':'х',
    'І':'И','і':'и',
})

def normalize(s):
    return s.translate(KZ_MAP)

# Build surname -> list of (full_name, given_first_letter) mapping
by_surname = {}
for t in teachers:
    if t == "Arifa Javed":
        continue
    parts = t.split()
    sn = parts[0]
    given = parts[1] if len(parts) > 1 else ""
    by_surname.setdefault(normalize(sn), []).append((t, normalize(given)))

# Known spelling variants seen in the actual schedule files (е.g. "ей" vs "еи")
SURNAME_ALIASES = {
    "Алимсейтова": "Алимсеитова",
    "Рашиддинов": "Рашидинов",
}
for alias, canonical in SURNAME_ALIASES.items():
    alias_n = normalize(alias)
    canon_n = normalize(canonical)
    if canon_n in by_surname and alias_n not in by_surname:
        by_surname[alias_n] = by_surname[canon_n]

# Precompute regex per normalized surname: left word-boundary only (allow declined suffixes)
surname_patterns = {}
for sn in by_surname:
    pat = re.compile(r'(?<![A-Za-zА-Яа-я])' + re.escape(sn), re.IGNORECASE)
    surname_patterns[sn] = pat

# Special handling for Arifa Javed (Latin)
arifa_pattern = re.compile(r'arifa\s*javed|javed', re.IGNORECASE)

def find_teacher_in_text(text):
    """Return list of matched full teacher names found in text."""
    if not text or not isinstance(text, str):
        return []
    norm_text = normalize(text)
    # collect all raw matches: (start, end, surname)
    raw_matches = []
    for sn in by_surname:
        for m in surname_patterns[sn].finditer(norm_text):
            raw_matches.append((m.start(), m.end(), sn))
    # keep only the longest surname match per start position (avoids e.g. "Букенов" matching inside "Букенова")
    best_by_start = {}
    for start, end, sn in raw_matches:
        cur = best_by_start.get(start)
        if cur is None or (end - start) > (cur[1] - start):
            best_by_start[start] = (start, end, sn)

    initial_re = re.compile(r'^\s*[.,]?\s*([A-ZА-ЯЁ])[.\s]', re.IGNORECASE)

    found = []
    for start, end, sn in best_by_start.values():
        cands = by_surname[sn]
        raw_after = norm_text[end:end+20]
        # skip any lowercase letters directly glued on (declension suffix of the surname itself)
        skip_i = 0
        while skip_i < len(raw_after) and raw_after[skip_i].isalpha() and raw_after[skip_i].islower():
            skip_i += 1
        after = raw_after[skip_i:skip_i+8]
        m_init = initial_re.match(after)
        detected_initial = m_init.group(1).lower() if m_init else None

        if len(cands) == 1:
            full, given = cands[0]
            if detected_initial and given and detected_initial != given[0].lower():
                # an initial is present and it does NOT match our teacher -> different person, skip
                continue
            found.append(full)
        else:
            matched_one = None
            if detected_initial:
                for full, given in cands:
                    if given and detected_initial == given[0].lower():
                        matched_one = full
                        break
            if matched_one:
                found.append(matched_one)
            # if ambiguous / no initial match -> likely a different person with same surname; skip
    if arifa_pattern.search(text):
        found.append("Arifa Javed")
    return found

def clean(s):
    if s is None:
        return ""
    return str(s).replace("\n", " ").strip()

def find_header_rows(ws, max_scan_col=30):
    header_rows = []
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 15)):
        c = row[0].value
        if isinstance(c, str) and ('күні' in c.lower() or ('дни' in c.lower())):
            header_rows.append(row[0].row)
    return header_rows

def process_sheet(wb_name, level_label, sheet_name, ws):
    results = []
    header_rows = find_header_rows(ws)
    if not header_rows:
        return results
    max_row = ws.max_row
    max_col = ws.max_column
    merged_ranges = list(ws.merged_cells.ranges)
    def find_merge(row, col):
        for mr in merged_ranges:
            if mr.min_row <= row <= mr.max_row and mr.min_col <= col <= mr.max_col:
                return mr
        return None
    for idx, hrow in enumerate(header_rows):
        next_header = header_rows[idx+1] if idx+1 < len(header_rows) else max_row + 1
        # determine group header row: hrow or hrow+1, whichever has more non-none in cols 3..max_col
        def count_nonnone(r):
            cnt = 0
            for c in range(3, max_col+1):
                v = ws.cell(row=r, column=c).value
                if v not in (None, ""):
                    cnt += 1
            return cnt
        cnt_h = count_nonnone(hrow)
        cnt_h1 = count_nonnone(hrow+1) if hrow+1 < next_header else 0
        # Prefer the sub-header row (hrow+1) whenever it has any group labels at all —
        # ties (e.g. a stray language marker like "каз" padding hrow's count) must not
        # cause us to pick the coarser row and silently drop whole group columns.
        group_row = hrow if cnt_h > cnt_h1 else hrow+1
        col_group = {}
        for c in range(3, max_col+1):
            v = ws.cell(row=group_row, column=c).value
            if v not in (None, ""):
                label = clean(v)
                # A group's header cell is often merged across 2+ columns (e.g. a
                # combined group split into parallel subgroup sessions). Map every
                # column in that merge to the same group, not just the anchor column,
                # or whole subgroup columns silently drop out of the scan.
                mr = find_merge(group_row, c)
                if mr:
                    for cc in range(mr.min_col, mr.max_col+1):
                        col_group[cc] = label
                else:
                    col_group[c] = label
        data_start = group_row + 1
        data_end = next_header - 1
        current_day = None
        for r in range(data_start, min(data_end, max_row) + 1):
            dayval = ws.cell(row=r, column=1).value
            if isinstance(dayval, str) and dayval.strip():
                current_day = clean(dayval)
            timeval = ws.cell(row=r, column=2).value
            any_data = False
            for c, gname in col_group.items():
                cellval = ws.cell(row=r, column=c).value
                if cellval not in (None, ""):
                    any_data = True
                    matches = find_teacher_in_text(str(cellval))
                    for teacher in matches:
                        results.append({
                            "Преподаватель": teacher,
                            "Уровень/Курс": level_label,
                            "Файл": wb_name,
                            "Лист": sheet_name,
                            "Группа/Поток": gname,
                            "День": current_day or "",
                            "Время": clean(timeval),
                            "Занятие": clean(cellval),
                        })
            if not any_data and timeval in (None, ""):
                continue
    return results

all_results = []
for fname, level_label in FILES:
    path = f"{UPLOAD_DIR}/{fname}"
    wb = openpyxl.load_workbook(path, data_only=True)
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        res = process_sheet(fname, level_label, sheet_name, ws)
        all_results.extend(res)
    print(f"Processed {fname}: {len(wb.sheetnames)} sheets, running total matches={len(all_results)}", file=sys.stderr)

print(f"TOTAL MATCHES: {len(all_results)}", file=sys.stderr)

with open(REPO_ROOT / "data" / "results.json", "w", encoding="utf-8") as f:
    json.dump(all_results, f, ensure_ascii=False, indent=1)
