/**
 * dsh-study-coach / pipeline.js
 *
 * 把「一堆讲义」变成「一套能学的东西」：
 *
 *   讲义 PDF/PPTX/DOCX
 *        │  ① 抽文本（python + PyMuPDF / python-docx / python-pptx）
 *        ▼
 *   纯文本
 *        │  ② 模型按结构化 JSON 提炼（每个文件一次，别一次塞十个文件）
 *        ▼
 *   { topics, cards, note }
 *        │  ③ 写进 topics.json / cards.json（幂等，重复跑不会翻倍）
 *        ▼
 *   知识点 + 题卡（面板立刻能刷题）
 *        │  ④ 出文档：笔记 / 总结 / 速记 / PPT
 *        ▼
 *   1_复习资料/ 里的 .md .docx .pptx（自动标成「DSH 生成」）
 *
 * 关键取舍：
 *  - **每个文件单独提炼**，不合并。十个课件塞一个 prompt，模型只会给你一份泛泛的大纲。
 *  - **进度可轮询**：流程可能跑几分钟，HTTP 不能挂着。start 立刻返回 jobId，前端 polling。
 *  - **每一步都可失败**：抽不出字就跳过那个文件并记下来；模型翻车就保留已完成的；文档生成失败
 *    至少 md 还在。整条链不允许"全有或全无"。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  readTopics, addTopics, addCards, listSubjects, stats, setGeneratedFlag, dshHome,
} from './core.js'
import { buildDocument, WORKSPACE } from './routes.js'
import { extractMany, scopeLabel, lectureTag } from './extract.js'
import { runScript, pythonCaps } from './python.js'
import { docxToPdf } from './pdf.js'
import { readPrefs, prefsToPrompt } from './prefs.js'

/* --------------------------------------------------------------- jobs */
// 进程内任务表。DSH 重启就没了 —— 这是对的：重启后旧任务没意义。
const JOBS = new Map()
const JOB_TTL_MS = 2 * 60 * 60 * 1000

export function newJob(code, total) {
  const id = 'jp' + crypto.randomBytes(6).toString('hex')
  const job = {
    id,
    code,
    startedAt: Date.now(),
    finishedAt: 0,
    state: 'running', // running | done | failed | partial
    step: '准备',
    progress: { done: 0, total },
    logs: [],
    out: { topics: 0, cards: 0, files: [] },
    errors: [],
  }
  JOBS.set(id, job)
  // 顺手清掉过期的，别让 Map 长成肿瘤
  const now = Date.now()
  for (const [k, v] of JOBS) {
    if (v.finishedAt && now - v.finishedAt > JOB_TTL_MS) JOBS.delete(k)
  }
  return job
}

export function getJob(id) {
  return JOBS.get(id) || null
}

export function log(job, text, kind) {
  job.logs.push({ at: Date.now(), text: String(text), kind: kind || 'info' })
  if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)
  // 同时落一份到磁盘：面板卡住时，从外面也能看到到底走到哪一步了
  try {
    const dir = buildDir(job.code || 'unknown')
    fs.appendFileSync(
      path.join(dir, 'pipeline.log'),
      new Date().toISOString().slice(11, 19) + ' [' + (kind || 'info') + '] ' + String(text) + '\r\n',
      'utf8',
    )
  } catch {}
}

export function step(job, name, done, total) {
  job.step = name
  if (done != null) job.progress = { done, total: total ?? job.progress.total }
}

/* ------------------------------------------------------ 模型：提炼知识点 */
const STYLE_SEP = '\n\n【风格要求（用户在面板里选的，优先级最高）】\n'

const EXTRACT_PROMPT = `你是一位IT/数学科目助教，正在把一份讲义整理成中英对照的复习材料。

严格按下面的 JSON 输出，不要任何解释、不要 Markdown 代码块：
{
  "topics": [
    {
      "lecture": "Lec 6",
      "title": "中文知识点名（20 字以内，具体到概念，不要写「本章内容」）",
      "titleEn": "English term, standard, Title Case",
      "summary": "一句话讲清这个概念是什么（中文，40 字以内）",
      "points": ["要点1（中文，一句话）", "要点2"]
    }
  ],
  "cards": [
    {
      "topic": "这里填上面某个 topic 的 title，必须逐字一致",
      "question": "英文题面，像考试那样",
      "answer": "答案，能用公式就用公式",
      "marks": 2
    }
  ],
  "note": "这一节的 Markdown 笔记，用 ## 分小节，公式用普通文本，重点用 **加粗**"
}

要求：
1. topics 只挑**真正会被考的**概念，一节 3~8 个，宁缺毋滥。
2. cards 每个 topic 配 1~2 道，题目用英文（考试就是这个语言），答案给能直接背的。
3. note 写成能直接复习的样子：定义、公式、常见陷阱各一小段，600 字以内。
4. 讲义里出现英文术语时，title 用中文、titleEn 保留原英文写法。
5. 不要编造讲义里没有的内容。`

function parseModelJson(raw) {
  const text = String(raw || '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const body = text.slice(start, end + 1).replace(/,\s*([\]}])/g, '$1')
  try {
    return JSON.parse(body)
  } catch {}
  return null
}

/** 一次提炼调用：一张讲义 → 清洗过的 { topics, cards, note }。失败原样返回原因。 */
async function refineCall(ctx, fileInfo, text, prefs) {
  const lec = lectureTag(fileInfo.name)
  const user = [
    `文件名：${fileInfo.name}`,
    lec ? `章节标签：${lec}` : '',
    '--- 讲义正文开始 ---',
    text,
    '--- 讲义正文结束 ---',
  ].filter(Boolean).join('\n')

  const r = await ctx.__runModel({
    // 把用户选的生成偏好接在固定 prompt 后面 —— 选项要真的改变输出，
    // 不能只在面板上好看。
    system: EXTRACT_PROMPT + STYLE_SEP + prefsToPrompt(prefs),
    user,
    maxTokens: 6000,
  })

  if (!r.ok) return { ok: false, error: r.error, detail: r.detail }
  const j = parseModelJson(r.answer)
  if (!j) {
    // 把模型的原始输出丢进宿主日志 —— 面板只显示「bad-json」，看不到它到底吐了什么
    try {
      console.warn('[study-coach] bad-json |', fileInfo.name, '| len:', String(r.answer || '').length, '| raw:', String(r.answer || '').slice(0, 600))
    } catch {}
    return { ok: false, error: 'bad-json', detail: '模型没吐出能解析的 JSON', raw: String(r.answer).slice(0, 400) }
  }

  const topics = Array.isArray(j.topics) ? j.topics : []
  const cards = Array.isArray(j.cards) ? j.cards : []
  return {
    ok: true,
    lecture: lec || (topics[0] && topics[0].lecture) || '',
    topics: topics
      .map((t) => ({
        lecture: String(t.lecture || lec || '未分组').slice(0, 40),
        title: String(t.title || '').trim().slice(0, 120),
        titleEn: String(t.titleEn || '').trim().slice(0, 160),
        summary: String(t.summary || '').trim().slice(0, 300),
        points: Array.isArray(t.points) ? t.points.map((p) => String(p).slice(0, 300)).slice(0, 8) : [],
      }))
      .filter((t) => t.title),
    cards: cards
      .map((c) => ({
        topic: String(c.topic || '').trim(),
        question: String(c.question || '').trim().slice(0, 600),
        answer: String(c.answer || '').trim().slice(0, 800),
        marks: Number(c.marks) || 1,
      }))
      .filter((c) => c.question && c.answer),
    note: String(j.note || '').trim(),
  }
}

/** 把拆开提炼的几段合起来：知识点按标题去重，题卡直接拼。 */
function mergeParts(parts) {
  const seen = new Set()
  const topics = []
  const cards = []
  for (const p of parts) {
    for (const t of p.topics) {
      const k = t.title.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      topics.push(t)
    }
    for (const c of p.cards) cards.push(c)
  }
  return {
    lecture: (parts[0] && parts[0].lecture) || '',
    topics,
    cards,
    note: parts.map((p) => p.note).filter(Boolean).join('\n\n'),
  }
}

export async function refineOne(ctx, job, fileInfo, index, total, prefs) {
  // 一个文件的文本可能很长，掐到头 18000 字：课件正文塞太多只会拖慢还容易丢格式
  const full = String(fileInfo.text || '').slice(0, 18000)
  const pack = (r) => ({
    ok: true,
    file: fileInfo.file,
    name: fileInfo.name,
    lecture: r.lecture,
    topics: r.topics,
    cards: r.cards,
    note: r.note,
    index,
    total,
  })

  let r = await refineCall(ctx, fileInfo, full, prefs)
  if (r.ok) return pack(r)

  // 偶发的空正文 / 坏 JSON：原样再来一次，别让一页讲义白跑
  log(job, `  ${fileInfo.name} 第一次没成（${r.error}），原样重试`, 'warn')
  r = await refineCall(ctx, fileInfo, full, prefs)
  if (r.ok) return pack(r)

  // 还不行：多半是整份太长、模型吐到一半被截断 —— 拆两半各提一次再合并
  if (full.length > 3000) {
    log(job, `  ${fileInfo.name} 还是不成（${r.error}），拆成两半再试`, 'warn')
    const mid = Math.floor(full.length / 2)
    let cut = full.lastIndexOf('\n', mid)
    if (cut < mid * 0.6) cut = mid
    const got = []
    for (const part of [full.slice(0, cut), full.slice(cut)]) {
      if (!String(part).trim()) continue
      const rr = await refineCall(ctx, fileInfo, part, prefs)
      if (rr.ok) got.push(rr)
    }
    if (got.length) {
      log(job, `  ${fileInfo.name} 拆半后救回 ${got.length}/2 段`, 'ok')
      return pack(mergeParts(got))
    }
  }

  return { ok: false, error: r.error, detail: r.detail, name: fileInfo.name }
}

/* -------------------------------------------------------- 文档落盘 */
function reviewDir(code) {
  // 优先写进用户自己的复习目录（1_复习资料），没有就建一个
  const root = path.join(WORKSPACE, String(code).toUpperCase())
  const cands = ['1_复习资料', '复习资料', 'notes']
  for (const c of cands) {
    const p = path.join(root, c)
    try {
      if (fs.statSync(p).isDirectory()) return p
    } catch {}
  }
  const p = path.join(root, cands[0])
  try {
    fs.mkdirSync(p, { recursive: true })
  } catch {}
  return p
}

/**
 * 中间产物目录：Markdown 只是排版的原料，**不该出现在资料库里**。
 * 主人明确说过「生成的笔记不要 md」—— 所以 md 写到这里，用完留在后台，
 * 科目目录里只落 docx / pdf / pptx。
 */
export function buildDir(code) {
  const p = path.join(dshHome(), 'study', String(code).toUpperCase(), '.build')
  try { fs.mkdirSync(p, { recursive: true }) } catch {}
  return p
}

function writeOut(dir, name, content) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content, 'utf8')
  return p
}

/** 把提炼结果拼成一份可直接阅读的 Markdown 笔记 */
/* ------------------------------------------------------ 笔记模式（不提炼 JSON） */
// 只要一份「能读的笔记」时走这条：一次调用直接拿 Markdown。
// 比提炼 JSON 稳得多 —— 模型不用同时记住结构、字段名和字数限制。
const NOTE_PROMPT = `你是一位 IT / 数学科目的助教，正在把一份讲义整理成**能直接拿来复习的笔记**。

规则：
1. 中文讲解；专业术语后面用括号附英文原词，例如「最小生成树 (Minimum Spanning Tree)」。
2. 用 \`##\` 分小节，每个概念讲清楚：是什么、为什么成立、怎么用、常见陷阱。
3. 公式用普通文本（^ 表示幂，* 表示乘），不要 LaTeX。
4. 有对比关系就用表格，有步骤就写编号。
5. **只写讲义里出现过的内容**，不要补充课外知识，不要编例题。
6. 直接输出 Markdown 正文，**不要**用代码块包裹，不要写「以下是笔记」这类前言。`

/** 只出笔记：一段讲义 → 一段 Markdown */
async function noteOnly(ctx, fileInfo, prefs) {
  const lec = lectureTag(fileInfo.name)
  const body = String(fileInfo.text || '').slice(0, 14000)
  const r = await ctx.__runModel({
    system: NOTE_PROMPT + STYLE_SEP + prefsToPrompt(prefs),
    user: [
      `文件名：${fileInfo.name}`,
      lec ? `章节：${lec}` : '',
      '--- 讲义正文开始 ---',
      body,
      '--- 讲义正文结束 ---',
    ].filter(Boolean).join('\n'),
    maxTokens: 6000,
  })
  if (!r.ok) return { ok: false, error: r.error, detail: r.detail }
  const md = String(r.answer || '').trim()
  if (!md) return { ok: false, error: 'empty' }
  return { ok: true, lecture: lec, md }
}

export function composeNote(code, refined, { scope = '' } = {}) {
  const subj = listSubjects().find((s) => String(s.code).toUpperCase() === String(code).toUpperCase())
  const title = `${code}${scope ? ' ' + scope : ''} 学习笔记`
  const L = []
  L.push(`# ${title}`)
  L.push('')
  if (subj && subj.name) L.push(`科目：${subj.name}`)
  L.push(`生成时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
  L.push(`来源：${refined.map((r) => r.name).join('、')}`)
  L.push('')
  L.push('---')
  L.push('')

  // 先一张总览表，翻的时候能定位
  L.push('## 一览')
  L.push('')
  L.push('| 章节 | 知识点 | English |')
  L.push('| --- | --- | --- |')
  for (const r of refined) {
    for (const t of r.topics) {
      L.push(`| ${t.lecture} | ${t.title} | ${t.titleEn || ''} |`)
    }
  }
  L.push('')

  for (const r of refined) {
    L.push(`## ${r.lecture || r.name}`)
    L.push('')
    L.push(`> 来源：${r.name}`)
    L.push('')
    // 笔记模式：模型直接给了一段 Markdown，原样放进来
    if (r.md) {
      L.push(r.md)
      L.push('')
    }
    if (r.note) {
      L.push(r.note)
      L.push('')
    }
    for (const t of r.topics) {
      L.push(`### ${t.title}${t.titleEn ? ' / ' + t.titleEn : ''}`)
      L.push('')
      if (t.summary) L.push(t.summary)
      if (t.points.length) {
        L.push('')
        for (const p of t.points) L.push(`- ${p}`)
      }
      L.push('')
    }
    if (r.cards.length) {
      L.push('#### 练习')
      L.push('')
      r.cards.forEach((c, i) => {
        L.push(`${i + 1}. ${c.question}　（${c.marks} 分）`)
        L.push(`   - 答：${c.answer}`)
      })
      L.push('')
    }
  }
  return L.join('\n')
}

/* ------------------------------------------------------------ 主流程 */
/**
 * 起一条流水线。立刻返回 job，后续进度查 getJob(id)。
 *
 * opts: {
 *   code, files: [绝对路径],
 *   want: { note: bool, summary: bool, cheatsheet: bool, docx: bool, pptx: bool },
 *   seedTopics: bool,   // 是否把知识点写进 topics.json（默认 true）
 * }
 */
export function startPipeline(ctx, opts) {
  const code = String(opts.code || '').toUpperCase()
  const files = (opts.files || []).filter(Boolean)
  const want = {
    note: true, summary: true, cheatsheet: false, docx: true, pptx: true, pdf: true,
    // 默认**不**提炼知识点 —— 大多数人要的是一份能读的笔记，不是一堆索引条目。
    // 想要知识点库/题卡，在面板里勾上「知识点」。
    topics: false,
    ...(opts.want || {}),
  }
  const job = newJob(code, files.length || 1)
  // 不 await：HTTP 立刻返回。
  // **必须接住 rejection** —— 这里冒出去就是 unhandled rejection，
  // cordis host 会直接 fatal 退出（0.8.0 崩过一次，就是 ctx.llm 那一抛）。
  runPipeline(ctx, job, { code, files, want, seedTopics: opts.seedTopics !== false }).catch((e) => {
    job.state = 'failed'
    job.finishedAt = Date.now()
    const msg = String((e && e.message) || e)
    job.errors.push({ stage: 'fatal', error: msg })
    log(job, '流水线内部异常（已兜住，没让宿主崩）：' + msg, 'err')
    try {
      ctx?.logger?.warn?.('[study-coach] pipeline crashed: ' + msg)
    } catch {}
  })
  return job
}

async function runPipeline(ctx, job, { code, files, want, seedTopics, prefs: prefsIn }) {
  // 生成偏好（图示多少 / 例题几道 / 详略 / 中英 / 公式）—— 一次读取，整条流水线用同一份
  const prefs = prefsIn || readPrefs()
  const caps = await pythonCaps()
  job.python = { path: caps.path, source: caps.source, version: caps.version, pdf: caps.pdf, docx: caps.docx, pptx: caps.pptx }
  if (!caps.path) {
    job.state = 'failed'
    job.finishedAt = Date.now()
    log(job, '找不到可用的 Python：抽讲义这一步做不了。', 'err')
    return
  }

  /* ① 抽文本 */
  step(job, '抽取讲义文本', 0, files.length)
  log(job, `开始抽 ${files.length} 份讲义的文本`)
  const ext = await extractMany(code, files, (i, total, name) => {
    step(job, `抽取文本 ${i}/${total}`, i, total)
    log(job, `已抽：${name}`)
  })
  for (const f of ext.failed) {
    log(job, `抽不出文字：${f.name}（${f.error}）`, 'warn')
    job.errors.push({ stage: 'extract', ...f })
  }
  if (!ext.texts.length) {
    job.state = 'failed'
    job.finishedAt = Date.now()
    step(job, '抽取讲义文本', files.length, files.length)
    log(job, '没有一份讲义能抽出文字，流水线停在这里。PDF 如果是扫描件，先 OCR 成文本再进来。', 'err')
    return
  }
  log(job, `抽取完成：${ext.okCount} 份有文字，合计 ${ext.texts.reduce((a, t) => a + t.chars, 0)} 字`)

  /* ② 逐份写笔记（默认）/ 逐份提炼知识点（勾了才走） */
  const refined = []
  const doTopics = want.topics === true
  const workDir = buildDir(code)   // 提前建：每份笔记成功就立刻落盘，别等最后
  step(job, doTopics ? '让模型提炼知识点' : '让模型写笔记', 0, ext.texts.length)
  for (let i = 0; i < ext.texts.length; i++) {
    const t = ext.texts[i]
    step(job, `${doTopics ? '提炼知识点' : '写笔记'} ${i + 1}/${ext.texts.length}`, i + 1, ext.texts.length)
    if (!doTopics) {
      log(job, `写笔记 ${i + 1}/${ext.texts.length}：${t.name}`)
      let r = await noteOnly(ctx, t, prefs)
      if (!r.ok) {
        // 连着调十几次会被通道限流，隔两秒再来一次通常就过了
        log(job, `  没成（${r.error}${r.detail ? ' / ' + r.detail : ''}），2 秒后重试一次`, 'warn')
        await new Promise((res) => setTimeout(res, 2000))
        r = await noteOnly(ctx, t, prefs)
      }
      if (!r.ok) {
        log(job, `笔记失败：${t.name}（${r.error}${r.detail ? ' / ' + r.detail : ''}）`, 'warn')
        job.errors.push({ stage: 'note', name: t.name, error: r.error, detail: r.detail })
        continue
      }
      refined.push({ name: t.name, lecture: r.lecture, md: r.md, topics: [], cards: [] })
      // 立刻落盘：后面 Word 排不出来，至少 .md 已经在 .build 里了
      try {
        fs.writeFileSync(path.join(workDir, `${t.name.replace(/[\\/:*?"<>|]/g, '_')}.note.md`), r.md, 'utf8')
      } catch {}
      log(job, `  → ${r.md.length} 字（已落盘）`)
      continue
    }
    log(job, `提炼 ${i + 1}/${ext.texts.length}：${t.name}`)
    const r = await refineOne(ctx, job, t, i, ext.texts.length, prefs)
    if (!r.ok) {
      log(job, `提炼失败：${t.name}（${r.error}）`, 'warn')
      job.errors.push({ stage: 'refine', name: t.name, error: r.error, detail: r.detail })
      continue
    }
    refined.push(r)
    log(job, `  → ${r.topics.length} 个知识点 / ${r.cards.length} 张题卡`)
  }
  if (!refined.length) {
    job.state = 'failed'
    job.finishedAt = Date.now()
    log(job, '一份都没提炼成功，检查模型服务（面板里「问」能不能用）。', 'err')
    return
  }

  /* ③ 写进知识点 / 题卡（只有勾了「知识点」才做） */
  let addedTopics = 0
  let addedCards = 0
  if (seedTopics && doTopics) {
    step(job, '写进知识点库')
    const all = []
    for (const r of refined) for (const t of r.topics) all.push(t)
    const at = addTopics(code, all)
    addedTopics = at.added
    job.out.topics = addedTopics
    log(job, `知识点：新增 ${at.added} 个（已有的跳过），现在共 ${at.total} 个`)

    // 题卡要挂到 topic.key 上：按 title 精确找，找不到就按包含关系兜一次
    const live = readTopics(code).topics
    const keyOf = (title) => {
      const exact = live.find((x) => x.title === title)
      if (exact) return exact.key
      const loose = live.find((x) => title && (x.title.includes(title) || title.includes(x.title)))
      return loose ? loose.key : ''
    }
    const cards = []
    let orphan = 0
    for (const r of refined) {
      for (const c of r.cards) {
        const key = keyOf(c.topic)
        if (!key) {
          orphan++
          continue
        }
        cards.push({
          topicKey: key,
          question: c.question,
          answer: c.answer,
          marks: c.marks,
          source: r.name,
        })
      }
    }
    if (cards.length) {
      const ac = addCards(code, cards)
      addedCards = ac.added
      job.out.cards = addedCards
      log(job, `题卡：新增 ${addedCards} 张${orphan ? `，${orphan} 张找不到对应知识点已丢弃` : ''}`)
    }
  }

  /* ④ 出文档 */
  // 关键：**资料目录里只落 docx / pdf / pptx**。
  // Markdown 只是排版的原料，写到 .build 里（主人明确说过不要 md）。
  const scope = scopeLabel(files)
  const dir = reviewDir(code)
  const work = buildDir(code)
  step(job, '生成文档')
  const base = `${code}_${scope}_自动笔记`
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
  let noteMdPath = ''

  // 笔记模式下「笔记」是必出的：就算面板上没勾，也按勾了处理
  if (want.note || !doTopics) {
    const md = composeNote(code, refined, { scope })
    noteMdPath = writeOut(workDir, `${base}.${stamp}.md`, md)
    log(job, `笔记正文已生成（${md.length} 字），正在排版…`)
  }

  // 总结 / 速记卡：也只在后台留 md，对外只给 docx / pdf
  const extras = []
  if (want.summary) {
    try {
      const d = buildDocument(code, { kind: 'summary', locale: 'both' })
      const p = writeOut(work, `${code}_${scope}_总结.${stamp}.md`, d.markdown)
      extras.push({ kind: 'summary', title: `${code} ${scope} 总结`, md: p })
      log(job, '总结正文已生成')
    } catch (e) {
      log(job, `总结生成失败：${e.message}`, 'warn')
    }
  }
  if (want.cheatsheet) {
    try {
      const d = buildDocument(code, { kind: 'cheatsheet', locale: 'both' })
      const p = writeOut(work, `${code}_${scope}_速记卡.${stamp}.md`, d.markdown)
      extras.push({ kind: 'cheatsheet', title: `${code} ${scope} 速记卡`, md: p })
      log(job, '速记卡正文已生成')
    } catch (e) {
      log(job, `速记卡生成失败：${e.message}`, 'warn')
    }
  }

  if (want.docx && noteMdPath) {
    step(job, '生成 Word')
    const outDocx = path.join(dir, base + '.docx')
    const r = await runScript('make_docx.py', [
      noteMdPath, outDocx, '--title', `${code} ${scope} 学习笔记`, '--subtitle', 'dsh-study-coach 自动生成',
    ], { timeoutMs: 180000 })
    if (r.ok) {
      job.out.files.push({ kind: 'docx', path: outDocx, name: path.basename(outDocx) })
      log(job, `Word → ${path.basename(outDocx)}（${Math.round(r.bytes / 1024)} KB）`)

      // PDF：排版固定、手机上直接能看。转不出来不算失败 —— docx 已经在了。
      if (want.pdf !== false) {
        step(job, '生成 PDF')
        const outPdf = path.join(dir, base + '.pdf')
        const pdf = await docxToPdf(outDocx, outPdf)
        if (pdf.ok) {
          job.out.files.push({ kind: 'pdf', path: outPdf, name: path.basename(outPdf) })
          log(job, `PDF → ${path.basename(outPdf)}（${pdf.via}）`)
        } else {
          log(job, `PDF 没转成：${pdf.detail || pdf.error}`, 'warn')
        }
      }
    } else {
      log(job, `Word 生成失败：${r.error}${r.detail ? ' / ' + r.detail : ''}`, 'warn')
      job.errors.push({ stage: 'docx', ...r })
    }
  }

  // 总结 / 速记卡：跟着 docx 走（不出 md 就没别的对外形态了）
  for (const ex of extras) {
    if (!want.docx) {
      log(job, `${ex.kind === 'summary' ? '总结' : '速记卡'}只生成了正文，没勾 Word/PDF 就没导出`, 'warn')
      continue
    }
    const outDocx = path.join(dir, path.basename(ex.md).replace(/\.\d+\.md$/, '.docx').replace(/\.md$/, '.docx'))
    const r = await runScript('make_docx.py', [ex.md, outDocx, '--title', ex.title], { timeoutMs: 180000 })
    if (!r.ok) {
      log(job, `${ex.title} 排版失败：${r.error}`, 'warn')
      continue
    }
    job.out.files.push({ kind: ex.kind, path: outDocx, name: path.basename(outDocx) })
    log(job, `${ex.kind === 'summary' ? '总结' : '速记卡'} → ${path.basename(outDocx)}`)
    if (want.pdf !== false) {
      const outPdf = outDocx.replace(/\.docx$/i, '.pdf')
      const pdf = await docxToPdf(outDocx, outPdf)
      if (pdf.ok) {
        job.out.files.push({ kind: ex.kind + '-pdf', path: outPdf, name: path.basename(outPdf) })
      }
    }
  }

  if (want.pptx && noteMdPath) {
    step(job, '生成 PPT')
    const outPptx = path.join(dir, `${code}_${scope}_讲义.pptx`)
    const r = await runScript('make_pptx.py', [
      noteMdPath, outPptx, '--title', `${code} ${scope}`, '--subtitle', '复习提纲 · 自动生成',
    ], { timeoutMs: 180000 })
    if (r.ok) {
      job.out.files.push({ kind: 'pptx', path: outPptx, name: path.basename(outPptx) })
      log(job, `PPT → ${path.basename(outPptx)}（${r.slides} 页）`)
    } else {
      log(job, `PPT 生成失败：${r.error}${r.detail ? ' / ' + r.detail : ''}`, 'warn')
      job.errors.push({ stage: 'pptx', ...r })
    }
  }

  /* ⑤ 产出的文件标成「DSH 生成」，面板里就跟讲义自动隔开 */
  try {
    for (const f of job.out.files) {
      setGeneratedFlag(code, { filePath: f.path, generated: true })
    }
  } catch {}

  job.state = job.errors.length ? 'partial' : 'done'
  job.finishedAt = Date.now()
  const secs = ((job.finishedAt - job.startedAt) / 1000).toFixed(1)
  step(job, '完成', job.progress.total, job.progress.total)
  log(job, `完成，用时 ${secs}s：知识点 +${addedTopics}，题卡 +${addedCards}，文件 ${job.out.files.length} 个`)
}

/* ------------------------------------------------- 只出文档（不重跑模型） */
/**
 * 已经有点题库了，只想重新排版一遍出 Word/PPT。
 * 用现有的 topics + 现有笔记（若有）拼一份 Markdown，再交给 python。
 */
export async function renderDocs(code, { kinds = ['docx', 'pptx'], scope = '' } = {}) {
  const dir = reviewDir(code)
  const base = `${code}${scope ? '_' + scope : ''}_复习稿`
  const L = []
  const subj = listSubjects().find((s) => String(s.code).toUpperCase() === String(code).toUpperCase())
  L.push(`# ${code}${scope ? ' ' + scope : ''} 复习稿`)
  L.push('')
  if (subj && subj.name) L.push(`科目：${subj.name}`)
  L.push('')

  const topics = readTopics(code).topics
  const byLec = {}
  for (const t of topics) (byLec[t.lecture || '未分组'] = byLec[t.lecture || '未分组'] || []).push(t)
  for (const lec of Object.keys(byLec).sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))) {
    L.push(`## ${lec}`)
    L.push('')
    for (const t of byLec[lec]) {
      L.push(`### ${t.title}${t.titleEn ? ' / ' + t.titleEn : ''}`)
      L.push('')
      L.push(`掌握度：${Math.round((t.mastery || 0) * 100)}%　下次复习：${t.due || '—'}`)
      L.push('')
    }
  }
  const st = stats(code)
  L.push('## 掌握度概览')
  L.push('')
  for (const b of st.byBucket) L.push(`- ${b.name}：${b.count}`)
  L.push('')

  // md 是中间原料，写到 .build，不放进资料目录
  const stamp2 = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
  const mdPath = writeOut(buildDir(code), `${base}.${stamp2}.md`, L.join('\n'))
  const files = []

  for (const k of kinds) {
    if (k === 'docx') {
      const out = path.join(dir, base + '.docx')
      const r = await runScript('make_docx.py', [mdPath, out, '--title', `${code} 复习稿`], { timeoutMs: 180000 })
      if (r.ok) files.push({ kind: 'docx', path: out, name: path.basename(out) })
    }
    if (k === 'pptx') {
      const out = path.join(dir, base + '.pptx')
      const r = await runScript('make_pptx.py', [mdPath, out, '--title', `${code} 复习稿`], { timeoutMs: 180000 })
      if (r.ok) files.push({ kind: 'pptx', path: out, name: path.basename(out) })
    }
  }
  try {
    for (const f of files) setGeneratedFlag(code, { filePath: f.path, generated: true })
  } catch {}
  return { ok: true, files }
}
