/**
 * dsh-study-coach / paper.js
 *
 * 出练习卷：**照着校内真卷的版式和出题方式**，题目换成你指定的章节范围。
 *
 * 为什么不是「让模型随便出一份卷子」：
 *   主人手里本来就有校内真卷（2024-Final、2024 CA Test 1）。自己发明的版式
 *   跟考场对不上 —— 题型顺序、每题分值、子题 (a)(b)(c) 的深浅、Section A/B 的
 *   配分都会不一样。所以流程是：**先解析真卷骨架，再按骨架填题**。
 *
 * 三步：
 *   ① analyzeTemplate  抽真卷文本 → 模型输出骨架（封面信息 / 每节题数 / 分值 /
 *                      说明文字 / 语言 / 题型风格标签）
 *   ② pickScope        按 lecture 范围（Ch1-Ch5 或 Lec6-Lec10）挑知识点
 *   ③ generatePaper    按骨架逐节出题 → 组 paper JSON → make_paper.py 排 .docx
 *
 * 骨架缓存：$DSH_HOME/study/<CODE>/paper-template.json
 *   - 同一份真卷不用每次重新分析（分析一次几秒到十几秒）
 *   - 换真卷就重新分析，旧的骨架会带上来源文件名，一看就知道用的是哪份
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  dshHome, readTopics, setGeneratedFlag, today,
} from './core.js'
import { WORKSPACE } from './routes.js'
import { extractFile } from './extract.js'
import { runScript } from './python.js'
import { docxToPdf } from './pdf.js'
import { newJob, log, step } from './pipeline.js'

/* --------------------------------------------------------------- paths */
export function templatePath(code) {
  return path.join(dshHome(), 'study', String(code).toUpperCase(), 'paper-template.json')
}

export function readTemplate(code) {
  try {
    return JSON.parse(fs.readFileSync(templatePath(code), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 内置通用版式 —— 手头没有校内真卷的人也能出卷。
 *
 * 结构照香港高级文凭常见卷：Section A 短答 8×5 分 + Section B 长题 3×20 分。
 * 有真卷时永远优先用真卷（那才是对齐考场的唯一办法）；没有才退到这份。
 */
export const BUILTIN_TEMPLATE = {
  builtin: true,
  sourceName: '内置通用模板',
  meta: { moduleCode: '', moduleTitle: 'Practice Paper' },
  samples: [],
  sections: [
    {
      name: 'Section A',
      questionCount: 8,
      marksPerQuestion: 5,
      style: { language: 'en', hasSubParts: true, subPartsMin: 2, subPartsMax: 3, hasTable: false },
    },
    {
      name: 'Section B',
      questionCount: 3,
      marksPerQuestion: 20,
      style: { language: 'en', hasSubParts: true, subPartsMin: 3, subPartsMax: 4, hasTable: true },
    },
  ],
}

export function writeTemplate(code, data) {
  const p = templatePath(code)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return data
}

/**
 * 练习卷的「数据源」目录 —— 放 .build 里，**不进科目资料库**。
 *
 * 那份 .json 是排版和批改的中间格式（题目 + 参考答案），
 * 跟 md 一样：模型/脚本之间用它，对外只给 docx / pdf。
 * 放这里的另一个好处：批改时读它不用穿过用户目录，路径也不会混在资料列表里。
 */
export function paperDataDir(code) {
  const p = path.join(dshHome(), 'study', String(code).toUpperCase(), '.build', 'papers')
  try { fs.mkdirSync(p, { recursive: true }) } catch {}
  return p
}

/** 练习卷的成品目录：3_练习题（跟主人的目录习惯一致） */
/** 一份练习卷的 json / docx 落在哪里 —— 重排和出卷必须用同一套命名，别有第二份拼法 */
export function paperPaths(code, scope, stamp = today()) {
  const baseName = code + '_' + String(scope).replace(/[^\w\u4e00-\u9fa5-]/g, '') + '_练习卷_' + stamp
  return {
    baseName,
    dir: practiceDir(code),
    jsonPath: path.join(paperDataDir(code), baseName + '.json'),
  }
}

function practiceDir(code) {
  const root = path.join(WORKSPACE, String(code).toUpperCase())
  const cands = ['3_练习题', '3_練習題', '练习题', 'practice']
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

/* ------------------------------------------------ 卷子重新排版（不花模型） */
/**
 * 拿 .build/papers 里现成的 json 重新排一遍 Word / PDF。
 *
 * 为什么要有这一条：题目内容、答案是对的，改的是排版代码（比如图里节点写成字符串、
 * 文档里 figure 版本对得上）—— 这种时候不该再花一次模型，也不该换一份新卷子。
 * 版式和文件名跟出卷时完全一致（同一个 paperPaths），只覆盖成品。
 *
 * want: { docx: true, pdf: true, answers: true } 都可以省略，默认全要。
 */
export async function rerenderPaper(code, { file, want = {}, log = () => {} } = {}) {
  const jsonPath = paperDataDir(code) + path.sep + path.basename(String(file || ''))
  if (!fs.existsSync(jsonPath)) return { ok: false, error: '找不到这份卷子的 json：' + jsonPath }
  // 先读一遍确认是能用的卷子 —— 排到一半才发现 json 坏了，会留下半份 docx
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  } catch (e) {
    return { ok: false, error: 'json 读不动：' + e.message }
  }
  const qCount = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .reduce((a, s) => a + (Array.isArray(s.questions) ? s.questions.length : 0), 0)
  if (!qCount) return { ok: false, error: '这份 json 里没有题目，不重排' }
  const baseName = path.basename(jsonPath).replace(/\.json$/i, '')
  const stamp = baseName.match(/(\d{4}-\d{2}-\d{2})$/)?.[1] || today()
  const scopeMatch = baseName.match(/_练习卷_/)
  const scope = scopeMatch ? baseName.slice(baseName.indexOf(code + '_') + code.length + 1, baseName.indexOf('_练习卷_')) : ''
  const dir = practiceDir(code)
  const files = []
  const errors = []

  const doDocx = async (outPath, answers) => {
    const args = [jsonPath, outPath]
    if (scope) args.push('--scope', scope)
    if (answers) args.push('--answers')
    const r = await runScript('make_paper.py', args, { timeoutMs: 180000 })
    if (!r.ok) {
      errors.push({ file: path.basename(outPath), error: r.error, detail: r.detail })
      log('排版失败：' + path.basename(outPath) + ' / ' + (r.detail || r.error), 'warn')
      return null
    }
    files.push({ path: outPath, name: path.basename(outPath), questions: r.questions, marks: r.totalMarks })
    log('已重排 → ' + path.basename(outPath) + '（' + r.questions + ' 题 / ' + r.totalMarks + ' 分）')
    try { setGeneratedFlag(code, { filePath: outPath, generated: true }) } catch {}
    return outPath
  }

  const wantDocx = want.docx !== false
  const wantPdf = want.pdf !== false
  const wantAnswers = want.answers !== false

  if (wantDocx) {
    const p = await doDocx(path.join(dir, baseName + '.docx'), false)
    if (p && wantPdf) {
      const pdf = await docxToPdf(p, path.join(dir, baseName + '.pdf'))
      if (pdf.ok) files.push({ path: path.join(dir, baseName + '.pdf'), name: baseName + '.pdf' })
      else log('PDF 没转成：' + (pdf.detail || pdf.error), 'warn')
    }
  }
  if (wantAnswers) {
    const p = await doDocx(path.join(dir, baseName + '_答案.docx'), true)
    if (p && wantPdf) {
      const pdf = await docxToPdf(p, path.join(dir, baseName + '_答案.pdf'))
      if (pdf.ok) files.push({ path: path.join(dir, baseName + '_答案.pdf'), name: baseName + '_答案.pdf' })
    }
  }
  return { ok: files.length > 0, json: jsonPath, files, errors, stamp }
}

/* ------------------------------------------------------- ① 解析真卷骨架 */
const TEMPLATE_PROMPT = `你在解析一份香港的大专院校 的考试卷，目的是提取它的"版式骨架"，好让另一份新卷子照着这个版式出。

只输出 JSON，不要解释、不要代码块：
{
  "meta": {
    "institution": "封面最上面的机构名，原文照抄",
    "coverLines": ["封面机构名下面那几行小字，原文照抄，没有就空数组"],
    "programme": "页眉里的 Programme/Year 那一串，原文照抄",
    "programmes": [{ "name": "封面上列的 programme 名（大写）", "code": "(IT114103/1)" }],
    "moduleTitle": "MODULE TITLE，原文照抄（大写）",
    "moduleCode": "MODULE CODE，例如 COMP2011",
    "semester": "SEMESTER 1",
    "paperName": "MAIN EXAMINATION 或 CLASS TEST",
    "date": "封面上的日期，原文照抄",
    "time": "封面上的时间，原文照抄",
    "footerLeft": "页脚左边那串科目名",
    "footerCenter": "页脚中间那串，例如 Main Examination",
    "footerRight": "页脚右边那串，例如 Semester 1 (2025/2026)",
    "instructions": ["封面 Instructions 下面 (a)(b)(c)... 每一条原文照抄"],
    "note": "封面 Note: 后面那段，原文照抄",
    "working": "正文说明里那句 All working must be clearly shown. 之类，原文照抄",
    "sectionCountWord": "TWO 或 ONE",
    "appendices": ["附录说明原文"]
  },
  "sections": [
    {
      "id": "A",
      "name": "Section A",
      "marks": 40,
      "prefix": "A",
      "instruction": ["This section contains EIGHT questions.", "Answer ALL questions.", "Each question is worth FIVE marks."],
      "questionCount": 8,
      "marksPerQuestion": 5,
      "style": {
        "language": "en",
        "stemLength": "short",
        "hasSubParts": false,
        "subPartsMin": 0,
        "subPartsMax": 0,
        "hasTable": true,
        "hasDiagram": true,
        "topicsHint": ["K-map", "relation properties", "permutation"]
      },
      "samples": ["原卷这一节里某道题的题干，原文照抄（最多 2 道，用来学出题口吻）"]
    }
  ]
}

提取要求：
1. 数值（题数、分值）必须是原卷真实的，从说明文字或题号数出来，不要猜。
2. samples 里照抄原题原文，这是最关键的"出题口吻"样本。
3. style.topicsHint 列出这一节实际考到的知识点类型（看题目标题就能看出来）。
4. 一节里如果每题分值不同（例如 Section B 每题 20 分但有 (a)(b)(c)），marksPerQuestion 写每题总分，hasSubParts 写 true。`

/**
 * 从模型回复里抠 JSON。
 * 模型实际会干的事：外面包 ```json、前面加一句「好的，以下是题目」、
 * 输出到 maxTokens 上限被切断。最后一种以前直接判死 —— 其实前面已经写好的题目是全的。
 */
export function parseJson(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()

  // ① 整段就是 JSON
  try { return JSON.parse(clean) } catch {}

  // ② 顶层就是数组 [{...},{...}]（模型有时不给外层对象）。
  //    必须先确认「[」在「{」前面 —— 否则会把 {"questions":[ ... ]} 里的内层数组
  //    当成整个回复，questions 之外的字段全丢。
  const firstBrace = clean.indexOf('{')
  const firstBracket = clean.indexOf('[')
  const startsWithArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)
  if (startsWithArray) {
    const aEnd = clean.lastIndexOf(']')
    if (aEnd > firstBracket) {
      try {
        const j = JSON.parse(clean.slice(firstBracket, aEnd + 1))
        if (Array.isArray(j) && j.length) return j
      } catch {}
    }
  }

  // ③ 首个 { 到最后一个 }
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1).replace(/,\s*([\]}])/g, '$1')) } catch {}
  }

  // ④ 被截断了：从后往前砍掉没写完的那个对象，补齐收尾括号，
  //    把已经完整的题救回来 —— 出 7 题写断了，至少给你前 5 题。
  if (start !== -1) {
    const body = clean.slice(start)
    let cut = body.lastIndexOf('}')
    let guard = 0
    while (cut > 0 && guard++ < 400) {
      const head = body.slice(0, cut + 1).replace(/,\s*$/, '')
      const braces = (head.match(/\{/g) || []).length - (head.match(/\}/g) || []).length
      const brk = (head.match(/\[/g) || []).length - (head.match(/\]/g) || []).length
      const fixed = head + ']'.repeat(Math.max(0, brk)) + '}'.repeat(Math.max(0, braces))
      try {
        const j = JSON.parse(fixed)
        if (j && typeof j === 'object') return j
      } catch {}
      cut = body.lastIndexOf('}', cut - 1)
    }
  }
  return null
}

/**
 * 解析一份真卷。返回 { ok, template } / { ok:false, error }
 * template 会写进 paper-template.json 缓存。
 */
export async function analyzeTemplate(ctx, { code, file, llm }) {
  const src = String(file || '')
  if (!src) return { ok: false, error: 'template-required', detail: '要选一份真卷当模板' }

  const ex = await extractFile(code, src)
  if (!ex.ok || !ex.text || !ex.text.trim()) {
    return {
      ok: false,
      error: 'extract-failed',
      detail: (ex.detail || ex.warning || '抽不出这份卷子的文字') + '（扫描件要先 OCR）',
    }
  }

  // 真卷可能十几页，掐到 24000 字：封面 + 前几页足够看出版式
  const body = ex.text.slice(0, 24000)
  const r = await ctx.__runModel({
    system: TEMPLATE_PROMPT,
    user: `文件名：${path.basename(src)}\n--- 试卷正文 ---\n${body}\n--- 结束 ---`,
    maxTokens: 6000,
    llm,
  })
  if (!r.ok) return { ok: false, error: r.error, detail: r.detail }

  const j = parseJson(r.answer)
  if (!j || !j.meta || !Array.isArray(j.sections) || !j.sections.length) {
    return {
      ok: false,
      error: 'bad-template',
      detail: '模型没给出可用的骨架 JSON',
      raw: String(r.answer).slice(0, 600),
    }
  }

  const template = {
    source: src,
    sourceName: path.basename(src),
    analyzedAt: new Date().toISOString(),
    meta: j.meta,
    sections: j.sections.map((s, i) => ({
      id: String(s.id || String.fromCharCode(65 + i)),
      name: String(s.name || `Section ${String.fromCharCode(65 + i)}`),
      marks: Number(s.marks) || 0,
      prefix: String(s.prefix || s.id || String.fromCharCode(65 + i)),
      instruction: Array.isArray(s.instruction) ? s.instruction.map(String) : [],
      questionCount: Math.max(1, Number(s.questionCount) || 1),
      marksPerQuestion: Number(s.marksPerQuestion) || 0,
      style: s.style || {},
      samples: Array.isArray(s.samples) ? s.samples.map(String).slice(0, 2) : [],
    })),
  }
  writeTemplate(code, template)
  return { ok: true, template }
}

/* ------------------------------------------------------ ② 章节范围 → 知识点 */
/** lecture 标签里的数字：Lec 6 → 6，Ch 3 → 3，Week 10 → 10 */
function lecNum(label) {
  const m = /(\d+)/.exec(String(label || ''))
  return m ? Number(m[1]) : null
}

/** 这个科目有哪几章可选（给面板做两个下拉） */
export function scopeOptions(code) {
  const topics = readTopics(code).topics
  const map = new Map()
  for (const t of topics) {
    const label = String(t.lecture || '未分组')
    const n = lecNum(label)
    const key = label
    if (!map.has(key)) map.set(key, { label, num: n, count: 0 })
    map.get(key).count++
  }
  return [...map.values()].sort((a, b) => {
    if (a.num != null && b.num != null) return a.num - b.num
    return String(a.label).localeCompare(String(b.label), 'en', { numeric: true })
  })
}

/** 按 from/to 章节号挑知识点。to 缺省就一路到最大 */
export function pickScopeTopics(code, { from, to } = {}) {
  const topics = readTopics(code).topics
  const lo = from == null || from === '' ? null : Number(from)
  const hi = to == null || to === '' ? null : Number(to)
  const hit = topics.filter((t) => {
    const n = lecNum(t.lecture)
    if (n == null) return lo == null && hi == null
    if (lo != null && n < lo) return false
    if (hi != null && n > hi) return false
    return true
  })
  return hit
}

function scopeText(from, to) {
  if (from == null && to == null) return '全部章节'
  if (from != null && to != null) return from === to ? `Ch${from}` : `Ch${from}-Ch${to}`
  if (from != null) return `Ch${from} 起`
  return `到 Ch${to}`
}

/* ------------------------------------------------------- ③ 按骨架出题 */
const QUESTIONS_PROMPT = `你在出一份香港的大专院校 的练习卷。你要**模仿给定真卷的版式和出题方式**，只换题目内容。

只输出 JSON，不要解释、不要代码块：
{
  "questions": [
    {
      "stem": "题干。用真卷的语言（英文卷就英文），长度、句式、术语都模仿 samples",
      "marks": 5,
      "parts": [
        { "label": "(a)", "text": "子题题干", "marks": 3 },
        { "label": "(b)", "text": "子题题干", "marks": 2 }
      ],
      "table": [["A","B","C","F"],["0","0","0","0"]],
      "figure": {
        "kind": "graph",
        "directed": false,
        "nodes": ["A","B","C","D","E"],
        "edges": [["A","B",4],["A","C",2],["B","C",1]]
      },
      "answer": "参考答案：要能直接批改。有计算的给出过程与最终值，有 (a)(b) 的逐项作答"
    }
  ]
}

要求：
1. **只考下面给出的知识点**，一个题都不能跑到范围外。
2. 题数、每题分值、有没有子题、子题数量，严格照 style 和 questionCount 来。
3. 题干口吻照 samples —— 如果 samples 是 "Given ... find ..."，你也这么写。
4. 英语数学卷：数学符号用普通文本（^ 表示幂，不要 LaTeX）。
5. table 只在真卷这一节用了表格/真值表时才给，格式是二维数组，第一行是表头。
6. answer 必须有，而且要是能批改的答案，不许写"略"。
7. 同一份卷子里的题目不要重复考点，尽量覆盖给出的每个知识点。
8. **你画不了图。题目要图才能做的时候（加权图、树、关系图、网络），把图画成 figure 字段，程序会照着画出来。**
   - \`figure.kind\` 目前只支持 \`"graph"\`（有向/无向、有权/无权都算）
   - \`nodes\` 是顶点名数组；\`edges\` 每条是 \`[起点, 终点, 权重]\`，没有权重就只写 \`[起点, 终点]\`
   - 顶点名、边的连接、权重**必须和你题干里写的一模一样** —— 你就当这张图会原样印在卷子上
   - 题干里照常可以写「下图」，因为这回真的有图了
   - 不需要图的题就**不要给 figure**，别硬塞
9. 真的画不成图的关系（比如必须靠矩阵或长表才能表达的），用 table 说清楚，别用 figure 凑。`

// 一节 7~8 题连答案一次写完，很容易顶到输出上限被切断（切断 = JSON 不闭合 = 判死）。
// 4 题一批，写不完也只丢一批，不会整节归零。
const BATCH_SIZE = 4
const BATCH_MAX_TOKENS = 12000

/**
 * 把模型给的 figure 收拾成前端能直接画的结构。
 * 模型很随便：nodes 可能是字符串也可能是对象，edges 可能是数组也可能是对象，
 * 权重可能叫 w 也可能叫 weight 或者干脆没有。这里一次性拍平。
 * 认不出来就返回 null —— 宁可不画，也别画一张和题干对不上的图。
 */
export function normalizeFigure(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = String(raw.kind || 'graph').toLowerCase()
  if (kind !== 'graph' && kind !== 'tree') return null
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  if (!rawNodes.length || !rawEdges.length) return null

  const nodes = rawNodes.map((n) => {
    if (n && typeof n === 'object') {
      const id = String(n.id ?? n.name ?? n.label ?? '').trim()
      return { id, label: String(n.label ?? n.name ?? n.id ?? id).trim() }
    }
    const s = String(n ?? '').trim()
    return { id: s, label: s }
  }).filter((n) => n.id)
  const ids = new Set(nodes.map((n) => n.id))
  if (nodes.length < 2) return null

  const edges = rawEdges.map((e) => {
    if (Array.isArray(e)) {
      const a = String(e[0] ?? '').trim()
      const b = String(e[1] ?? '').trim()
      const w = (e.length > 2 && e[2] != null && e[2] !== '') ? String(e[2]).trim() : ''
      return { a, b, w }
    }
    if (e && typeof e === 'object') {
      const a = String(e.from ?? e.a ?? e.u ?? e.source ?? '').trim()
      const b = String(e.to ?? e.b ?? e.v ?? e.target ?? '').trim()
      const wv = e.w ?? e.weight ?? e.cost ?? e.dist ?? ''
      return { a, b, w: wv === '' || wv == null ? '' : String(wv).trim() }
    }
    return null
  }).filter((e) => e && e.a && e.b && e.a !== e.b && ids.has(e.a) && ids.has(e.b))

  if (!edges.length) return null
  return { kind, directed: kind === 'tree' ? false : !!raw.directed, nodes, edges }
}

/** 出一批题。take = 这一批几题。 */
async function oneBatch(ctx, { template, sec, topics, from, to, llm, take, batchNo, totalBatches, avoid }) {
  const style = sec.style || {}
  const topicList = topics.map((t) => `- [${t.lecture}] ${t.title}${t.titleEn ? ' / ' + t.titleEn : ''}`).join('\n')
  const samples = (sec.samples || template.samples || []).map((s, i) => `样本${i + 1}：${s}`).join('\n\n')

  const user = [
    `科目：${template.meta?.moduleCode || ''} ${template.meta?.moduleTitle || ''}`,
    totalBatches > 1
      ? `这一节：${sec.name}（整节 ${sec.questionCount} 题，这是第 ${batchNo}/${totalBatches} 批，**本批只出 ${take} 题**）`
      : `这一节：${sec.name}（共 ${sec.questionCount} 题${sec.marksPerQuestion ? '，每题 ' + sec.marksPerQuestion + ' 分' : ''}）`,
    `语言：${style.language === 'zh' ? '中文' : '英文'}`,
    `出题范围：${scopeText(from, to)}（只能用下面这些知识点）`,
    style.hasSubParts
      ? `每题要有 ${style.subPartsMin || 2}~${style.subPartsMax || 3} 个子题（(a)(b)(c)），子题分值之和等于该题总分`
      : '每题不要子题，一道题一个问',
    style.hasTable ? '部分题可以带真值表/对照表（table 字段）' : '不要给 table',
    avoid && avoid.length
      ? `\n=== 已经出过的题（考点别重复，题型可以换） ===\n${avoid.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '',
    '',
    '=== 这一节的真卷样本（学它的口吻与难度） ===',
    samples || '（没有样本，按香港高级文凭程度出题）',
    '',
    '=== 可用的知识点 ===',
    topicList,
  ].filter(Boolean).join('\n')

  const r = await ctx.__runModel({ system: QUESTIONS_PROMPT, user, maxTokens: BATCH_MAX_TOKENS, llm })
  if (!r.ok) return { ok: false, error: r.error, detail: r.detail }

  const j = parseJson(r.answer)
  const rawList = Array.isArray(j) ? j : (j && Array.isArray(j.questions) ? j.questions : null)
  if (!rawList || !rawList.length) {
    const raw = String(r.answer || '')
    return {
      ok: false,
      error: 'bad-questions',
      // 说清到底是没回、还是回了但不成 JSON —— 面板上要能直接看出该找谁
      detail: raw.trim()
        ? `模型回的内容不成 JSON（${raw.length} 字，${/```/.test(raw) ? '带代码块' : '没代码块'}）`
        : '模型回了空内容',
      raw: raw.slice(0, 800),
    }
  }

  const questions = rawList.slice(0, take).map((q) => {
    const parts = Array.isArray(q.parts)
      ? q.parts.map((p, i) => ({
        label: String(p.label || `(${String.fromCharCode(97 + i)})`),
        text: String(p.text || '').trim(),
        marks: Number(p.marks) || 0,
      })).filter((p) => p.text)
      : []
    const table = Array.isArray(q.table) && q.table.length
      ? q.table.map((row) => (Array.isArray(row) ? row.map((c) => String(c)) : [String(row)]))
      : null
    const stem = String(q.stem || '').trim()
    const marks = Number(q.marks) || (parts.length
      ? parts.reduce((a, p) => a + p.marks, 0)
      : sec.marksPerQuestion || 0)
    return {
      stem,
      marks,
      parts,
      table,
      // 题干要图就带上，前端照着画 —— 这是「题目附带的图」那条线
      // 模型有时把图放在子题上，别丢：取第一个带图的子题
      figure: normalizeFigure(q.figure) || normalizeFigure((partsRaw || []).map((p) => p && p.figure).find(Boolean)),
      answer: String(q.answer || '').trim(),
    }
  }).filter((q) => q.stem)

  return { ok: true, questions }
}

/**
 * 出一个 section 的题。
 * 题数多的分几批问，批与批之间把已出的题干带回去，避免考点重复。
 */
export async function makeSectionQuestions(ctx, job, { template, sec, topics, from, to, llm }) {
  const want = Math.max(1, Number(sec.questionCount) || 1)
  const totalBatches = Math.ceil(want / BATCH_SIZE)
  const got = []
  const asked = []
  let lastFail = null

  for (let i = 0; i < want; i += BATCH_SIZE) {
    const take = Math.min(BATCH_SIZE, want - i)
    const batchNo = Math.floor(i / BATCH_SIZE) + 1
    let r = await oneBatch(ctx, { template, sec, topics, from, to, llm, take, batchNo, totalBatches, avoid: asked })
    if (!r.ok) {
      // 通道抖动，隔两秒再来一次（整节归零的代价太大）
      try { log(job, `  ${sec.name} 第 ${batchNo}/${totalBatches} 批没成（${r.error}），2 秒后重试`, 'warn') } catch {}
      await new Promise((res) => setTimeout(res, 2000))
      r = await oneBatch(ctx, { template, sec, topics, from, to, llm, take, batchNo, totalBatches, avoid: asked })
    }
    if (!r.ok) {
      lastFail = r
      try {
        log(job, `  ${sec.name} 第 ${batchNo}/${totalBatches} 批失败：${r.detail || r.error}`, 'warn')
        if (r.raw) log(job, `  模型原始输出（前 800 字）：\n${r.raw}`, 'err')
      } catch {}
      // 已经出了几题就收着用，别把一个能用的半成品扔掉
      if (got.length) break
      return { ok: false, error: r.error, detail: r.detail, raw: r.raw }
    }
    got.push(...r.questions)
    for (const q of r.questions) asked.push(q.stem.slice(0, 90))
    if (totalBatches > 1) {
      try { log(job, `  ${sec.name} 第 ${batchNo}/${totalBatches} 批：${r.questions.length} 题`) } catch {}
    }
    if (!r.questions.length && batchNo === 1) return { ok: false, error: 'bad-questions', detail: '模型回了 JSON 但没有一道题有题干', raw: lastFail?.raw }
  }

  const questions = got.slice(0, want)
  return {
    ok: true,
    questions,
    shortBy: Math.max(0, want - questions.length),
    partialFail: lastFail ? (lastFail.detail || lastFail.error) : '',
  }
}

/* ------------------------------------------------------------ 主流程 */
export function startPaper(ctx, opts) {
  const code = String(opts.code || '').toUpperCase()
  const job = newJob(code, 1)
  generatePaper(ctx, job, opts).catch((e) => {
    job.state = 'failed'
    job.finishedAt = Date.now()
    const msg = String((e && e.message) || e)
    job.errors.push({ stage: 'fatal', error: msg })
    log(job, '出卷任务异常（已兜住）：' + msg, 'err')
    try {
      ctx?.logger?.warn?.('[study-coach] paper crashed: ' + msg)
    } catch {}
  })
  return job
}

async function generatePaper(ctx, job, opts) {
  const code = String(opts.code || '').toUpperCase()
  const from = opts.from == null || opts.from === '' ? null : Number(opts.from)
  const to = opts.to == null || opts.to === '' ? null : Number(opts.to)
  const withAnswers = opts.answers !== false
  // PDF 默认出（手机上做卷子最方便），转不出来只是 warn，不影响 docx
  const withPdf = opts.pdf !== false
  // 有真卷就用真卷；一份都没分析过，退到内置版式，别让「没真卷」等于「用不了」
  const template = opts.template || readTemplate(code) || BUILTIN_TEMPLATE

  if (!template.sections || !template.sections.length) {
    job.state = 'failed'
    job.finishedAt = Date.now()
    log(job, '这份版式里没有可分节的结构。先在面板里选一份试卷点「分析版式」，或删掉缓存的 paper-template.json 用内置模板。', 'err')
    return
  }

  const topics = pickScopeTopics(code, { from, to })
  if (!topics.length) {
    job.state = 'failed'
    job.finishedAt = Date.now()
    log(job, `范围 ${scopeText(from, to)} 里没有知识点。先用「一键生成」把讲义变成知识点，或把范围放宽。`, 'err')
    return
  }

  const total = template.sections.reduce((a, s) => a + (s.questionCount || 0), 0) || template.sections.length
  job.progress = { done: 0, total }
  log(job, `版式来源：${template.sourceName || '缓存'}${template.builtin ? '（没贴真卷，用内置 Section A/B）' : ''}`)
  log(job, `范围：${scopeText(from, to)} · ${topics.length} 个知识点 · 计划 ${total} 题`)

  const built = []
  let done = 0
  const failNotes = []
  for (const sec of template.sections) {
    step(job, `出题：${sec.name}（${sec.questionCount} 题）`, done, total)
    log(job, `出题中：${sec.name} × ${sec.questionCount}${sec.questionCount > BATCH_SIZE ? `（分 ${Math.ceil(sec.questionCount / BATCH_SIZE)} 批）` : ''}`)
    const r = await makeSectionQuestions(ctx, job, { template, sec, topics, from, to, llm: opts.llm })
    if (!r.ok) {
      log(job, `${sec.name} 出题失败：${r.error}${r.detail ? ' / ' + r.detail : ''}`, 'warn')
      job.errors.push({ stage: 'questions', section: sec.name, error: r.error, detail: r.detail })
      failNotes.push(`${sec.name}：${r.detail || r.error}`)
      continue
    }
    done += r.questions.length
    step(job, `出题：${sec.name}`, done, total)
    log(
      job,
      `${sec.name} 出了 ${r.questions.length} 题`
      + (r.shortBy ? `（少 ${r.shortBy} 题${r.partialFail ? '，原因：' + r.partialFail : ''}）` : ''),
      r.shortBy ? 'warn' : 'info',
    )
    built.push({ ...sec, questions: r.questions })
    if (r.shortBy) failNotes.push(`${sec.name} 少 ${r.shortBy} 题`)
  }

  if (!built.length) {
    job.state = 'failed'
    job.finishedAt = Date.now()
    log(job, `一题都没出成。${failNotes.length ? '原因：' + failNotes.join('；') : '模型没有返回可用的题目。'}`, 'err')
    log(job, '排查顺序：① 面板「问」能不能正常回答 ② 顶栏 🧠 换个模型通道 ③ 看上面那条「模型原始输出」。', 'warn')
    return
  }

  // 组装成 make_paper.py 要的 JSON
  const meta = { ...(template.meta || {}) }
  const scope = scopeText(from, to)
  // 封面 Instructions 里的分值也得跟实际对上（真卷写 40/60，题数变了就不能照抄）
  meta.instructions = fixCoverInstructions(meta.instructions || [], built)
  if (meta.coverLines) meta.coverLines = [...meta.coverLines]
  const paper = {
    meta,
    sections: built.map((sec) => ({
      id: sec.id,
      name: sec.name,
      // 实际分值 = 题目分值之和，覆盖封面写的计划值
      marks: sec.questions.reduce((a, q) => a + (q.marks || 0), 0),
      prefix: sec.prefix,
      instruction: fixInstruction(sec),
      questions: sec.questions,
    })),
  }

  const dir = practiceDir(code)
  const stamp = today()
  const { baseName, jsonPath } = paperPaths(code, scope, stamp)
  fs.writeFileSync(jsonPath, JSON.stringify(paper, null, 2), 'utf8')

  step(job, '排版 .docx', total, total)
  const outPaper = path.join(dir, baseName + '.docx')
  const r1 = await runScript('make_paper.py', [jsonPath, outPaper, '--scope', scope], { timeoutMs: 180000 })
  if (r1.ok) {
    job.out.files.push({ kind: 'paper', path: outPaper, name: path.basename(outPaper), marks: r1.totalMarks, questions: r1.questions })
    log(job, `练习卷 → ${path.basename(outPaper)}（${r1.questions} 题 / ${r1.totalMarks} 分）`)
    try { setGeneratedFlag(code, { filePath: outPaper, generated: true }) } catch {}

    // PDF：手机上做卷子看这份最省事（排版固定，不用装 Word）
    if (withPdf) {
      const outPdf = path.join(dir, baseName + '.pdf')
      const pdf = await docxToPdf(outPaper, outPdf)
      if (pdf.ok) {
        job.out.files.push({ kind: 'paper-pdf', path: outPdf, name: path.basename(outPdf) })
        log(job, `试卷 PDF → ${path.basename(outPdf)}（${pdf.via}）`)
        try { setGeneratedFlag(code, { filePath: outPdf, generated: true }) } catch {}
      } else {
        log(job, `试卷 PDF 没转成：${pdf.detail || pdf.error}`, 'warn')
      }
    }
  } else {
    log(job, `排卷失败：${r1.error}${r1.detail ? ' / ' + r1.detail : ''}`, 'warn')
    job.errors.push({ stage: 'render', ...r1 })
  }

  if (withAnswers) {
    const outAns = path.join(dir, baseName + '_答案.docx')
    const r2 = await runScript('make_paper.py', [jsonPath, outAns, '--answers', '--scope', scope], { timeoutMs: 180000 })
    if (r2.ok) {
      job.out.files.push({ kind: 'answers', path: outAns, name: path.basename(outAns) })
      log(job, `答案版 → ${path.basename(outAns)}`)
      try { setGeneratedFlag(code, { filePath: outAns, generated: true }) } catch {}

      if (withPdf) {
        const outAnsPdf = path.join(dir, baseName + '_答案.pdf')
        const pdf = await docxToPdf(outAns, outAnsPdf)
        if (pdf.ok) {
          job.out.files.push({ kind: 'answers-pdf', path: outAnsPdf, name: path.basename(outAnsPdf) })
          log(job, `答案 PDF → ${path.basename(outAnsPdf)}`)
          try { setGeneratedFlag(code, { filePath: outAnsPdf, generated: true }) } catch {}
        }
      }
    } else {
      log(job, `答案版排版失败：${r2.error}`, 'warn')
      job.errors.push({ stage: 'answers', ...r2 })
    }
  }

  job.out.topics = topics.length
  job.out.cards = paper.sections.reduce((a, s) => a + s.questions.length, 0)
  job.state = job.errors.length ? 'partial' : 'done'
  job.finishedAt = Date.now()
  step(job, '完成', total, total)
  log(job, `完成，用时 ${((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s：${job.out.cards} 题，${job.out.files.length} 个文件`)
}

const NUM_WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

export function numWord(n) {
  return NUM_WORDS[(Number(n) || 1) - 1] || String(n)
}

/**
 * 封面 Instructions 同步实际分值。
 * 真卷写「Section A is worth 40 marks and Section B is worth 60 marks」，
 * 生成卷的题数/分值一变，这句话不改就露馅了。
 */
export function fixCoverInstructions(lines, built) {
  const marksOf = {}
  for (const sec of built) {
    marksOf[String(sec.id).toUpperCase()] = sec.questions.reduce((a, q) => a + (q.marks || 0), 0)
  }
  return lines.map((line) => {
    let out = String(line)
    // 逐节替换 "Section X is worth N marks"
    for (const [id, m] of Object.entries(marksOf)) {
      out = out.replace(
        new RegExp(`Section\\s+${id}\\s+is\\s+worth\\s+\\d+\\s+marks`, 'gi'),
        `Section ${id} is worth ${m} marks`,
      )
      out = out.replace(
        new RegExp(`each\\s+question\\s+is\\s+worth\\s+(?:${NUM_WORDS.join('|')}|\\d+)\\s+marks`, 'gi'),
        (m0) => m0,
      )
    }
    // "a total of NINE pages" 这类页数就不改了 —— 那是排完版才知道的事
    return out
  })
}

/** 说明里的题数/分值改成实际值（真卷说 EIGHT questions、FIVE marks，得对上） */
export function fixInstruction(sec) {
  const lines = (sec.instruction || []).slice()
  const count = sec.questions.length
  const per = sec.questions.length
    ? Math.round(sec.questions.reduce((a, q) => a + (q.marks || 0), 0) / sec.questions.length)
    : sec.marksPerQuestion
  return lines.map((line) => {
    let out = String(line)
    out = out.replace(/contains\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|\d+)\s+questions?/i,
      `contains ${numWord(count)} question${count === 1 ? '' : 's'}`)
    out = out.replace(/worth\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|\d+)\s+marks?/i,
      `worth ${numWord(per)} marks`)
    return out
  })
}
