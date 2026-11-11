#!/usr/bin/env node
/**
 * dsh-study-coach / check-client.mjs
 *
 * 面板前端（lib/client.js）的守门人。
 *
 * ============================================================== 为什么要写它
 * 2026-11-11 事故：一次「文本插入」式改补丁，把
 *
 *     const tableEl = (item.table && item.table.length) ? h(...) : null
 *
 * 从它该在的位置拔出来，插到了别的地方（紧挨 `const figSvg`）。
 * 结果：面板上卷子的图变成一朵 unconfirmed 云，整块图形全灭。
 *
 * 事后拿那个坏文件试了各种检查，结论很难看 —— 它**语法完全合法**：
 *   · `node --check lib/client.js` → 放行
 *     （这个文件挂在 window.__ModuleLoader__ 上，没有 import/export，
 *       node 当 CommonJS 脚本解析，语法本来就过）
 *   · `new Function(src)` 包一层 → 放行
 *   · 桩掉 window 执行一遍 → 放行（工厂只在 apply 时才 return，顶层没碰那段代码）
 *
 * 也就是说：**纯语法检查永远抓不到这类错**。一段声明被搬到别处，编译得过去，
 * 只是作用域变了 —— 这种错只会在「真的把界面渲染到那一屏」的时候炸。
 *
 * 所以这个脚本干的是：**把面板真的渲染一遍**，渲染到试卷页，喂一份带 figure 的题。
 * StudyLibraryPanel() 里那一堆 pane 都是立即求值的 IIFE，调一次就全跑；
 * 被搬错位置的变量会当场 ReferenceError。
 *
 * 关卡：
 *   D1 装载      —— 桩 window/require，跑 factory，拿到 exports.apply / inject
 *   D2 渲染      —— 假后端数据把它渲染一帧，不许抛错
 *   D3 图形通路  —— 题带 figure 时必须真的产出 <svg>（静默跳过也算失败）
 *
 * 用法：
 *   node check-client.mjs               # 检查 lib/client.js
 *   node check-client.mjs 别的.js       # 检查别的文件（回归自测用）
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(process.argv[2] || path.join(HERE, 'lib', 'client.js'))

const fails = []
const say = (ok, msg, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}${detail && !ok ? '\n    ' + detail : ''}`)
  if (!ok) fails.push(msg)
}

if (!fs.existsSync(FILE)) {
  console.error(`✗ 找不到 ${FILE}`)
  process.exit(1)
}
const src = fs.readFileSync(FILE, 'utf8')
console.log(`检查 ${path.relative(HERE, FILE) || path.basename(FILE)}（${src.length} 字节）`)
say(src.length > 1000, '文件非空')

/* ============================================================ 假后端数据 */
const FAKE_ITEM_WITH_FIGURE = {
  no: 'A1',
  section: 'Section A',
  stem: 'A weighted connected graph has vertices A, B, C.',
  parts: [{ label: '(a)', text: 'State the number of edges in a spanning tree.', marks: 1 }],
  marks: 1,
  answer: '2 edges',
  figure: {
    kind: 'graph',
    directed: false,
    nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }, { id: 'C', label: 'C' }],
    edges: [{ a: 'A', b: 'B', w: '4' }, { a: 'B', b: 'C', w: '2' }, { a: 'A', b: 'C', w: '9' }],
  },
  table: null,
}

const ROUTE_JSON = {
  config: {
    ok: true,
    subjects: [{ code: 'ITP3902', name: 'Discrete Maths & Statistics', examDate: '2026-01-05' }],
    sections: [
      { key: 'lecture', label: '讲义' }, { key: 'tutorial', label: 'Tutorial' },
      { key: 'paper', label: '试卷' }, { key: 'other', label: '其他' },
    ],
  },
  tree: { ok: true, files: [], items: [] },
  state: { ok: true, code: 'ITP3902', topics: [], cards: [], topicCount: 0, cardCount: 0, mastery: 0 },
  papers: {
    ok: true,
    docs: [{ name: 'P_2026-11-11.docx', path: 'C:/x/P_2026-11-11.json', json: 'C:/x/P_2026-11-11.json', questions: 1, marks: 1 }],
    items: [FAKE_ITEM_WITH_FIGURE],
    paperImgs: {},
  },
  notes: { ok: true, notes: [] },
  plan: { ok: true, items: [] },
  prefs: { ok: true, prefs: {}, schema: [] },
  models: { ok: true, groups: [], current: null },
  usage: { ok: true },
  'grade-papers': { ok: true, docs: [] },
  'paper-images': { ok: true, images: {}, library: [] },
  'paper-figures': { ok: true, images: [], library: [] },
}

const requests = []
async function fakeFetch(url) {
  const u = String(url)
  requests.push(u)
  let body = { ok: true }
  for (const [k, v] of Object.entries(ROUTE_JSON)) {
    if (u.includes('/' + k)) { body = v; break }
  }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

/* ============================================================ DOM 桩 */
function makeEl() {
  const node = {
    style: {}, dataset: {}, children: [], childNodes: [], textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); this.childNodes.push(c); return c },
    removeChild() {}, insertBefore() {}, replaceChild() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    getContext: () => ({
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      arc() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {}, scale() {},
      setTransform() {}, drawImage() {}, putImageData() {}, getImageData: () => ({ data: [] }),
      closePath() {}, quadraticCurveTo() {}, bezierCurveTo() {}, setLineDash() {},
      measureText: () => ({ width: 10 }), fillText() {}, strokeText() {},
    }),
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, scrollTo() {},
    querySelector: () => null, querySelectorAll: () => [],
    contains: () => false, cloneNode() { return makeEl() },
    toDataURL: () => 'data:,',
  }
  return node
}

/* ============================================================ React 桩 */
function makeReact() {
  const state = []
  let cursor = 0
  const overrides = new Map()   // useState 序号 → 强制初值
  return {
    reset(ov) { state.length = 0; cursor = 0; overrides.clear(); if (ov) for (const [k, v] of Object.entries(ov)) overrides.set(Number(k), v) },
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      const name = typeof type === 'function' ? (type.name || 'anonymous') : type
      return { type: name, rawType: type, props: props || {}, children: children.flat(9).filter((c) => c != null) }
    },
    useState(init) {
      const i = cursor++
      if (!(i in state)) state[i] = overrides.has(i) ? overrides.get(i) : (typeof init === 'function' ? init() : init)
      return [state[i], (v) => { state[i] = typeof v === 'function' ? v(state[i]) : v }]
    },
    useEffect() {}, useLayoutEffect() {},
    useMemo(fn) { return fn() },
    useCallback(fn) { return fn },
    useRef(v) { return { current: v } },
    useContext() { return {} },
    useReducer(r, init) { return [typeof init === 'function' ? init() : init, () => {}] },
    memo: (c) => c,
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
  }
}

/* ============================================================ D1 装载 */
const react = makeReact()
let exportsObj = null

const sandbox = {
  window: {
    __ModuleLoader__: { load: (def) => { sandbox.__def = def } },
    addEventListener() {}, removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
    location: { href: 'http://localhost/', search: '', hash: '' }, open() {},
  },
  document: {
    createElement: makeEl, createElementNS: makeEl,
    createTextNode: (t) => ({ nodeValue: t, textContent: t }),
    addEventListener() {}, removeEventListener() {},
    head: makeEl(), body: makeEl(), documentElement: makeEl(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    cookie: '',
  },
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
  localStorage: (() => {
    const s = {}
    return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v) }, removeItem: (k) => { delete s[k] } }
  })(),
  fetch: fakeFetch,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: class {}, File: class {}, FormData: class { append() {} },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  Image: class { constructor() { this.style = {} } },
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
}
sandbox.globalThis = sandbox
sandbox.window.document = sandbox.document
sandbox.window.localStorage = sandbox.localStorage

try {
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'client.js', timeout: 15000 })
  const def = sandbox.__def
  say(!!def && typeof def.factory === 'function', '找到 __ModuleLoader__.load({ factory })')
  if (def && typeof def.factory === 'function') {
    exportsObj = def.factory((m) => (m === 'react' ? react : {}))
    say(!!exportsObj && typeof exportsObj.apply === 'function' && Array.isArray(exportsObj.inject),
      'factory → exports.apply / inject')
  }
} catch (e) {
  say(false, '模块装载时抛错', `${e.name}: ${e.message}`)
}

/* ============================================================ D2 渲染 */
function deepFind(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  if (Array.isArray(node.children)) for (const c of node.children) deepFind(c, pred, out)
  if (node.props) for (const v of Object.values(node.props)) if (v && typeof v === 'object') deepFind(v, pred, out)
  return out
}

let PanelComp = null
if (exportsObj && typeof exportsObj.apply === 'function') {
  const registered = []
  const slots = {
    inject: (name, fn) => { try { fn() } catch (e) { /* 注入失败也继续 */ } return () => {} },
    // 宿主 register 之后会拿图标组件渲染一次：StudyIcon({ size: 16 })。
    // 这里必须照做并给 props —— 不给的话 StudyIcon 解构 size 会抛，
    // 出来的错看着像是源码坏了，其实是桩没写对。
    register: (meta, comp) => {
      registered.push({ meta, comp })
      if (typeof comp === 'function' && comp.name === 'StudyIcon') comp({ size: 16 })
      return () => {}
    },
    get: () => null,
  }
  try {
    exportsObj.apply({ slots, effect: () => {}, logger: sandbox.console })
    // 面板组件是名字里带 LibraryPanel 的那个（另有一个图标组件也被注册）
    const p = registered.find((r) => typeof r.comp === 'function' && /Panel/.test(r.comp.name || ''))
    say(!!p, 'apply 注册出了面板组件')
    if (p) PanelComp = p.comp
  } catch (e) {
    say(false, 'apply 抛错', `${e.name}: ${e.message}`)
  }
}

if (PanelComp) {
  try {
    react.reset()
    const tree = PanelComp()
    say(!!tree, '组件渲染一帧没抛错')
  } catch (e) {
    say(false, '组件渲染时抛错（真打开面板就会炸）', `${e.name}: ${e.message}`)
  }
}

/* ==================================================== D3 图形通路 */
/* tab 的初值是 'files'，要让它渲染试卷页，得把那个 useState 的初值改成 'papers'。
   序号靠扫源码确定（`const [tab, setTab] = react.useState('files')`）。 */
function findTabStateIndex() {
  const m = src.match(/const\s*\[tab,\s*setTab\]\s*=\s*react\.useState\(([^)]*)\)/)
  if (!m) return -1
  // 数一下它前面出现过多少个 react.useState(
  const before = src.slice(0, m.index)
  return (before.match(/react\.useState\(/g) || []).length
}

/** 找 `const [名字, set名字] = react.useState(...)` 是第几个 useState */
function findStateIndex(name) {
  const m = src.match(new RegExp(`const\\s*\\[${name},\\s*set\\w+\\]\\s*=\\s*react\\.useState\\(`))
  if (!m) return -1
  return (src.slice(0, m.index).match(/react\.useState\(/g) || []).length
}

if (PanelComp) {
  const idx = findTabStateIndex()
  say(idx >= 0, '找到 tab 的 useState 序号', idx < 0 ? '源码里没匹配到 [tab, setTab] = react.useState(...)' : '')
  if (idx >= 0) {
    // 数据是异步拉的，渲染第一帧时 config / paperItems 都还是空的 ——
    // 空数据会直接走 loading 分支，永远碰不到画图那段。
    // 所以把「已经加载完 + 停在试卷页 + 有一份带 figure 的卷子」直接灌成初值。
    const ov = {}
    const seed = [
      ['config', ROUTE_JSON.config],
      ['tree', ROUTE_JSON.tree],
      ['state', ROUTE_JSON.state],
      ['cur', 'ITP3902'],
      ['tab', 'papers'],
      ['sect', 'lecture'],
      ['papersDocs', ROUTE_JSON.papers.docs],
      ['curPaperPath', 'C:/x/P_2026-11-11.json'],
      ['paperItems', ROUTE_JSON.papers.items],
      ['pi', 0],
      ['notes', ROUTE_JSON.notes.notes],
      ['noteList', []],
      ['prefs', ROUTE_JSON.prefs.prefs],
      ['prefsSchema', ROUTE_JSON.prefs.schema],
      ['models', ROUTE_JSON.models],
      ['gradePapers', ROUTE_JSON['grade-papers'].docs],
    ]
    for (const [name, val] of seed) {
      const i = findStateIndex(name)
      if (i >= 0) ov[i] = val
    }
    try {
      react.reset(ov)
      const tree = PanelComp()
      const svgs = deepFind(tree, (n) => n.type === 'svg')
      // 渲染结果里必须真的有 svg —— 题带 figure 却被静默跳过，就是这次事故的样子
      say(svgs.length > 0, `试卷页渲染出图形（svg × ${svgs.length}）`,
        svgs.length ? '' : '题目给了 figure，但渲染结果里一个 <svg> 都没有 —— 图这条线断了')
      if (svgs.length) {
        const circles = deepFind(tree, (n) => n.type === 'circle')
        const texts = deepFind(tree, (n) => n.type === 'text')
        say(circles.length >= 3, `图形里画出了顶点（circle × ${circles.length}）`)
        say(texts.length >= 3, `图形里写出了标签/权重（text × ${texts.length}）`)
      }
    } catch (e) {
      say(false, '渲染试卷页时抛错', `${e.name}: ${e.message}`)
    }
  }
}

/* ------------------------------------------------------------ 结论 */
console.log('')
if (fails.length) {
  console.error(`✗ ${path.basename(FILE)} 没过 ${fails.length} 项：${fails.join(' / ')}`)
  console.error('  别交给宿主加载 —— 2026-11-11「图变一朵云」就是这么进去的。')
  process.exit(1)
}
console.log(`✓ ${path.basename(FILE)} 通过：能装载、能渲染、题目带图时图形真的画出来了`)
