import json, re, sys
sys.path.insert(0, '/home/claude/work')
from teachers import teachers

data = json.load(open("/home/claude/work/results.json", encoding="utf-8"))

KZ_MAP = str.maketrans({'Қ':'К','қ':'к','Ғ':'Г','ғ':'г','Ү':'У','ү':'у','Ұ':'У','ұ':'у',
    'Ә':'А','ә':'а','Ө':'О','ө':'о','Ң':'Н','ң':'н','Һ':'Х','һ':'х','І':'И','і':'и'})
def normalize(s): return s.translate(KZ_MAP)

DAY_ORDER = ["Понедельник","Вторник","Среда","Четверг","Пятница","Суббота","Воскресенье"]
def clean_day(d):
    if not d:
        return ""
    parts = [p.strip() for p in d.split("/")]
    for p in parts:
        for ru in DAY_ORDER:
            if ru.lower() == p.lower():
                return ru
    return d

surnames_norm = sorted({normalize(t.split()[0]) for t in teachers}, key=len, reverse=True)

TYPE_DETECT = [
    (re.compile(r'лек', re.I), "Лекция"),
    (re.compile(r'практ|семин', re.I), "Практика"),
    (re.compile(r'лаб', re.I), "Лабораторная"),
]
TYPE_REMOVE_RE = re.compile(
    r'лекция|лек\.?\s*зан\.?|лекц\.?|практика|практ\.?\s*зан\.?|практ\.?|прак\.?|семинар|семин\.?|'
    r'лабораторная|лабор\.?\s*зан\.?|лаб\.?\s*зан\.?|лаборат\.?|лаб\.?',
    re.I
)
ONLINE_RE = re.compile(r'онлайн|online|coursera|zoom', re.I)
NAME_TAIL_RE = re.compile(r'^([\s.,]{0,2}[A-ZА-ЯЁ]\.?){1,2}')
GENERIC_NAME_RE = re.compile(r'[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]{2,20}\s?[А-ЯЁӘҒҚҢӨҰҮҺІ]\.\s?[А-ЯЁӘҒҚҢӨҰҮҺІ]?\.?')
TRAILING_PAREN_NAME_RE = re.compile(r'\(\s*[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]{2,15}\s*\)\s*$')

def parse_time(t):
    try:
        a, b = t.split("-")
        h1,m1 = a.strip().split(".")
        h2,m2 = b.strip().split(".")
        return f"{int(h1):02d}:{int(m1):02d}", f"{int(h2):02d}:{int(m2):02d}", int(h1)*60+int(m1), int(h2)*60+int(m2)
    except Exception:
        return None, None, None, None

def detect_type(text):
    for pat, label in TYPE_DETECT:
        if pat.search(text):
            return label
    return "Занятие"

def strip_all_names(text):
    s = text
    ntext = normalize(s)
    spans = []
    for sn in surnames_norm:
        for m in re.finditer(re.escape(sn), ntext, re.I):
            spans.append((m.start(), m.end()))
    spans.sort(key=lambda x: (x[0], -(x[1]-x[0])))
    chosen = []
    last_end = -1
    for st, en in spans:
        if st >= last_end:
            chosen.append((st, en))
            last_end = en
    for st, en in sorted(chosen, key=lambda x: -x[0]):
        j = en
        while j < len(s) and s[j].isalpha() and s[j].islower():
            j += 1
        m2 = NAME_TAIL_RE.match(s[j:j+10])
        if m2:
            j += m2.end()
        s = s[:st] + " " + s[j:]
    s = GENERIC_NAME_RE.sub(' ', s)
    s = TRAILING_PAREN_NAME_RE.sub(' ', s)
    return s

def detect_room(text):
    m = re.search(r'ауд\.?\s*[:\-]?\s*([A-Za-zА-Яа-яЁё0-9\-]{2,10})', text, re.I)
    if m:
        return m.group(1).strip(" .")
    if ONLINE_RE.search(text):
        return "Онлайн"
    m = re.search(r'([0-9]{2,4}\s*-\s*[0-9A-Za-zА-Яа-яЁё]{1,4})\s*$', text)
    if m:
        return m.group(1).replace(" ", "")
    m = re.search(r'([0-9]{3,4})\s*$', text)
    if m:
        return m.group(1)
    return "?"

def clean_discipline(text, room):
    s = text
    if room and room != "?":
        s = s.replace(room, " ")
    s = TYPE_REMOVE_RE.sub(' ', s)
    s = re.sub(r'ауд\.?', ' ', s, flags=re.I)
    s = ONLINE_RE.sub(' ', s)
    s = re.sub(r'[\/\|]+', ' ', s)
    s = re.sub(r'\(\s*\)', ' ', s)
    s = re.sub(r'[.,;:\-]+\s*$', '', s.strip())
    s = re.sub(r'^\s*[.,;:\-]+', '', s)
    s = re.sub(r'\s{2,}', ' ', s).strip(" ,./-")
    return s.strip()

def norm_room(r):
    r = r.strip()
    if r.upper() in ("ОНЛАЙН","ONLINE"):
        return "Онлайн"
    def upper_tail(m):
        return m.group(1) + (m.group(2) or '') + m.group(3).upper()
    r = re.sub(r'([0-9])(-?)([а-яё])$', upper_tail, r)
    r = re.sub(r'^([а-яё])', lambda m: m.group(1).upper(), r)
    return r

leftover_room_re = re.compile(r'\b[0-9]{2,4}\s*-\s*[0-9A-Za-zА-Яа-яЁё]{1,3}\b')

parsed = []
for d in data:
    day = clean_day(d["День"])
    t0, t1, m0, m1 = parse_time(d["Время"])
    if t0 is None:
        continue
    text = d["Занятие"]
    stripped = strip_all_names(text)
    room = detect_room(stripped)
    if room == "?":
        room = detect_room(text)
    if room == "?":
        if "класс" in stripped.lower():
            room = "B-class"
        elif "дуальный" in stripped.lower():
            room = "Дуальное обучение"
    room = norm_room(room)
    ttype = detect_type(text)
    is_online = bool(ONLINE_RE.search(text))
    discipline = clean_discipline(stripped, room)
    discipline = leftover_room_re.sub(lambda m: '' if m.group(0).replace(' ','') != room.replace(' ','') else m.group(0), discipline)
    discipline = re.sub(r'\s{2,}', ' ', discipline).strip(" ,./-")
    discipline = discipline.rstrip(" л")
    if not discipline:
        discipline = "Занятие"
    discipline = discipline[0].upper() + discipline[1:]

    parsed.append({
        "teacher": d["Преподаватель"],
        "level": d["Уровень/Курс"],
        "group": d["Группа/Поток"],
        "day": day,
        "start": t0, "end": t1, "startMin": m0, "endMin": m1,
        "room": room,
        "type": ttype,
        "online": is_online,
        "discipline": discipline,
    })

# Labs run 2 academic hours (~100 min); the source spreadsheet only captures a single
# ~50-min slot per row. Extend each lab's end time to the next academic hour, but never
# past the next scheduled event in the same room/day (avoids fabricating room clashes).
LAB_TARGET_MIN = 100
by_room_day = {}
for p in parsed:
    by_room_day.setdefault((p["room"], p["day"]), []).append(p)

for key, items in by_room_day.items():
    items.sort(key=lambda x: x["startMin"])
    for i, item in enumerate(items):
        if item["type"] != "Лабораторная":
            continue
        target_end = item["startMin"] + LAB_TARGET_MIN
        if i + 1 < len(items):
            target_end = min(target_end, items[i+1]["startMin"])
        target_end = max(target_end, item["endMin"])  # never shrink below what was captured
        item["endMin"] = target_end
        item["end"] = f"{target_end//60:02d}:{target_end%60:02d}"

json.dump(parsed, open("/home/claude/work/parsed_lessons.json","w",encoding="utf-8"), ensure_ascii=False)
print("parsed", len(parsed))
import collections
print(collections.Counter(p["teacher"]=="Рашиддинов Дамир Рашидинович" for p in parsed))
