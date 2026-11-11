# dsh-study-coach

[![test](https://github.com/okita1015/dsh-study-coach/actions/workflows/test.yml/badge.svg)](https://github.com/okita1015/dsh-study-coach/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-3c873a.svg)](https://nodejs.org)

**Turn a term's worth of slides into something you can actually revise from.**

Drop PDFs and PPTX into a subject folder, and get back:

- **Notes** — every topic explained in Chinese with the English term right beside it, because the exam is in English
- **Practice papers** — they copy your real past paper's section layout, per-question marks and phrasing; only the questions change
- **An error log** — spaced repetition decides what you review tomorrow, not your gut feeling

Everything runs **inside DSH**. No sidecar process, no extra port, no iframe.

> 中文说明见 [README.zh.md](./README.zh.md)

---

## What it looks like

```
┌ Study Library ─────────────────── [📄 Summary] [⚡ Crib] [🌗] ┐
├──────────┬──────────────────────────────────────────────────┤
│ SUBJECTS │  [📁 Files] [📝 Notes 33] [❓ Questions 32]        │
│          │                                                  │
│ COMP2011  │  📖 Lecture 10  ✏️ Homework 6  📝 Papers 4  📎 1  │
│ Discrete │  ┌────────────────────────────────────┐          │
│ 33 · 32  │  │  📥 Drop files here → "Lecture"     │          │
│          │  └────────────────────────────────────┘          │
│ + New    │  📕 📊 📊 📕 📊   ← click × to remove           │
└──────────┴──────────────────────────────────────────────────┘
```

---

## Features

**Library**
- Per-subject folders, four sections: **Lecture / Homework / Past papers / Reference**
- Drag & drop anywhere in the content area — multi-file, auto-routed to the active section
- Sections probe several directory layouts, so existing folders like `0_课程材料/Tutorial` just work
- Delete a file with one click; open it with `/api/study-coach/file`

**Notes & questions**
- Notes grouped by lecture, each with a mastery bar
- Questions with per-card "Drill" → answer reveal → **Got it / Missed it** writes straight back
- Bilingual by design: a topic can carry `title` + `titleEn`

**Generated documents**
- **Summary** — overview table, mastery bands, per-lecture breakdown, weakest topics, today's plan
- **Crib sheet** — one compact line per topic, Chinese/English side by side
- Export as Markdown: copy to clipboard, download, or save into the subject's Reference folder
- Locale switch inside the preview: 中英对照 / 纯中文 / English only

**Spaced repetition**
- Correct **+15%**, wrong **−25%**
- Next review at 1 / 2 / 4 / 7 / 15 / 30 days depending on mastery
- `study_plan` separates "due for review" from "never seen"

**Theme**
- Colours are CSS variables only — no hard-coded hex in components
- Follows `prefers-color-scheme` by default; manual light/dark/auto toggle, remembered in `localStorage`
- Works in both DSH light and dark shells

---

## Install

**Requirements:** DSH 2.x (ships Node ≥ 22) and Python 3.10+ with `pymupdf`, `python-docx`, `python-pptx`.
DSH's bundled Python runtime already contains all three — you only need
`python -m pip install pymupdf python-docx python-pptx` if you point the plugin at your own Python.

**One command** — the installer edits your profile and links the folder for you
(it backs up `package.json` first, and is safe to run twice):

```bash
git clone https://github.com/okita1015/dsh-study-coach.git
cd dsh-study-coach
node install.mjs
```

**No git?** Download the zip and double-click:

1. https://github.com/okita1015/dsh-study-coach/archive/refs/heads/main.zip
2. Unzip anywhere
3. Windows → double-click **`install.cmd`** · macOS/Linux → `./install.sh`
4. Restart DSH

Multiple profiles? `node install.mjs --profile desktop`. Just want to see the plan? `--dry-run`.

Then check what this machine is missing before blaming the plugin:

```bash
cd ~/dsh-study-coach && node doctor.mjs
```

Restart DSH. The sidebar gets a **📚 Study Library** entry.

> Do **not** also add the plugin to the profile's `cordis.patch.yml` — the package ships its own patch layer, and declaring it twice raises `duplicate loader entry id`.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `DSH_STUDY_WORKSPACE` | auto-detected (`C:\Workspace` on Windows if present → `~/Workspace` → `~/Documents/Workspace`) | Root under which `<SUBJECT>/...` folders live |

Section folders (first existing wins, otherwise created):

| Section | Candidates |
| --- | --- |
| Lecture | `0_课程材料/讲义`, `讲义`, `lectures` |
| Homework | `0_课程材料/Tutorial`, `0_课程材料/作业`, `Tutorial`, `作业` |
| Past papers | `0_课程材料/试卷`, `试卷`, `exams` |
| Reference | `4_其他`, `参考`, `reference` |

Data lives in `$DSH_HOME/study/`:

```
study/
├── subjects.json            registered subjects
└── COMP2011/
    ├── topics.json          topics + mastery + next due
    ├── cards.json           question cards
    └── attempts.jsonl       append-only answer log
```

---

## Tools (agent side)

| Tool | Purpose |
| --- | --- |
| `study_library` | list subjects with files per section + note/question counts |
| `study_subjects` | same, plus unregistered folders found in the workspace |
| `study_add` | register / update a subject |
| `study_topics` | list or add topics (idempotent) |
| `study_cards` | list or add question cards (idempotent) |
| `study_plan` | what to review today, split into due vs. unseen |
| `study_drill` | pick N cards weighted towards weak topics |
| `study_check` | record one answer, update mastery and due date |
| `study_stats` | mastery report: bands, per lecture, weakest first |

Typical loop: **you drop files → the agent calls `study_library` → reads them → writes `study_topics` + `study_cards` → they appear in the panel.**

## HTTP routes

All under `/api/study-coach/`, mounted through `ctx.webServer`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `config` | section definitions |
| GET | `tree` | subjects → sections → files |
| GET | `state` | mastery, plan, notes, cards |
| POST | `upload` | multipart: `code`, `section`, `files` |
| POST | `delete` | delete one file (workspace only, else 403) |
| POST | `subject` | create / update a subject |
| POST | `drill` | pick cards |
| POST | `check` | record an answer |
| GET | `file` | stream a file (inline for pdf/images) |
| GET | `cards.csv` | export question cards as CSV (BOM, Excel / Anki friendly) |
| GET | `asset` | plugin-shipped images, e.g. `?name=payme.png` (whitelisted, read-only) |
| GET | `backup` | one JSON with every subject's progress + prefs |
| POST | `restore` | write a backup back (snapshots the current files first) |
| POST | `export` | generate summary / crib markdown |

Client requests use **relative** paths (`api/study-coach/...`) because the DSH shell serves the GUI with `<base href="./">`; a root-absolute path breaks under a sub-path deployment. The client falls back to the absolute path on 404.

---

## Design notes (things that bit me)

1. **`jsx(type, props, key)`** — the third argument is the key, not children. Everything here uses `react.createElement` to keep children unambiguous.
2. **Sidebar icons must be `<svg>`** and receive a `size` prop; an emoji in a `<span>` renders nothing.
3. **`slots.inject(name, cb)`** only runs `cb` when the shell actually declares that seat. Hosts without it simply show no panel instead of failing boot — always wrap registration in `try/catch` as well.
4. **Every `object` in a tool's JSON schema needs `additionalProperties: true|false`**, otherwise DSH throws `JsonSchemaError` inside `apply()` and the whole plugin fails to load — including its routes.
5. **Testing with a fake `ctx` hides schema errors.** Validate with the real `@deepseek-ai/dsh-tools` before shipping.

## Development

```bash
node test.mjs                    # core logic, 24 assertions, uses a temp DSH_HOME
node study-reset.mjs COMP2011     # wipe mastery, keep topics + cards
```

## License

MIT

## Study calendar

Every subject keeps its own calendar — nothing is shared across subjects.

- Month grid; days with events show coloured dots, today is outlined
- Click any day to add an event: **exam / quiz / assignment / class / other**, with optional time and note
- Event list underneath, past events dimmed; one click to delete
- **Export .ics** → standard iCalendar carrying a VALARM trigger 1 day before the event, so it imports into Google Calendar, Outlook, Apple Calendar or a phone calendar with the reminder already set

Stored at `$DSH_HOME/study/<CODE>/schedule.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `schedule?code=` | events + available event types |
| POST | `schedule` | create / update one event |
| POST | `schedule/delete` | remove one event |
| GET | `schedule/ics?code=` | download `.ics` |

## Ask AI from the panel

The **Ask** button opens a side drawer. Questions go through DSH's own model service
(`ctx.llm.listProviders` → `listModels` → `prepareCall` → `BlockAssembler`), so no API key is
needed and no second process is spawned.

Each question carries the subject's topic list and mastery levels as context, so "this chapter"
or "that formula" resolves against what you actually have.

Graceful degradation: if the host exposes no `llm` service, the drawer says so instead of
hanging. No crash, no blank panel.

> The SDK (`@deepseek-ai/dsh-llm`) is resolved from the DSH **install root**, not from the plugin
> folder — a junction-installed plugin cannot reach `Program Files` through normal node
> resolution. Embedding this elsewhere? Set `DSH_INSTALL_DIR`.

## Import a whole folder

The sidebar has **Import folder** next to **New subject**:

1. Pick a folder with the native picker (`webkitdirectory`)
2. It reads every file, guesses the section from the path/filename
   (`lecture|讲义|lec N` → Lecture, `tutorial|作业|hw` → Homework,
   `exam|试卷|past paper` → Papers, everything else → Reference)
3. A confirm dialog shows the grouping, each group has a dropdown to re-assign it,
   and the subject code is pre-filled from the folder name (e.g. `COMP2011`)
4. Uploads in batches of 20 and creates the subject with all four section folders

One folder in, a finished subject folder tree out.

## The client-bundle trap (read this if your panel never appears)

`dsh.client.platform: "web"` alone is **not enough** when your client code uses
`ctx.slots`. The profile loader only injects the client services you declare:

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-ui-slots"]
  }
}
```

Without `inject`, the bundle loads with no `slots` service, `apply()` returns early,
and the panel silently never registers — **no error in any log**. Comparing with
`@goodandready/dsh-vision-bridge` and `@linxin666/dsh-client-ui-skill-explorer` is what
revealed it.

## Bilingual completion (v0.7)

The exam papers are in English, notes are in Chinese, so every topic wants both titles.
The **🌐 翻译** button in the top bar opens a drawer:

- direction: **Chinese → English** or **English → Chinese**
- tick **retranslate existing** to overwrite correct-but-stale entries
- runs on the DSH model service and writes straight back into `topics.json`

Notes, summaries and crib sheets are bilingual immediately afterwards. Also callable as a tool:

```bash
study_translate { code: "COMP2011", target: "en", dryRun: true }
study_translate { code: "COMP2011", target: "en" }
```

Two details worth knowing: it batches **12 entries per call** (a whole subject overflows the
context, and batching lets a failed chunk be retried alone), and `parsePairs()` tolerates the
usual model sloppiness (fenced code blocks, prose around the JSON, a trailing comma) by falling
back to line-by-line `key: value` parsing and matching on whitespace-insensitive originals.

## Source manifests: generated vs. original (v0.7)

Filename patterns are only a fallback now. The real authority is the per-subject manifest:

```
<DSH_HOME>/study/<CODE>/generated.json
{
  "files":    { "<abs path>": { "at": "...", "by": "user|backfill" } },   // always generated
  "unmarked": { "<abs path>": { "at": "...", "by": "user" } }            // always original
}
```

Resolution order: `files` → `unmarked` → filename regex → default (original). Every file card has
a small `⇄` button that flips it between original and AI-made and records the decision, so a
teacher-issued `总结.pdf` can be corrected once and stays corrected.

Backfill the files that were already there:

```bash
node mark-generated.mjs          # dry run
node mark-generated.mjs --apply  # write
```

## The "more folders" section (v0.7)

The four fixed sections only recognise fixed directory names. Real subject folders look like:

```
COMP2011/
├── 0_课程材料/          -> lecture 10 / homework 6 / papers 4
├── 1_复习资料/   12 files   <- used to be invisible in the panel
├── 2_图解笔记/    1 file
└── 3_练习题/     12 files   <- used to be invisible in the panel
```

A dynamic **More folders** section now lists everything under the subject root that the four
fixed sections did not claim, with its relative path, skipping `_`/`.` directories such as
`_build`. Nothing is listed twice. It is browse-only: dropping a file there redirects to
Reference so nothing gets scattered into the subject root. The chip only appears when it has files.

## Tests

```bash
node test.mjs           # 64 assertions: core logic, manifest resolution, translation, dirty JSON, extra section
node test-render.mjs    # 15 render branches through the real react
node check-tools.mjs    # real @deepseek-ai/dsh-tools: validates all 11 tool schemas via apply()
```

Do not skip `check-tools.mjs`: one missing `additionalProperties` makes DSH throw inside `apply()`,
which kills the whole plugin — routes included — while the UI only shows "loading". A fake ctx
hides it.

## One-click generation: lectures in, study material out (v0.8)

**🪄 一键生成** in the top bar. Pick lectures, tick the outputs, press start.

```
lectures (PDF / PPTX / DOCX)
   │ 1. extract   PyMuPDF / python-docx / python-pptx, already inside the DSH runtime
   ▼
plain text
   │ 2. refine    one model call per lecture, structured JSON:
   │              topics[{lecture,title,titleEn,summary,points}]
   │              cards[{topic,question,answer,marks}]
   │              note (markdown for that lecture)
   ▼
topics.json / cards.json  (idempotent — re-running never duplicates)
   │ 3. render
   ▼
1_复习资料/
  ├── COMP2011_Lec6-9_自动笔记.docx / .pdf
  ├── COMP2011_Lec6-9_总结.docx / .pdf
  ├── COMP2011_Lec6-9_速记卡.docx / .pdf
  └── COMP2011_Lec6-9_讲义.pptx
```

Every artifact is recorded in the subject's generated manifest, so the panel keeps them in a
separate block from the real lecture files.

**Markdown never lands in the library.** The body is only the raw material for typesetting and
lives under `~/.dsh/study/<CODE>/.build/`. The notes tab reads the library, so ticking "📝 笔记"
always renders Word as well — unticking Word cannot leave you with "the run finished and produced
nothing". If the Word step itself fails, the body is copied into the library as a `.md` fallback
so the notes tab can still read it.

### Why each step looks like this

| Decision | Why |
| --- | --- |
| **One lecture per model call**, never batched | Ten decks in one prompt gets you a vague outline. One at a time gets you specific concepts. |
| **Structured JSON**, not free markdown | Free text cannot be written into topics.json, so it cannot be drilled or tracked. |
| **Text cache** at `study/<CODE>/extract/<sha1>.json` | Extraction costs seconds and the pipeline may rerun. Key = path + size + mtime, so editing a file invalidates it. |
| **Async job + polling** | Extraction plus refinement takes minutes; a hanging HTTP request times out. `start` returns a jobId immediately. |
| **Every step may fail alone** | A text-less PDF is skipped and reported, a failed model call keeps what is done, and a broken Word export still leaves the .md. |

Model handling: strict JSON with tolerance for code fences, prose and trailing commas (`parseModelJson`);
text clipped to 18000 chars per file; cards are attached to topics by exact title first, then one
containment pass, and unmatched cards are counted in the log instead of silently dropped.

### Where Python comes from

Nothing to `pip install`. The DSH runtime already ships:

```
$DSH_HOME/dsh-runtimes/<any>/dependencies/python/python.exe
  ├── pymupdf      PDF text
  ├── python-docx  .docx read/write
  └── python-pptx  .pptx build
```

Lookup order: `DSH_STUDY_PYTHON` → dsh-runtimes glob → `python` on PATH. With none found, the panel
says so instead of pretending to run.

### Re-render without re-running the model

**只重排文档** / `POST /pipeline/render` rebuilds Word and PPT from the topics already in the library —
no model calls, a few seconds.

### Tool

```bash
study_generate { code: "COMP2011" }                       # every extractable file in the lecture section
study_generate { code: "COMP2011", files: [...] }
study_generate { code: "COMP2011", want: { pptx: false } }
```

`wait: true` (default) blocks until finished, up to 5 minutes; `wait: false` only starts the job.

## The crash worth documenting (v0.8.1)

```js
export const inject = ['tools', 'webServer']
export function apply(ctx) {
  const llm = ctx.llm   // throws: cannot get property "llm" without inject
}
```

The cordis `Context` is a Proxy: **reading a service that is not declared in `inject` throws**.
Inside an HTTP handler that is survivable (try/catch, 500 response). Inside a background task it is
an unhandled rejection, and an unhandled rejection **kills the whole DSH host**:

```
Host fatal error: dsh: fatal load failure: Error: cannot get property "llm" without inject
```

Two correct fixes, do not mix them:

| llm is… | do this |
| --- | --- |
| a **hard** dependency | put `'llm'` in `export const inject` — the plugin then simply does not activate without it |
| a **soft** dependency (panel must still open) | `ctx.inject(['llm'], (c) => { … c.llm … })` and keep that child ctx |

This plugin takes the second route, because a headless environment has no llm but the library panel is
still useful. Plus two rules that are easy to forget:

1. **Only the callback argument of `ctx.inject` is a usable ctx** for that service.
2. **Every background task needs `.catch()`** — one missing catch and a single failed model call exits DSH.

`test.mjs` section `[14]` feeds a Proxy ctx that throws on every property read, so this cannot regress
silently.

## Practice papers that copy a real past paper (v0.9)

**📝 出练习卷** in the top bar. Same rule as the notes: copy the format, replace the content.

### Why not just "ask the model for a paper"

You already have the real papers (`2024 Final Paper`, `2024 CA Test 1`). An invented layout
does not match the exam hall:

| Real paper | Invented paper |
| --- | --- |
| Section A 8 × 5 marks, Section B 3 × 20 marks | even split, or a pile of 10-mark questions |
| `Page 1 of 8` header + Programme/Year, three-column footer | nothing |
| `A1` numbering, `(a)(b)(c)` sub-parts, right-aligned `[3 marks]` | hand-typed numbering |
| English, Times New Roman, letter-spaced all-caps MODULE TITLE | a different font and layout |

So the flow runs the other way: **parse the real paper's skeleton first, then fill it**.

### Two steps

```
1. Analyse format   real paper PDF/DOCX → extract text → model returns a skeleton
                    {cover fields, questions per section, marks per question,
                     instruction lines, language, sub-parts, phrasing samples}
                    cached at $DSH_HOME/study/<CODE>/paper-template.json

2. Pick a range     two dropdowns "from Ch1 to Ch5" (options come from topics.lecture)
                    → one model call per section → assemble JSON → make_paper.py
                    → 3_练习题/<CODE>_Ch1-Ch5_练习卷_<date>.docx
                    → ..._答案.docx (with grading reference)
```

### What gets aligned automatically

The real paper says "Section A is worth 40 marks", "Each question is worth FIVE marks",
"contains EIGHT questions". Change the question count and those lines lie, so
`fixInstruction()` / `fixCoverInstructions()` rewrite them to the actual values, singular and plural
included (`ONE question`, not `ONE questions`). Section marks are the sum of the generated questions,
not the copied plan.

### The skeleton is editable

`paper-template.json` is plain JSON. If the model misreads a section, edit the file — no re-analysis
needed. Its `samples` field is the phrasing anchor; drop a real question stem in there to steer the tone.

### Tool

```bash
study_paper { code: "COMP2011", analyze: true, template: "<real paper path>" }
study_paper { code: "COMP2011", from: 1, to: 5 }
study_paper { code: "COMP2011", from: 6, to: 10, answers: true }
```

### Routes

| method | path | purpose |
| --- | --- | --- |
| GET | `paper/template?code=` | cached skeleton |
| POST | `paper/analyze` | `{code, file}` parse a real paper (one model call) |
| GET | `paper/scope?code=` | selectable chapters + past papers usable as templates |
| POST | `paper/generate` | `{code, from, to, answers}` → async job, poll `pipeline/status` |

## The paper tab: one question per screen, write on it (v0.18 ~ v0.21)

Notes and papers are different jobs: notes want a full screen of text, papers want a blank area
to work in. So the top bar has its own **📄 试卷** tab now.

**One question per screen**

`flattenPaper()` on the server flattens a paper into one item per question
(`no / section / stem / parts / table / figure / marks / answer`); the panel shows one at a time
with `◀ 上一题` / `下一题 ▶` underneath.

**Draw the answer with the mouse or a finger**

`<canvas>` + Pointer Events, `touchAction:none`, `setPointerCapture` so a stroke keeps going when
the pointer leaves the board. Four pen colours, three widths, eraser, undo, clear.

Two things to know before touching it:

- **Strokes do not live in `useState`.** Calling setState on every move re-renders the whole page
  dozens of times per second and the pen starts lagging. They live in a `useRef` (`inkStore`), and
  `pointermove` only draws the newest segment.
- **The board changes size** (the 大板 toggle, the answer box opening, window resize) and a canvas
  bitmap reset wipes the strokes. `repaintInk()` re-sizes by `devicePixelRatio` and redraws
  everything; a `ResizeObserver` watches the board itself, because `window.resize` never fires when
  only that element grows.

The eraser uses `globalCompositeOperation='destination-out'` so erasing is genuinely transparent
rather than white paint. Strokes are keyed by `"paperPath::A3"` — every paper numbers its questions
the same way, so without the prefix two papers share one canvas.

## Questions that carry their own figure (v0.19 ~ v0.21)

"The figure below shows a weighted graph…" cannot be answered with text alone. The model cannot
draw, but it can describe the graph, so it emits structured data and both renderers draw it:

```json
"figure": {
  "kind": "graph",
  "directed": false,
  "nodes": ["A","B","C","D","E"],
  "edges": [["A","B",4],["A","C",2],["B","C",1]]
}
```

| Where | How |
| --- | --- |
| Panel (paper tab) | `paperFigureSvg()` in `lib/client.js` → SVG, vertices on a circle, weights on edge midpoints |
| Word (exported paper) | `scripts/_figure.py` → PIL draws a PNG (4x supersampling, downscaled) and it is inserted into the docx |

**Both renderers must agree on layout**: `LOGIC_W / LOGIC_H / EDGE_R` exist twice, once per side.
Change one, change the other.

`normalizeFigure()` in `lib/paper.js` absorbs the ways models slack off: nodes as strings or
objects, edges as arrays or `{from,to,weight}`, weight spelled `w` / `weight` / `cost` or missing,
`directed` omitted entirely. **Edges naming unknown vertices, self loops and unrecognisable shapes
are dropped** — a figure whose numbers disagree with the stem is worse than no figure.

Anything a graph cannot express (a teacher's hand drawing, a circuit photo, a slide screenshot) can
be attached by hand with **🖼 配图** in the question header; it is stored in
`study/<CODE>/paper-images.json` keyed by `"<paper file name>::A3"`.

> Images are served by `GET raw?path=` as raw bytes — `preview` wraps content in JSON for the panel
> and cannot be used as an `<img src>`.

## Other subjects: pull the pictures out of the source files (v0.22)

`figure` only expresses "vertices and edges", which is discrete maths shaped. **Everyone else has
circuit diagrams, chemical structures, histology slides, maps, financial statements** — a model
cannot describe any of those in text.

But those pictures are already inside the PDF / PPTX / DOCX the teacher handed out.

`scripts/extract_images.py`:

| Source | How |
| --- | --- |
| PDF | PyMuPDF walks pages and pulls the embedded bitmaps, **deduplicated by content md5** (headers, logos and watermarks repeat on every page — without this you get N copies of the same image) |
| PPTX / DOCX / XLSX | they are zips; read `ppt/media/`, `word/media/`, `xl/media/` |
| Anything else | reported as unsupported, nothing else breaks |

- anything under 48px is dropped (bullets, icons, rules)
- `emf` / `wmf` skipped (browsers cannot show them)
- output goes to `~/.dsh/study/<CODE>/figures/`
- **parentheses in the file name are replaced** — the path ends up inside Markdown's
  `![alt](path)`, and a `)` in it truncates the syntax so the image never reaches Word

In the panel: paper tab → **🖼 配图** in the question header → "📥 从讲义 / 真卷里抽图" →
pick a file → the extracted images are listed below, one click attaches one to the question.

## Figures in the generated notes (v0.22)

After a notes run, each lecture is also scraped for images and `composeNote()` appends them at the
end of that chapter:

```markdown
#### 这一章的图（来自讲义）

![](/home/you/.dsh/study/ITP3902/figures/Lec 5 - Graph 1-image1.png)
```

At most 6 per chapter, so a note does not turn into a photo album. `make_docx.py` recognises
`![alt](path)` lines and inserts the picture 14.5cm wide, centred; a non-empty `alt` becomes an
italic grey caption.

A failed extraction never breaks the note — plenty of lecture decks are pure text, and vector
drawings cannot be scraped this way at all.

## Requirements & cross-platform (v0.9.4)

Works on **Windows / macOS / Linux**. Nothing to install beyond what DSH already ships.

```bash
node doctor.mjs      # 告诉这台机器上哪些功能能用、缺什么
```

`doctor.mjs` checks: Node version, workspace folder, DSH runtime (`@deepseek-ai/dsh-llm`),
Python capabilities (pymupdf / python-docx / python-pptx), and whether the data folder is writable.
Each failure tells you the exact fix.

| what | how it is found |
| --- | --- |
| **Workspace** | `DSH_STUDY_WORKSPACE` → `C:\Workspace` (Windows, if it exists) → `~/Workspace` → `~/Documents/Workspace` |
| **DSH runtime** | `DSH_INSTALL_DIR` → Electron `process.resourcesPath` → derived from `process.execPath` (Win/Linux `<dir>/resources/app`, macOS `<App>.app/Contents/Resources/app`) → platform default install paths |
| **Python** | `DSH_STUDY_PYTHON` → `$DSH_HOME/dsh-runtimes/*/dependencies/python` (`python.exe` on Windows, `bin/python3` on POSIX) → `python` / `python3` on PATH. All candidates are probed and **the one with the most libraries wins** — a bare system Python without `python-docx` will not shadow the DSH runtime. |
| **Fonts** | `scripts/_fonts.py` picks per platform: Windows 微软雅黑/Consolas, macOS PingFang SC/Menlo, Linux Noto Sans CJK/DejaVu Sans Mono |

### Environment variables

| var | default | meaning |
| --- | --- | --- |
| `DSH_STUDY_WORKSPACE` | auto-detected | where subject folders live |
| `DSH_STUDY_PYTHON` | auto-detected | interpreter used for PDF/DOCX/PPTX |
| `DSH_INSTALL_DIR` | auto-detected | DSH install root (only needed if resolution fails) |
| `DSH_STUDY_MODEL` | — | pin a channel: `provider/model` |
| `DSH_STUDY_PROVIDER` | — | prefer providers, comma separated |

### Tests

```bash
node test.mjs           # 224 assertions, pure logic — runs on CI, no DSH / no Python needed
node test-render.mjs    # 35 render branches through the real react (needs a DSH install)
node check-tools.mjs    # validates all 14 tool schemas via the real @deepseek-ai/dsh-tools
node doctor.mjs         # environment self-check
node audit.mjs          # cross-platform audit: hard-coded paths, platform-only commands
```

CI (`.github/workflows/test.yml`) runs `test.mjs` on **ubuntu / windows / macos × node 22 / 24**,
compiles every Python script with a pinned interpreter, and runs the cross-platform audit
(advisory — a runner without DSH can only check half of it).

---

## Support

Everything here is free and MIT-licensed. **No feature is locked behind a payment** — the plan,
the papers, the drilling, all of it behaves the same whether anyone tips or not.

If it saved you a night before an exam and you feel like it:

<img src="assets/payme-hk.png" alt="HK: AlipayHK / PayMe / FPS" width="180"> <img src="assets/payme.png" alt="CN: WeChat Pay" width="180">

Hong Kong — **AlipayHK / PayMe / FPS** · Mainland — **WeChat Pay**.
The same two codes live in the panel: click **☕** and switch between 🇭🇰 / 🇨🇳.
Forking this for your own class? Drop your own images at `assets/payme-hk.png` and `assets/payme.png` (600×600);
no code change is needed, and the panel hides whichever file is missing.
