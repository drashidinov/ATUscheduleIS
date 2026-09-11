# Автоматическое обновление расписания из Google Drive

Google Apps Script раз в N часов проверяет папки на Google Drive, и если
деканат выложил новый файл — сам коммитит его в репозиторий в `raw/`.
GitHub Actions видит изменение в `raw/**.xlsx` и автоматически пересобирает
`index.html` и Excel-отчёт (`.github/workflows/rebuild.yml`), без участия чата.

```
Google Drive (несколько папок/аккаунтов)
        │  Apps Script, по таймеру
        ▼
   raw/*.xlsx  в репозитории
        │  GitHub Actions (триггер: push в raw/**.xlsx)
        ▼
   scripts/extract.py → parse_lessons.py → gen_lessons_js.py → build.py → build_report.py
        │
        ▼
   index.html, dist/*.xlsx  (закоммичены автоматически)
```

## Настройка (один раз)

### 1. GitHub-токен
[github.com/settings/tokens/new](https://github.com/settings/tokens/new) →
scope **repo** (classic) достаточно. Скопируйте токен — он показывается один раз.

### 2. Google Apps Script
1. [script.google.com](https://script.google.com) → **New project**.
2. Удалите содержимое `Code.gs`, вставьте целиком файл
   [`automation/apps-script/Code.gs`](apps-script/Code.gs) из этого репозитория.
3. Слева — значок шестерёнки **Project Settings** → **Script Properties** →
   **Add script property**, добавьте четыре штуки:

   | Property | Value |
   |---|---|
   | `GITHUB_TOKEN` | токен из шага 1 |
   | `GITHUB_REPO` | `drashidinov/ATUscheduleIS` |
   | `GITHUB_BRANCH` | `main` |
   | `SOURCES` | JSON-массив ниже |

   Значение `SOURCES` — готовый JSON, ничего заменять не нужно (папки 1-4
   курса и папка магистратуры/докторантуры на том же Drive уже найдены):

   ```json
   [
     {"folderId": "1eA-lcoSPEpt61yUIBHxT5nWnEG-IHins", "target": "raw/1_kurs.xlsx"},
     {"folderId": "1EeNW0zytgQ4589orfxgZY3oHPOJ1jZkG", "target": "raw/2_kurs.xlsx"},
     {"folderId": "1VqbRrpsIzX0thsfz3V41qC8qBeLNNnLb", "target": "raw/3_kurs.xlsx"},
     {"folderId": "1YW_mXxgdIWg3p8Z7APQpfED2H-hTGwKj", "target": "raw/4_kurs.xlsx"},
     {"folderId": "1qTpiIHA9tkla7zAug2X6xtOoPKy8U7-F", "namePattern": "проф", "target": "raw/magistratura_profil.xlsx"},
     {"folderId": "1qTpiIHA9tkla7zAug2X6xtOoPKy8U7-F", "namePattern": "научно", "target": "raw/magistratura_nauchped.xlsx"},
     {"folderId": "1qTpiIHA9tkla7zAug2X6xtOoPKy8U7-F", "namePattern": "2[_\\s]?курс", "target": "raw/magistratura_2kurs.xlsx"},
     {"folderId": "1qTpiIHA9tkla7zAug2X6xtOoPKy8U7-F", "namePattern": "докторант", "target": "raw/doktorantura_1kurs.xlsx"}
   ]
   ```

   Первые 4 записи — по одной папке на курс, скрипт сам берёт самый свежий
   `.xlsx` внутри. Последние 4 — все четыре файла лежат в одной папке
   «Магистратура, докторантура» рядом друг с другом, поэтому у них общий
   `folderId`, а какой из четырёх файлов взять, решает `namePattern`
   (регулярное выражение по имени файла, без учёта регистра).

   **Если понадобится добавить ещё один источник:** ID папки/файла — это
   часть ссылки после `/folders/` или `/file/d/`. Можно вставлять и ссылку
   целиком в `folderId`/`fileId` — скрипт сам вырежет ID.

4. **Run** → выберите функцию `syncSchedules` → **Run**. Google спросит
   разрешения (доступ к Drive и к внешним запросам) — подтвердите. Проверьте
   **Executions** (иконка списка слева) на ошибки.
5. **Triggers** (значок часов слева) → **Add Trigger** → Function: `syncSchedules`,
   Event source: **Time-driven**, Type: **Hour timer**, Every: **6 hours**
   (или как удобно) → **Save**.

Готово — дальше всё само: Apps Script проверяет Drive по расписанию, при
изменении коммитит `raw/*.xlsx`, GitHub Actions пересобирает сайт.

## Локальный запуск пайплайна (для отладки)

```bash
SCHEDULE_SOURCE_DIR=raw python3 scripts/extract.py
python3 scripts/parse_lessons.py
python3 scripts/gen_lessons_js.py
python3 scripts/build.py
python3 scripts/build_report.py
```

`scripts/extract.py` ищет файлы не по точному имени, а по шаблону (номер
курса / «магистратура» / «докторантура» в названии) — поэтому переименования
файлов деканатом между запусками не ломают пайплайн ни при ручной, ни при
автоматической загрузке.
