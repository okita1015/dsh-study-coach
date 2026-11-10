/**
 * dsh-study-coach / test-render.mjs
 *
 * 用真的 react 把 client.js 跑一遍，按顺序喂 useState 初始值，
 * 渲染各个分支，抓运行时异常。
 *
 * **关键改进（v0.9.5）**：以前是按数字索引喂 state，client.js 里加一个 useState
 * 后面全部错位 —— 于是测试全绿而面板是错的。现在改成按**名字**喂：
 * 从 client.js 源码里抠出 useState 的声明顺序，名字对不上就直接报错，
 * 加 state 忘更新映射也不会静默通过。
 *
 *   node test-render.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, 'lib', 'client.js')

// 安装目录不写死：用插件自己的探测（跨平台，且跟着 DSH 版本走）
const { dshModuleRoots } = await import('./lib/routes.js')
const DSH_CANDIDATES = dshModuleRoots()

function resolveFromDsh(spec) {
  for (const base of DSH_CANDIDATES) {
    try {
      const r = createRequire(path.join(base, '_r.js'))
      return r.resolve(spec)
    } catch {}
  }
  return createRequire(import.meta.url).resolve(spec)
}

const reactPath = resolveFromDsh('react')
const realReact = await import('file://' + reactPath.replace(/\\/g, '/'))
console.log('react', realReact.version)

/* ---------------- 假浏览器环境 ---------------- */
const styleTags = []
const doc = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, textContent: '' }),
  head: { appendChild: (t) => styleTags.push(t) },
  documentElement: { dataset: {} },
}
const store = {}
const ls = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
}
const nav = { clipboard: { writeText: async () => {} } }

let captured = null
const win = {
  __ModuleLoader__: { load: (s) => { captured = s } },
  confirm: () => false,
  open: () => {},
  addEventListener: () => {},
}
globalThis.window = win
globalThis.document = doc
globalThis.localStorage = ls
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true })
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })

const code = fs.readFileSync(SRC, 'utf8')
new Function('window', 'document', 'localStorage', 'navigator', 'fetch', code)(win, doc, ls, nav, globalThis.fetch)
if (!captured) throw new Error('load() 没被调用')

/* ---------------- 从源码里抠 useState 顺序 ---------------- */
// 名字是唯一事实来源：client.js 里加/删/挪 useState，这里自动跟着变。
const STATE_ORDER = [...code.matchAll(/const \[(\w+), set\w+\]\s*=\s*react\.useState/g)].map((m) => m[1])
console.log(`client.js 里有 ${STATE_ORDER.length} 个 useState`)

const IDX = Object.fromEntries(STATE_ORDER.map((n, i) => [n, i]))
let unknownNames = []

/** 按名字给 state 初始值，名字写错立刻能看出来 */
function namedState(named) {
  const out = {}
  for (const [k, v] of Object.entries(named || {})) {
    if (IDX[k] === undefined) {
      unknownNames.push(k)
      continue
    }
    out[IDX[k]] = v
  }
  return out
}

/* ---------------- mock react（只保留 createElement） ---------------- */
let HOOK_OVERRIDES = {}
let HOOK_CALLS = 0

function makeStateFeeder(overrides) {
  let i = 0
  return (init) => {
    const idx = i++
    if (idx in overrides) return [overrides[idx], () => {}]
    return [init, () => {}]
  }
}

function mockReact() {
  const useS = makeStateFeeder(HOOK_OVERRIDES)
  return {
    createElement: realReact.createElement,
    Fragment: realReact.Fragment,
    // 每次 hook 调用都计数：用来抓「两帧之间 hooks 数量变化」（React #310，会黑屏）
    useState: (init) => { HOOK_CALLS++; return useS(init) },
    useEffect: () => { HOOK_CALLS++ },
    useLayoutEffect: () => { HOOK_CALLS++ },
    useRef: (v) => { HOOK_CALLS++; return { current: v } },
    useMemo: (fn) => { HOOK_CALLS++; return fn() },
    useCallback: (fn) => { HOOK_CALLS++; return fn },
    useContext: () => { HOOK_CALLS++; return {} },
    useReducer: (r, init) => { HOOK_CALLS++; return [init, () => {}] },
  }
}

const mod = captured.factory((n) => {
  if (n === 'react') return mockReact()
  throw new Error('unexpected require: ' + n)
})

/* ---------------- 夹具 ---------------- */
const CFG = {
  ok: true,
  workspace: 'C:\\\\Workspace',
  sections: [
    { key: 'lecture', label: '讲义', icon: 'book' },
    { key: 'homework', label: '作业', icon: 'pen' },
    { key: 'exam', label: '试卷', icon: 'file' },
    { key: 'reference', label: '参考', icon: 'clip' },
    { key: 'extra', label: '其他目录', icon: 'clip', dynamic: true },
  ],
  generatedPatterns: '完整笔记|复习笔记|考前复习|冲刺|速查|知识点清单|中英对照|总结|提纲|思维导图|错题本|逐题精讲|答案卡|精讲|刷题',
  generatedFlags: 'i',
}
const TREE = {
  ok: true,
  subjects: [{
    code: 'COMP2011', name: 'Discrete Maths', examDate: '2026-11-20',
    notes: 33, cards: 32, avgMastery: 0.4,
    sections: {
      lecture: {
        label: '讲义', dir: 'x', files: [
          { name: 'Lec 1.pptx', path: 'C:\\x\\Lec1.pptx', ext: 'pptx', size: 1, sizeText: '1 B', mtime: '2026-11-01', origin: 'source' },
          { name: '01-完整笔记.pdf', path: 'C:\\x\\01.pdf', ext: 'pdf', size: 2, sizeText: '2 B', mtime: '2026-11-02', origin: 'generated' },
        ],
      },
      homework: { label: '作业', dir: 'x', files: [] },
      exam: { label: '试卷', dir: 'x', files: [] },
      reference: { label: '参考', dir: 'x', files: [] },
      extra: {
        label: '其他目录', dir: 'C:\\Workspace\\COMP2011', dynamic: true, files: [
          { name: 'Paper1.docx', rel: '3_练习题/Paper1.docx', path: 'C:\\Workspace\\COMP2011\\3_练习题\\Paper1.docx', ext: 'docx', size: 3, sizeText: '3 B', mtime: '2026-11-03', origin: 'source' },
          { name: '精讲手册.docx', rel: '1_复习资料/精讲手册.docx', path: 'C:\\Workspace\\COMP2011\\1_复习资料\\精讲手册.docx', ext: 'docx', size: 4, sizeText: '4 B', mtime: '2026-11-04', origin: 'generated' },
        ],
      },
    },
  }],
  unregistered: [],
}
const STATE = {
  ok: true,
  subjects: [{ code: 'COMP2011', name: 'Discrete Maths', examDate: '2026-11-20' }],
  current: {
    code: 'COMP2011', name: 'Discrete Maths', examDate: '2026-11-20',
    stats: {
      totalTopics: 2, studied: 2, dueNow: 1, avgMastery: 0.5,
      byBucket: [{ name: '稳固', count: 1 }, { name: '薄弱', count: 1 }],
      lectureRows: [{ lecture: 'Lec 1', total: 2, mastered: 1, avg: 0.5 }],
      weak: [{ title: 'De Morgan', mastery: 0.1 }],
    },
    plan: {
      code: 'COMP2011', today: '2026-11-10', examDate: '2026-11-20', daysLeft: 10,
      totalTopics: 2, avgMastery: 0.5, dueCount: 1, reviewCount: 1, freshCount: 0,
      todayList: [{ key: 'k1', lecture: 'Lec 1', title: 'De Morgan', mastery: 0.1, due: '2026-11-10' }],
      reviewList: [], freshList: [], perDayNeeded: 1, remaining: 1, upcoming: [], estimatedMinutes: 4,
    },
    topics: [
      { key: 'k1', lecture: 'Lec 1', title: 'De Morgan 定律', titleEn: "De Morgan's Laws", mastery: 0.1, due: '2026-11-10', seen: 1, right: 0, wrong: 1 },
      { key: 'k2', lecture: 'Lec 1', title: '集合运算', titleEn: 'Set Operations', mastery: 0.9, due: '2026-12-01', seen: 5, right: 5, wrong: 0 },
    ],
    cards: [{ id: 'c1', topicKey: 'k1', question: 'De Morgan 的公式？', marks: 2, source: '' }],
    answers: { c1: '(A∪B)ᶜ = Ā∩B̄' },
    wrong: [{ topicKey: 'k1', times: 2, title: 'De Morgan 定律', mastery: 0.1 }],
  },
}
const SCHED = {
  ok: true, code: 'COMP2011',
  types: [
    { key: 'exam', label: '考试', icon: '📝' },
    { key: 'quiz', label: '小测', icon: '✏️' },
  ],
  events: [{ id: 'e1', date: '2026-11-20', type: 'exam', title: '期末考', time: '9:30' }],
}

/* ---------------- 渲染 ---------------- */
let pass = 0
let fail = 0
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}  ${extra}`) }
}

function render(named) {
  HOOK_OVERRIDES = namedState(named)
  const regs = []
  const m = captured.factory((n) => (n === 'react' ? mockReact() : (() => { throw new Error(n) })()))
  m.apply({
    slots: { inject: (n, cb) => cb(), register: (s, c) => { regs.push({ s, c }); return () => {} } },
    effect: () => {},
  })
  const Page = regs.find((r) => r.s.name === 'main').c
  return Page({})
}

function renderCase(name, named) {
  try {
    const tree = render(named)
    const kids = tree.props && tree.props.children ? [].concat(tree.props.children).filter(Boolean) : []
    ok(true, `${name}  顶层 <${tree.type}> 子节点 ${kids.length}`)
    return tree
  } catch (e) {
    ok(false, name, e.message)
    console.log(e.stack.split('\n').slice(1, 4).map((l) => '       ' + l.trim()).join('\n'))
    return null
  }
}

function flatten(v, out = []) {
  if (v == null || v === false) return out
  if (typeof v === 'string' || typeof v === 'number') { out.push(String(v)); return out }
  if (Array.isArray(v)) { v.forEach((x) => flatten(x, out)); return out }
  if (typeof v === 'object') {
    if (v.props && v.props.children) flatten(v.props.children, out)
    return out
  }
  return out
}
const textOf = (tree) => flatten(tree).join(' | ')

const base = { config: CFG, tree: TREE, state: STATE, cur: 'COMP2011', sched: SCHED }

console.log('\n=== 渲染各分支 ===')
renderCase('资料页 files', base)
renderCase('笔记页 notes', { ...base, tab: 'notes' })
renderCase('题目页 cards', { ...base, tab: 'cards' })
renderCase('日程页 sched', { ...base, tab: 'sched' })
renderCase('日程 + 事件表单', { ...base, tab: 'sched', dayForm: { date: '2026-11-20', type: 'exam', title: '', time: '', note: '' } })
renderCase('问答抽屉', { ...base, ask: true, askLog: [{ role: 'me', text: '这章考什么' }, { role: 'ai', text: '考 K-map' }] })
renderCase('做题弹窗', { ...base, modal: STATE.current.cards[0] })
renderCase('总结弹窗', { ...base, doc: { ok: true, kind: 'summary', filename: 'x.md', markdown: '# hi', locale: 'both' } })
renderCase('接口失败态', { config: null, tree: null, err: 'HTTP 404' })
renderCase('导入确认弹窗', {
  ...base, err: null, adding: false,
  importing: {
    folderName: 'COMP2011', code: 'COMP2011', name: 'COMP2011', examDate: '', total: 3,
    groups: { lecture: [{ name: 'Lec1.pdf', rel: 'x/Lec1.pdf', size: 1 }] },
  },
})
renderCase('新建科目表单', { ...base, err: null, adding: true })
renderCase('翻译抽屉', {
  ...base, trans: true, transPending: 12,
  transLog: [
    { role: 'info', text: '待翻 12 条 · 模型返回 12 条 · 写回 12 条 · 用时 8.4s' },
    { role: 'pair', text: '条件概率  →  Conditional Probability' },
    { role: 'err', text: '部分分块失败：model-failed' },
  ],
})
renderCase('翻译抽屉·无需翻译', { ...base, trans: true, transPending: 0 })
renderCase('翻译抽屉·计数中', { ...base, trans: true, transPending: null })
renderCase('其他目录', { ...base, sect: 'extra' })

/* ---------------- 一键生成 ---------------- */
const SRC_LIST = {
  ok: true, dir: 'C:\\Workspace\\COMP2011\\0_课程材料\\讲义',
  files: [
    { name: 'Lec 6 - Graph 2.pdf', path: 'C:\\x\\Lec6.pdf', ext: 'pdf', size: 1, sizeText: '1 B', mtime: '2026-11-01', lecture: 'Lec 6' },
    { name: 'Lec 9 - Conditional Probability.pptx', path: 'C:\\x\\Lec9.pptx', ext: 'pptx', size: 2, sizeText: '2 B', mtime: '2026-11-02', lecture: 'Lec 9' },
  ],
  unsupported: [{ name: 'scan.jpg', ext: 'jpg' }],
}
const jobRunning = {
  id: 'jp1', code: 'COMP2011', state: 'running', step: '提炼知识点 1/2',
  progress: { done: 1, total: 2 }, out: { topics: 0, cards: 0, files: [] }, errors: [],
  logs: [{ text: '已抽：Lec 6 - Graph 2.pdf', kind: 'info' }, { text: '抽不出文字：scan.jpg（no-text）', kind: 'warn' }],
}
const jobDone = {
  id: 'jp1', code: 'COMP2011', state: 'done', step: '完成',
  progress: { done: 2, total: 2 },
  out: {
    topics: 12, cards: 18,
    files: [
      { kind: 'note', path: 'C:\\Workspace\\COMP2011\\1_复习资料\\COMP2011_Lec6-9_自动笔记.md', name: 'COMP2011_Lec6-9_自动笔记.md' },
      { kind: 'docx', path: 'C:\\Workspace\\COMP2011\\1_复习资料\\COMP2011_Lec6-9_自动笔记.docx', name: 'COMP2011_Lec6-9_自动笔记.docx' },
      { kind: 'pptx', path: 'C:\\Workspace\\COMP2011\\1_复习资料\\COMP2011_Lec6-9_讲义.pptx', name: 'COMP2011_Lec6-9_讲义.pptx' },
    ],
  },
  errors: [],
  logs: [{ text: '完成，用时 96.4s：知识点 +12，题卡 +18，文件 3 个', kind: 'info' }],
}
const genBase = { ...base, gen: true }
renderCase('一键生成·选讲义', { ...genBase, genSources: SRC_LIST, genPick: { 'C:\\x\\Lec6.pdf': true, 'C:\\x\\Lec9.pptx': true } })
renderCase('一键生成·读目录中', { ...genBase, genSources: null })
renderCase('一键生成·没有讲义', { ...genBase, genSources: { ok: true, files: [], unsupported: [] } })
renderCase('一键生成·运行中', { ...genBase, genSources: SRC_LIST, genPick: { 'C:\\x\\Lec6.pdf': true }, genJob: jobRunning, genBusy: true })
renderCase('一键生成·完成', { ...genBase, genSources: SRC_LIST, genPick: { 'C:\\x\\Lec6.pdf': true }, genJob: jobDone })
renderCase('一键生成·失败', {
  ...genBase, genSources: SRC_LIST, genPick: {},
  genJob: {
    state: 'failed', step: '没有一份讲义能抽出文字', progress: { done: 2, total: 2 },
    out: { topics: 0, cards: 0, files: [] },
    errors: [{ stage: 'extract', name: 'scan.jpg', error: 'no-text' }], logs: [],
  },
})

/* ---------------- 出练习卷 ---------------- */
const PAPER_INFO = {
  ok: true,
  options: [
    { label: 'Lec 1', num: 1, count: 4 },
    { label: 'Lec 2', num: 2, count: 3 },
    { label: 'Lec 5', num: 5, count: 6 },
  ],
  templates: [
    { name: '2024 Final Paper.pdf', path: 'C:\\x\\m.pdf', ext: 'pdf', size: 1, sizeText: '1 B', mtime: '2026-01-05' },
    { name: '2024 CA Test 1 (past paper).docx', path: 'C:\\x\\t.docx', ext: 'docx', size: 2, sizeText: '2 B', mtime: '2025-03-01' },
  ],
  current: null,
}
const PAPER_ANALYZED = {
  ...PAPER_INFO,
  current: {
    sourceName: '2024 Final Paper.pdf',
    analyzedAt: '2026-11-10T15:00:00.000Z',
    sections: [
      { name: 'Section A', questionCount: 8, marks: 40 },
      { name: 'Section B', questionCount: 3, marks: 60 },
    ],
  },
}
const PAPER_JOB_DONE = {
  id: 'jp9', code: 'COMP2011', state: 'done', step: '完成',
  progress: { done: 11, total: 11 },
  out: {
    topics: 34, cards: 11,
    files: [
      { kind: 'paper', path: 'C:\\x\\p.docx', name: 'COMP2011_Ch1-Ch5_练习卷_2026-11-10.docx', questions: 8, marks: 40 },
      { kind: 'answers', path: 'C:\\x\\pa.docx', name: 'COMP2011_Ch1-Ch5_练习卷_2026-11-10_答案.docx' },
    ],
  },
  errors: [],
  logs: [{ text: 'Section A 出了 8 题', kind: 'info' }, { text: '练习卷 → x.docx（8 题 / 40 分）', kind: 'info' }],
}
const paperBase = { ...base, paper: true, paperTpl: 'C:\\x\\m.pdf', paperFrom: '1', paperTo: '5' }
renderCase('出卷·选模板', { ...paperBase, paperInfo: PAPER_INFO })
renderCase('出卷·已解析版式', { ...paperBase, paperInfo: PAPER_ANALYZED, paperAnswers: true })
renderCase('出卷·没有真卷', { ...paperBase, paperTpl: '', paperFrom: '', paperTo: '', paperInfo: { ok: true, options: [], templates: [], current: null } })
renderCase('出卷·运行中', {
  ...paperBase, paperInfo: PAPER_ANALYZED, paperBusy: true,
  paperJob: {
    state: 'running', step: '出题：Section A（8 题）', progress: { done: 3, total: 11 },
    out: { topics: 34, cards: 0, files: [] }, errors: [], logs: [{ text: '版式来源：2024-Final', kind: 'info' }],
  },
})
renderCase('出卷·完成', { ...paperBase, paperInfo: PAPER_ANALYZED, paperJob: PAPER_JOB_DONE })

/* ---------------- 模型选择 ---------------- */
const MODELS = {
  ok: true, injected: true, pinned: '',
  current: { provider: 'deepseek-account', model: 'deepseek-flash', effort: 'none' },
  efforts: [
    { id: '', label: '自动（推荐）' }, { id: 'none', label: 'none' },
    { id: 'low', label: 'low' }, { id: 'medium', label: 'medium' }, { id: 'high', label: 'high' },
  ],
  groups: [
    { provider: 'deepseek-official', models: [], error: '' },
    { provider: 'deepseek-account', models: ['deepseek-flash', 'deepseek-v4-pro'] },
    { provider: 'freeroute', models: ['auto'], bad: true },
    { provider: 'our-free-model', models: ['deepseek-v4.1-flash-free', 'glm-5.3-flash-free'] },
  ],
  bad: [{ id: 'freeroute', why: 'model-failed', leftSec: 480 }],
}
renderCase('模型选择·已选', { ...base, models: MODELS, modelOpen: true })
renderCase('模型选择·自动', { ...base, models: { ...MODELS, current: null }, modelOpen: true })
renderCase('模型选择·没 llm', { ...base, models: { ok: true, injected: false, current: null, groups: [], bad: [] }, modelOpen: true })

/* ---------------- 面板内预览 ---------------- */
renderCase('预览·PDF', { ...base, preview: { name: '2024 Final Paper.pdf', path: 'C:\\x\\m.pdf', ext: 'pdf', sizeText: '257 KB', loading: false, kind: 'pdf' } })
renderCase('预览·docx 文本', {
  ...base,
  preview: {
    name: '练习卷.docx', path: 'C:\\x\\p.docx', ext: 'docx', sizeText: '41 KB', loading: false,
    kind: 'text', chars: 6847, text: 'Some Institute of Technology\nMODULE CODE: COMP2011', truncated: false,
  },
})
renderCase('预览·图片', { ...base, preview: { name: 'graph.png', path: 'C:\\x\\g.png', ext: 'png', sizeText: '12 KB', loading: false, kind: 'image' } })
renderCase('预览·看不了', {
  ...base,
  preview: { name: 'slides.pptx', path: 'C:\\x\\s.pptx', ext: 'pptx', sizeText: '1 MB', loading: false, kind: 'text', text: '', note: '这份 pptx 里没读到文字（可能全是图片）' },
})
renderCase('预览·加载中', { ...base, preview: { name: 'x.docx', path: 'C:\\x\\x.docx', ext: 'docx', loading: true } })
renderCase('预览·出错', { ...base, preview: { name: 'x.docx', path: 'C:\\x\\x.docx', ext: 'docx', loading: false, error: '只能预览 Workspace 里的文件' } })

/* ---------------- 交卷批改 ---------------- */
const GRADE_ITEMS = [
  { no: 'A1', section: 'Section A', stem: 'What is C(5,2)?', marks: 5, parts: [], answer: '10' },
  { no: 'A2', section: 'Section A', stem: 'Explain K-map grouping.', marks: 5, parts: [{ label: '(a)', text: 'state the rule', marks: 2 }], answer: '圈 2 的幂次个 1' },
]
const GRADE_RESULT = {
  ok: true, total: 7, full: 10, percent: 70, answered: 2, total_questions: 2,
  summary: '整体还行，K-map 那题只写了一条',
  items: [
    { no: 'A1', section: 'Section A', stem: 'What is C(5,2)?', marks: 5, score: 5, verdict: 'correct', why: '算对了', explain: '', reference: '10', yours: '10' },
    { no: 'A2', section: 'Section A', stem: 'Explain K-map grouping.', marks: 5, score: 2, verdict: 'partial', why: '只写了一条规则', explain: '应该写：1) 圈 2 的幂次个相邻 1；2) 圈越大越好；3) 边界可跨。', reference: '圈 2 的幂次个 1', yours: '圈起来' },
  ],
}
const PAPER_LIST = [{
  name: 'COMP2011_Ch1-Ch5_练习卷_2026-11-10.json', path: 'C:\\x\\p.json',
  questions: 2, marks: 10, title: 'COMP2011',
}]

renderCase('批改·逐题作答', { ...base, grade: true, gradePapers: PAPER_LIST, gradePaper: PAPER_LIST[0].path, gradeItems: GRADE_ITEMS, gradeAns: { A1: '10' } })
renderCase('批改·批改结果', { ...base, grade: true, gradePapers: PAPER_LIST, gradePaper: PAPER_LIST[0].path, gradeItems: GRADE_ITEMS, gradeResult: GRADE_RESULT })
renderCase('批改·没有练习卷', { ...base, grade: true, gradePapers: [] })

// 学生第一次打开就是这个状态：一个科目都没有。
// 这条以前没测过 —— 空状态一旦渲染崩，面板就是一片白。
renderCase('没有科目·空状态', { ...base, tree: { ...TREE, subjects: [] }, cur: null, state: null })

// 支持作者：收款码弹窗不能因为图不在就炸
renderCase('支持作者', { ...base, support: true })

/* ---------------- 内容断言 ---------------- */
console.log('\n=== 内容检查 ===')
const tSupport = textOf(render({ ...base, support: true }))
ok(tSupport.includes('请作者喝杯奶茶'), '赞助弹窗有标题')
ok(tSupport.includes('不解锁任何东西'), '赞助弹窗写明功能全免费')
ok(tSupport.includes('PayMe'), '赞助弹窗给了付款方式提示')

const tNoSubject = textOf(render({ ...base, tree: { ...TREE, subjects: [] }, cur: null, state: null }))
ok(tNoSubject.includes('①'), '空状态给了三步引导')
const tFiles = textOf(render(base))
ok(tFiles.includes('Lec 1.pptx'), '原件在资料页')
ok(tFiles.includes('01-完整笔记.pdf'), '生成物在资料页')
ok(tFiles.includes('DSH 生成'), '原件/生成物之间有分隔文字')
ok(tFiles.indexOf('Lec 1.pptx') < tFiles.indexOf('DSH 生成'), '原件排在分隔线之前')
ok(tFiles.indexOf('DSH 生成') < tFiles.indexOf('01-完整笔记.pdf'), '生成物排在分隔线之后')
ok(tFiles.includes('添加文件'), '有「添加文件」批量上传入口')

// 多选 → 批量操作条
const tNone = textOf(render(base))
const tOne = textOf(render({ ...base, sel: { 'C:\\x\\01.pdf': true } }))
const tTwo = textOf(render({ ...base, sel: { 'C:\\x\\01.pdf': true, 'C:\\x\\Lec1.pptx': true } }))
ok(!tNone.includes('已选'), '没选中时不显示操作条')
ok(tOne.includes('已选 1 个'), '选中 1 个时出现操作条')
ok(tTwo.includes('已选 2 个'), '选中 2 个时计数正确')
ok(tTwo.includes('删除 2 个'), '批量删除按钮数量正确')
ok(tTwo.includes('标为 AI 生成') && tTwo.includes('标为原件'), '有批量标来源')
ok(tTwo.includes('全选本区'), '有全选本区')

// 预览层真的渲染出内容
const tPrev = textOf(render({ ...base, preview: { name: 'a.pdf', path: 'C:\\x\\a.pdf', ext: 'pdf', loading: false, kind: 'pdf', sizeText: '1 B' } }))
ok(tPrev.includes('另存'), '预览层有另存按钮')
ok(tPrev.includes('a.pdf'), '预览层显示文件名')

// 模型弹层
const tModel = textOf(render({ ...base, models: MODELS, modelOpen: true }))
ok(tModel.includes('推理等级'), '模型弹层有推理等级')
ok(tModel.includes('our-free-model'), '模型弹层列出通道')
ok(tModel.includes('冷却'), '掉线通道有标记')

// 笔记页：默认就该是「能读的笔记」，知识点收在第二个子标签
const tNote = textOf(render({ ...base, tab: 'notes' }))
ok(tNote.includes('📄 笔记'), '笔记页默认有「笔记」子标签')
ok(tNote.includes('🧩 知识点'), '有「知识点」子标签')
ok(tNote.includes('另存'), '阅读器有另存按钮')
ok(!tNote.includes('De Morgan 定律'), '默认笔记视图不糊一屏知识点')

// Markdown 渲染：标题 / 列表 / 表格 / 粗体都要成型，不能是 <pre> 一堆原文
const mdSample = [
  '# 总标题',
  '',
  '## 小节一',
  '',
  '这是一段**加粗**的说明。',
  '',
  '- 要点 A',
  '- 要点 B',
  '',
  '| 章节 | 知识点 |',
  '| --- | --- |',
  '| Lec 6 | Dijkstra |',
  '',
  '> 引用一句话',
  '',
  '---',
].join('\n')
const tMd = textOf(render({
  ...base, tab: 'notes',
  noteDoc: { name: 'n.md', path: 'C:\\x\\n.md', ext: 'md', loading: false, text: mdSample, chars: mdSample.length },
}))
ok(tMd.includes('总标题'), 'markdown 一级标题渲染出来')
ok(tMd.includes('小节一'), 'markdown 二级标题渲染出来')
ok(tMd.includes('要点 A'), 'markdown 列表渲染出来')
ok(tMd.includes('Dijkstra'), 'markdown 表格内容渲染出来')
ok(tMd.includes('加粗'), '行内内容没被吞')
ok(tMd.includes('引用一句话'), 'markdown 引用渲染出来')

// 阅读器：字体 / 字号可调 + 能跳回原文件
ok(tNote.includes('原文件'), '阅读器有「原文件」跳转按钮')
ok(tNote.includes('黑体') && tNote.includes('等宽'), '有字体选择')
ok(tNote.includes('13px') || tNote.includes('14px'), '有字号选择')

// 一键生成抽屉：勾选项里有 PDF，产物显示落在哪个文件夹
const tGen = textOf(render({
  ...genBase, genSources: SRC_LIST, genPick: { 'C:\\x\\Lec6.pdf': true }, genJob: jobDone,
}))
ok(tGen.includes('PDF'), '一键生成可以勾 PDF')
ok(tGen.includes('1_复习资料') || tGen.includes('复习资料'), '产物显示落在哪个文件夹')

/* ---- 字号真的生效吗（曾经被内层写死的 12.6px 盖掉，表现是「调了没反应」） ---- */
console.log('\n=== 阅读器字号 / 字体 ===')
function collectFontSizes(tree) {
  const out = []
  const walk = (v) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    const st = v.props && v.props.style
    if (st) {
      if (st.fontSize != null) out.push(String(st.fontSize))
      if (st.fontFamily) out.push('font:' + String(st.fontFamily))
    }
    if (v.props && v.props.children) [].concat(v.props.children).forEach(walk)
  }
  walk(tree)
  return out
}
const mdTxt = '# 标题\n\n正文一段。\n\n- 列表项'
const tSizeBig = collectFontSizes(render({
  ...base, tab: 'notes', noteSize: 24, noteFont: 'serif',
  noteDoc: { name: 'n.md', path: 'C:\\x\\n.md', ext: 'md', loading: false, text: mdTxt, chars: 20 },
}))
ok(tSizeBig.includes('24px'), `正文容器用了选中的 24px（实际有 ${tSizeBig.filter((x) => x.endsWith('px')).join(',')}）`)
ok(!tSizeBig.includes('12.6px'), '没有内层写死的 12.6px 把它盖掉')
ok(tSizeBig.some((x) => x.startsWith('font:') && /serif|Times|Songti/i.test(x)), '字体选择也传下去了')

const tSizeSmall = collectFontSizes(render({
  ...base, tab: 'notes', noteSize: 13, noteFont: 'auto',
  noteDoc: { name: 'n.md', path: 'C:\\x\\n.md', ext: 'md', loading: false, text: mdTxt, chars: 20 },
}))
ok(tSizeSmall.includes('13px'), '换回 13px 也生效')
// 标题用 em 相对单位，才能跟着字号一起缩放
ok(tSizeBig.some((x) => x.includes('em')), '标题/正文里用 em 相对单位')

// 知识点子标签仍然完整
const tTopics = textOf(render({ ...base, tab: 'notes', noteTab: 'topics' }))
ok(tTopics.includes('De Morgan 定律'), '切到知识点能看到明细')
ok(tTopics.includes('点章节名') || tTopics.includes('▾'), '知识点仍可折叠')

const tFolded = textOf(render({ ...base, tab: 'notes', noteTab: 'topics', openLec: { 'Lec 1': false } }))
ok(!tFolded.includes('De Morgan 定律'), '折叠后不显示该章明细')

// 没有笔记文档时的空态
const tEmpty = textOf(render({
  ...base, tab: 'notes',
  tree: { ok: true, subjects: [{ ...TREE.subjects[0], sections: { lecture: { label: '讲义', dir: 'x', files: [] } } }], unregistered: [] },
}))
ok(tEmpty.includes('还没有笔记文档'), '没有笔记时给出去处提示')

// 底部工作栏：按钮都在，而且排在内容之后（结构上就是挪到底部）
const tBar = textOf(render(base))
ok(tBar.includes('批改'), '工作栏有「批改」按钮')
ok(tBar.includes('一键生成') && tBar.includes('出练习卷') && tBar.includes('翻译'), '工作栏按钮齐全')
ok(tBar.includes('用量'), '工作栏显示用量入口')

// 批改抽屉
const tGradeForm = textOf(render({
  ...base, grade: true, gradePapers: PAPER_LIST,
  gradePaper: PAPER_LIST[0].path, gradeItems: GRADE_ITEMS, gradeAns: { A1: '10' },
}))
ok(tGradeForm.includes('交卷批改'), '批改抽屉打开')
ok(tGradeForm.includes('逐题写答案'), '有逐题作答区')
ok(tGradeForm.includes('A1') && tGradeForm.includes('A2'), '题目都列出来了')
ok(tGradeForm.includes('已写 1 / 2 题'), '显示已写多少题')
ok(tGradeForm.includes('提交批改'), '有提交按钮')

const tGradeRes = textOf(render({
  ...base, grade: true, gradePapers: PAPER_LIST,
  gradePaper: PAPER_LIST[0].path, gradeItems: GRADE_ITEMS, gradeResult: GRADE_RESULT,
}))
ok(tGradeRes.includes('7'), '结果里有得分')
ok(tGradeRes.includes('/ 10 分'), '结果里有满分')
ok(tGradeRes.includes('70%'), '结果里有百分比')
ok(tGradeRes.includes('只写了一条规则'), '逐题给出错因')
ok(tGradeRes.includes('圈越大越好'), '给出正确做法')
ok(tGradeRes.includes('看总结'), '有整份总结入口')
ok(tGradeRes.includes('再交一次'), '可以再交一次')

const tGradeEmpty = textOf(render({ ...base, grade: true, gradePapers: [] }))
ok(tGradeEmpty.includes('还没有可批改的练习卷'), '没有卷子时给出引导')

// 笔记清单：能看见「为什么算笔记」，也能自己加/移除
const NOTE_LIST = [
  {
    name: 'COMP2011_Lec6-9_自动笔记.docx', path: 'C:\\Workspace\\COMP2011\\1_复习资料\\a.docx',
    ext: 'docx', sizeText: '39 KB', mtime: '2026-11-10', origin: 'name',
    reason: '名字含「笔记 / 手册 / 总结」这类词', sectionKey: 'extra',
  },
]
const tNoteList = textOf(render({ ...base, tab: 'notes', noteList: NOTE_LIST, noteCands: [] }))
ok(tNoteList.includes('为什么算笔记'), '笔记页说明「为什么算笔记」')
ok(tNoteList.includes('名字含'), '显示具体原因')
ok(tNoteList.includes('移出笔记'), '能把文件移出笔记列表')
ok(tNoteList.includes('添加笔记'), '能手动添加笔记')

const tNoteAdding = textOf(render({
  ...base, tab: 'notes', noteList: NOTE_LIST, noteAdding: true,
  noteCands: [{ name: '随手写的.docx', path: 'C:\\x\\z.docx', ext: 'docx', why: '没命中规则' }],
}))
ok(tNoteAdding.includes('随手写的.docx'), '展开后列出候选文件')
ok(tNoteAdding.includes('没命中规则'), '候选也说明为什么没被算成笔记')

/* ---------------- 生成偏好 ---------------- */
const PREFS_SCHEMA = [
  {
    key: 'diagram', label: '图示', hint: '多给表格 / ASCII 示意图',
    type: 'choice',
    options: [{ id: 'few', label: '少' }, { id: 'some', label: '适中' }, { id: 'lots', label: '多' }],
  },
  {
    key: 'examples', label: '例题', hint: '每个知识点配几道',
    type: 'choice',
    options: [{ id: '1', label: '1 道' }, { id: '2', label: '2 道' }, { id: '3', label: '3 道' }],
  },
]
const tPrefs = textOf(render({
  ...genBase, genSources: SRC_LIST, genPick: {},
  prefs: { diagram: 'lots', examples: '2' }, prefsSchema: PREFS_SCHEMA,
}))
ok(tPrefs.includes('生成偏好'), '一键生成抽屉有「生成偏好」区')
ok(tPrefs.includes('图示') && tPrefs.includes('例题'), '偏好项都渲染出来')
ok(tPrefs.includes('少') && tPrefs.includes('适中') && tPrefs.includes('多'), '图示三档都在')
ok(tPrefs.includes('多给表格'), '每项带说明')

/* ---------------- 做题：选择题 ---------------- */
const MCQ = {
  stem: 'What is C(5,2)?',
  options: [
    { id: 'A', text: '10' },
    { id: 'B', text: '20' },
    { id: 'C', text: '5' },
    { id: 'D', text: '25' },
  ],
  answerId: 'A',
  why: 'C(5,2) = 5!/(2!3!) = 10',
  trap: '算成排列 A(5,2)=20',
}
const CARD_WITH_MCQ = { id: 'c1', topicKey: 'k1', question: 'C(5,2) = ?', marks: 2, mcq: MCQ }

// 还没选：四个选项可点
const tQuiz = textOf(render({ ...base, modal: CARD_WITH_MCQ, quiz: MCQ }))
ok(tQuiz.includes('10') && tQuiz.includes('20') && tQuiz.includes('25'), '四个选项都渲染出来')
ok(tQuiz.includes('C(5,2)'), '题干在')
ok(!tQuiz.includes('答对了') && !tQuiz.includes('答错了'), '没选之前不显示判定')

// 选对
const tRight = textOf(render({ ...base, modal: CARD_WITH_MCQ, quiz: MCQ, quizPick: 'A' }))
ok(tRight.includes('答对了'), '选对显示「答对了」')
ok(tRight.includes('5!/(2!3!)'), '给出解析')
ok(tRight.includes('再做一次'), '可以再做一次')

// 选错：显示正确答案 + 常见坑
const tWrong = textOf(render({ ...base, modal: CARD_WITH_MCQ, quiz: MCQ, quizPick: 'B' }))
ok(tWrong.includes('答错了'), '选错显示「答错了」')
ok(tWrong.includes('正确答案：A'), '标出正确答案')
ok(tWrong.includes('常见坑'), '给出常见错误')

// 加载中 / 失败降级
const tQuizLoading = textOf(render({ ...base, modal: CARD_WITH_MCQ, quizLoading: true }))
ok(tQuizLoading.includes('选择题'), '生成中给提示')
const tQuizErr = textOf(render({ ...base, modal: CARD_WITH_MCQ, quizError: 'empty-answer' }))
ok(tQuizErr.includes('没生成出来'), '生成失败明说原因')
ok(tQuizErr.includes('我会了') && tQuizErr.includes('不会'), '失败时退回自评（有兜底）')

// 题目列表状态：✅ / ✗ / 未做
const cardsWithState = {
  ...STATE,
  current: {
    ...STATE.current,
    cards: [
      { id: 'c1', topicKey: 'k1', question: '做对的题', marks: 2, lastResult: { correct: true } },
      { id: 'c2', topicKey: 'k2', question: '做错的题', marks: 2, lastResult: { correct: false } },
      { id: 'c3', topicKey: 'k3', question: '没做过的题', marks: 2, lastResult: null },
    ],
  },
}
const tCards = textOf(render({ ...base, tab: 'cards', state: cardsWithState }))
ok(tCards.includes('✅'), '做对的打勾')
ok(tCards.includes('✗'), '做错的打叉')
ok(tCards.includes('○'), '没做过的标空心圈')
ok(tCards.includes('✅ 再做') && tCards.includes('✗ 再做'), '按钮也带上状态')

/* ---------------- state 映射自检 ---------------- */
console.log('\n=== state 映射 ===')
if (unknownNames.length) {
  for (const n of [...new Set(unknownNames)]) {
    fail++
    console.log(`  ❌ 夹具里写了不存在的 state: ${n}`)
  }
} else {
  console.log(`  ✅ 夹具用到的 state 名字全部存在于 client.js（共 ${STATE_ORDER.length} 个）`)
}

/* ---------------- hook 数量一致性（React #310 的真凶） ---------------- */
// 组件有提前 return（没数据时给提示页）。如果有 hooks 写在 return 之后，
// 第一帧 hook 少、第二帧 hook 多 → React 抛 #310 → 整个面板黑屏。
// 这里数两次渲染的 hook 调用总数，必须完全相等。
console.log('\n=== hook 数量一致性（防 React #310 黑屏） ===')
function countHooks(named) {
  HOOK_CALLS = 0
  render(named)
  return HOOK_CALLS
}
const hookEarly = countHooks({ config: null, tree: null, err: 'HTTP 404' })
const hookNormal = countHooks(base)
const hookNotes = countHooks({ ...base, tab: 'notes' })
const hookGrade = countHooks({ ...base, grade: true, gradePapers: PAPER_LIST, gradeItems: GRADE_ITEMS })
ok(hookEarly === hookNormal,
  `早退帧与正常帧 hook 数一致（早退 ${hookEarly} / 正常 ${hookNormal}）`)
ok(hookNotes === hookNormal, `切到笔记页 hook 数不变（${hookNotes}）`)
ok(hookGrade === hookNormal, `打开批改抽屉 hook 数不变（${hookGrade}）`)
ok(hookNormal > 40, `总 hook 数 ${hookNormal}（>40 说明没漏算）`)

console.log('  state 顺序:', STATE_ORDER.join(', '))

console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${pass}   失败 ${fail}`)
if (fail === 0) console.log('全部通过 ✅')
process.exit(fail === 0 ? 0 : 1)
