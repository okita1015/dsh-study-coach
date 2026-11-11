/**
 * dsh-study-coach / routes.js
 *
 * 资源库的 HTTP 接口。全部通过 ctx.webServer.register() 挂到 DSH 自己的服务上，
 * 不需要任何额外进程。
 *
 * 目录约定（按顺序探测，第一个存在的就用；都不存在就用第一个并创建）：
 *   讲义  -> 0_课程材料/讲义   | 讲义     | lectures
 *   作业  -> 0_课程材料/Tutorial | 0_课程材料/作业 | Tutorial
 *   试卷  -> 0_课程材料/试卷   | 试卷     | exams
 *   参考  -> 4_其他           | 参考     | reference
 *
 * 路径安全：所有读写都锁在 WORKSPACE 下，越界一律 403。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  dshHome, listSubjects, upsertSubject, readTopics, readCards,
  buildPlan, pickQuestions, recordAttempt, stats, discoverSubjects, today, dayOf, studyRoot,
  GENERATED_RE, isGeneratedName, resolveOrigin, readGenerated, writeGenerated,
  setGeneratedFlag, backfillGenerated, pendingTranslations, applyTranslations, parsePairs,
  subjectDir, updateCard, lastAttemptByTopic,
} from './core.js'
import { EXTRACT_EXT, extractFile } from './extract.js'
import { readModelPref, writeModelPref, clearModelPref } from './modelprefs.js'
import { record as recordUsage, summarize as summarizeUsage } from './usage.js'

const PREFIX = '/api/study-coach'
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 插件自带的静态图（收款码之类）。只读，只认白名单扩展名。 */
export const ASSETS_DIR = path.join(HERE, '..', 'assets')
/** 备份 / 恢复认的文件名，白名单 —— 恢复时照这个表写，别的一律不碰。 */
const BACKUP_FILES = [
  'topics.json', 'cards.json', 'generated.json', 'attempts.jsonl',
  'paper-template.json', 'paper-images.json', 'notes.json', 'schedule.json',
]
export const ROUTES = {
  config: `${PREFIX}/config`,
  tree: `${PREFIX}/tree`,
  state: `${PREFIX}/state`,
  upload: `${PREFIX}/upload`,
  remove: `${PREFIX}/delete`,
  subject: `${PREFIX}/subject`,
  drill: `${PREFIX}/drill`,
  check: `${PREFIX}/check`,
  file: `${PREFIX}/file`,
  exportDoc: `${PREFIX}/export`,
  schedule: `${PREFIX}/schedule`,
  scheduleRemove: `${PREFIX}/schedule/delete`,
  ics: `${PREFIX}/schedule/ics`,
  ask: `${PREFIX}/ask`,
  mark: `${PREFIX}/mark`,
  translate: `${PREFIX}/translate`,
  backfill: `${PREFIX}/generated/backfill`,
  pipelineStart: `${PREFIX}/pipeline/start`,
  pipelineStatus: `${PREFIX}/pipeline/status`,
  pipelineRender: `${PREFIX}/pipeline/render`,
  sources: `${PREFIX}/sources`,
  health: `${PREFIX}/health`,
  paperTemplate: `${PREFIX}/paper/template`,
  paperAnalyze: `${PREFIX}/paper/analyze`,
  paperScope: `${PREFIX}/paper/scope`,
  paperGenerate: `${PREFIX}/paper/generate`,
  models: `${PREFIX}/models`,
  preview: `${PREFIX}/preview`,
  papers: `${PREFIX}/papers`,
  paperImages: `${PREFIX}/paper-images`,
  paperFigures: `${PREFIX}/paper-figures`,
  paperRerender: `${PREFIX}/paper/rerender`,
  raw: `${PREFIX}/raw`,
  grade: `${PREFIX}/grade`,
  usage: `${PREFIX}/usage`,
  open: `${PREFIX}/open`,
  asset: `${PREFIX}/asset`,
  backup: `${PREFIX}/backup`,
  restore: `${PREFIX}/restore`,
  notes: `${PREFIX}/notes`,
  prefs: `${PREFIX}/prefs`,
  quiz: `${PREFIX}/quiz`,
  cardsCsv: `${PREFIX}/cards.csv`,
  translateFile: `${PREFIX}/translate/file`,
  translateFileSave: `${PREFIX}/translate/file/save`,
}

/**
 * 学习资料根目录。
 *
 * 优先级：env → Windows 的 C:\Workspace（老用户已经在用，不能改）→ ~/Workspace。
 * 为什么要探测而不是写死：这个插件要放 GitHub，mac / Linux 上 C:\Workspace 不存在，
 * 写死就等于装上就不能用。
 */
function defaultWorkspace() {
  if (process.env.DSH_STUDY_WORKSPACE) return process.env.DSH_STUDY_WORKSPACE
  const cands = []
  if (process.platform === 'win32') cands.push('C:\\Workspace')
  cands.push(path.join(os.homedir(), 'Workspace'))
  cands.push(path.join(os.homedir(), 'workspace'))
  cands.push(path.join(os.homedir(), 'Documents', 'Workspace'))
  for (const c of cands) {
    try {
      if (fs.statSync(c).isDirectory()) return c
    } catch {}
  }
  return cands[0]
}

export const WORKSPACE = defaultWorkspace()

/* --------------------------------------------------------------- sections */
export const SECTIONS = [
  {
    key: 'lecture',
    label: '讲义',
    labelEn: 'Lecture Notes',
    icon: 'book',
    candidates: [['0_课程材料', '讲义'], ['讲义'], ['lectures']],
  },
  {
    key: 'homework',
    label: '作业',
    labelEn: 'Homework',
    icon: 'pen',
    candidates: [['0_课程材料', 'Tutorial'], ['0_课程材料', '作业'], ['Tutorial'], ['作业']],
  },
  {
    key: 'exam',
    label: '试卷',
    labelEn: 'Past Papers',
    icon: 'file',
    candidates: [['0_课程材料', '试卷'], ['试卷'], ['exams']],
  },
  {
    key: 'reference',
    label: '参考',
    labelEn: 'Reference',
    icon: 'clip',
    candidates: [['4_其他'], ['参考'], ['reference']],
  },
  {
    // 兜底分区：科目根下自己建的目录（1_复习资料 / 3_练习题 / 2_图解笔记 …）
    // 以前这四个分区只认固定名字，那些目录里的文件在面板上根本看不见。
    // 这个分区是动态算的，不接收拖放（拖放会落到「参考」）。
    key: 'extra',
    label: '其他目录',
    labelEn: 'More folders',
    icon: 'clip',
    dynamic: true,
    candidates: [['4_其他']],
  },
]

export function sectionKeys() {
  return SECTIONS.filter((s) => !s.dynamic).map((s) => s.key)
}

/** 找出这个分区的实际目录（存在就用，不存在用第一个候选） */
export function resolveSectionDir(code, key) {
  const sec = SECTIONS.find((s) => s.key === key)
  if (!sec) return null
  const root = path.join(WORKSPACE, String(code).toUpperCase())
  if (sec.dynamic) return root
  for (const parts of sec.candidates) {
    const p = path.join(root, ...parts)
    try {
      if (fs.statSync(p).isDirectory()) return p
    } catch {}
  }
  return path.join(root, ...sec.candidates[0])
}

/* ------------------------------------------------------------------ utils */
function writeJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      chunks.push(c)
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const buf = await readBody(req)
  try {
    return JSON.parse(buf.toString('utf8') || '{}')
  } catch {
    return {}
  }
}

function underWorkspace(p) {
  const a = path.normalize(path.resolve(String(p)))
  const b = path.normalize(path.resolve(WORKSPACE))
  if (a === b) return true
  // 必须比到分隔符为止：只比 startsWith 的话 C:\Workspace-evil 也能过
  const withSep = b.endsWith(path.sep) ? b : b + path.sep
  // Windows / macOS 默认大小写不敏感（盘符大小写混着传很常见），Linux 敏感 —— 分开比
  if (process.platform === 'linux') return a.startsWith(withSep)
  return a.toLowerCase().startsWith(withSep.toLowerCase())
}

/**
 * 复习资料落地目录。
 *
 * 不能写死 `1_复习资料`：那是这台机器的中文约定，别人 clone 下来目录名可能是
 * `review` / `notes` / 干脆没有。按候选顺序找，存在就用，都不存在才建第一个。
 */
export function reviewDirOf(code) {
  const root = path.join(WORKSPACE, String(code).toUpperCase())
  const cands = ['1_复习资料', '复习资料', 'review', 'notes', 'Review']
  for (const c of cands) {
    const p = path.join(root, c)
    try {
      if (fs.statSync(p).isDirectory()) return p
    } catch {}
  }
  const p = path.join(root, cands[0])
  try { fs.mkdirSync(p, { recursive: true }) } catch {}
  return p
}

function safeJoin(base, name) {
  const root = path.resolve(String(base))
  const p = path.resolve(root, String(name))
  if (p !== root && !p.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) {
    throw new Error('path escape blocked')
  }
  return p
}

function fmtSize(n) {
  return n < 1024 ? n + ' B'
    : n < 1048576 ? (n / 1024).toFixed(0) + ' KB'
    : (n / 1048576).toFixed(1) + ' MB'
}

/**
 * 判断一个文件是不是 DSH 这边生成的（笔记 / 速查 / 冲刺包 / 真题答案卡 之类）。
 *
 * 判定顺序（core.js 里实现）：
 *   1. 科目清单 generated.json 的 files   → 算生成物
 *   2. 科目清单 generated.json 的 unmarked → 算原件（手工纠正过命名误判）
 *   3. 命名约定 GENERATED_RE              → 猜一把
 *   4. 都没有                              → 原件
 *
 * 保留这个同名导出，是为了 index.js 和测试里老的调用点不用改。
 */
export function isGenerated(name) {
  return isGeneratedName(name)
}

export { GENERATED_RE }

function listFiles(dir, code) {
  const out = []
  let ents = []
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~$')) continue
    const full = path.join(dir, e.name)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    const src = code ? resolveOrigin(code, full, e.name) : { origin: isGeneratedName(e.name) ? 'generated' : 'source', by: 'name' }
    out.push({
      name: e.name,
      path: full,
      ext: path.extname(e.name).slice(1).toLowerCase(),
      size: st.size,
      sizeText: fmtSize(st.size),
      mtime: dayOf(st.mtimeMs),
      ts: st.mtimeMs,
      origin: src.origin,
      originBy: src.by,
    })
  }
  return out.sort((a, b) => b.ts - a.ts)
}

/**
 * 「其他目录」用：把科目根下所有没被四个固定分区收走的文件找出来。
 *
 * 规则：
 *   - 从科目根往下走，遇到固定分区的目录就整棵跳过（那些文件已经在别的分区里了）
 *   - 跳过 `_` / `.` 开头的目录（`_build` 放的是我的生成脚本，不是学习资料）
 *   - 深度最多 3 层，够覆盖 `1_复习资料/xxx.docx`、`3_练习题/ch1/a.pdf`
 *   - 每个文件带 `rel`（相对科目根），界面上直接显示，一眼知道它在哪个文件夹
 */
function listFilesDeep(root, code, skipDirs, maxDepth = 3) {
  const out = []
  const skip = new Set(skipDirs.map((p) => path.normalize(p).toLowerCase()))
  const base = path.normalize(root).toLowerCase()

  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let ents = []
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('_')) continue
        if (skip.has(path.normalize(full).toLowerCase())) continue
        walk(full, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      let st
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      const rel = path.relative(root, full).replace(/\\/g, '/')
      const src = code
        ? resolveOrigin(code, full, e.name)
        : { origin: isGeneratedName(e.name) ? 'generated' : 'source', by: 'name' }
      out.push({
        name: e.name,
        rel,
        path: full,
        ext: path.extname(e.name).slice(1).toLowerCase(),
        size: st.size,
        sizeText: fmtSize(st.size),
        mtime: dayOf(st.mtimeMs),
        ts: st.mtimeMs,
        origin: src.origin,
        originBy: src.by,
      })
    }
  }

  try {
    if (fs.statSync(root).isDirectory()) walk(root, 0)
  } catch {}
  // 同一个 deep 扫描里 base 只用来确认根存在，留着给以后的路径检查
  void base
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

function parseMultipart(buf, boundary) {
  const delim = Buffer.from('--' + boundary)
  const parts = []
  let idx = buf.indexOf(delim)
  while (idx !== -1) {
    const next = buf.indexOf(delim, idx + delim.length)
    if (next === -1) break
    const chunk = buf.slice(idx + delim.length, next)
    const body = chunk.slice(2, chunk.length - 2)
    const sep = body.indexOf('\r\n\r\n')
    if (sep !== -1) {
      const head = body.slice(0, sep).toString('utf8')
      const data = body.slice(sep + 4)
      const nameM = /name="([^"]*)"/.exec(head)
      const fileM = /filename="([^"]*)"/.exec(head)
      parts.push({ name: nameM ? nameM[1] : '', filename: fileM ? fileM[1] : null, data })
    }
    idx = next
  }
  return parts
}

/* --------------------------------------------------------------- schedule */
/** 日程存在科目数据目录里：$DSH_HOME/study/<CODE>/schedule.json */
function schedulePath(code) {
  return path.join(dshHome(), 'study', String(code).toUpperCase(), 'schedule.json')
}

export function readSchedule(code) {
  try {
    const raw = fs.readFileSync(schedulePath(code), 'utf8')
    const j = JSON.parse(raw)
    return Array.isArray(j.events) ? j.events : []
  } catch {
    return []
  }
}

export function writeSchedule(code, events) {
  const p = schedulePath(code)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ events }, null, 2) + '\n', 'utf8')
}

const EVENT_TYPES = [
  { key: 'exam', label: '考试', labelEn: 'Exam', icon: '📝', color: 'red' },
  { key: 'quiz', label: '小测', labelEn: 'Quiz', icon: '✏️', color: 'amber' },
  { key: 'assignment', label: '作业截止', labelEn: 'Assignment due', icon: '📌', color: 'blue' },
  { key: 'class', label: '上课', labelEn: 'Class', icon: '📖', color: 'teal' },
  { key: 'other', label: '其他', labelEn: 'Other', icon: '•', color: 'mute' },
]

export function eventTypes() {
  return EVENT_TYPES
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** 生成 iCalendar。有时间的用本地时间浮点，只有日期的用全天事件。 */
export function buildIcs(code, events) {
  const subj = listSubjects().find(
    (s) => String(s.code).toUpperCase() === String(code).toUpperCase(),
  )
  const name = subj ? subj.name || subj.code : code
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dsh-study-coach//Study Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(String(code).toUpperCase() + ' · ' + name)}`,
  ]
  for (const ev of events) {
    const d = String(ev.date || '').replace(/-/g, '')
    if (!/^\d{8}$/.test(d)) continue
    const type = EVENT_TYPES.find((t) => t.key === ev.type) || EVENT_TYPES[4]
    L.push('BEGIN:VEVENT')
    L.push(`UID:${ev.id || d + '-' + Math.random().toString(36).slice(2, 9)}@dsh-study-coach`)
    L.push(`DTSTAMP:${stamp()}`)
    if (ev.time && /^\d{2}:\d{2}$/.test(ev.time)) {
      L.push(`DTSTART:${d}T${ev.time.replace(':', '')}00`)
      L.push(`DTEND:${d}T${ev.endTime ? ev.endTime.replace(':', '') + '00' : ev.time.replace(':', '') + '00'}`)
    } else {
      L.push(`DTSTART;VALUE=DATE:${d}`)
      L.push(`DTEND;VALUE=DATE:${d}`)
    }
    L.push(`SUMMARY:${icsEscape('[' + String(code).toUpperCase() + '] ' + (type.icon || '') + ' ' + (ev.title || type.label))}`)
    const desc = [type.label + ' / ' + type.labelEn, ev.note || ''].filter(Boolean).join('\n')
    if (desc) L.push(`DESCRIPTION:${icsEscape(desc)}`)
    L.push(`CATEGORIES:${icsEscape(String(code).toUpperCase())}`)
    L.push('BEGIN:VALARM')
    L.push('TRIGGER:-P1D')
    L.push('ACTION:DISPLAY')
    L.push(`DESCRIPTION:${icsEscape('明天：' + (ev.title || type.label))}`)
    L.push('END:VALARM')
    L.push('END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.join('\r\n')
}

/* ------------------------------------------------------------------- ask */
/**
 * 找出 DSH 的 node_modules 根 —— 跨平台。
 *
 * `@deepseek-ai/dsh-llm` 不在 profile 的 node_modules 里，它躺在 DSH 安装目录下。
 * 插件被 junction / link 进 profile，从插件真实路径往上走走不到那儿，所以要显式找。
 *
 * 顺序（第一个能解析出 @deepseek-ai/dsh-llm 的赢）：
 *   1. env DSH_INSTALL_DIR
 *   2. Electron 的 process.resourcesPath（最可靠，三平台都对）
 *   3. 从 process.execPath 推（Win/Linux: <dir>/resources/app；macOS: <App>.app/Contents/Resources/app）
 *   4. 平台默认安装位置
 */
export function dshModuleRoots() {
  const roots = []
  const push = (p) => {
    if (!p) return
    const norm = path.normalize(p)
    if (!roots.includes(norm)) roots.push(norm)
  }

  // ⓪ 手动兜底：宿主安装目录被清理/加密/改坏过时，
  //    把从 app.asar 解出来的包放到 ~/.dsh/sdk-override/node_modules 就能救急。
  //    放最前面，因为它一定是用户确认过能用的那一份。
  push(path.join(dshHome(), 'sdk-override', 'node_modules'))

  if (process.env.DSH_INSTALL_DIR) {
    push(path.join(process.env.DSH_INSTALL_DIR, 'resources', 'app', 'node_modules'))
    push(path.join(process.env.DSH_INSTALL_DIR, 'node_modules'))
  }

  // Electron 主进程/渲染进程都带这个
  try {
    if (process.resourcesPath) {
      // app.asar 是打包好的完整副本 —— 解压出来的 resources/app/node_modules
      // 可能被清理工具/杀软/加密软件动过（缺 index.js），asar 里这份通常还完好
      push(path.join(process.resourcesPath, 'app.asar', 'node_modules'))
      push(path.join(process.resourcesPath, 'app', 'node_modules'))
    }
  } catch {}

  try {
    const exe = process.execPath
    if (exe) {
      const dir = path.dirname(exe)
      push(path.join(dir, 'resources', 'app.asar', 'node_modules'))
      push(path.join(dir, 'resources', 'app', 'node_modules'))          // Windows / Linux
      push(path.join(dir, '..', 'Resources', 'app', 'node_modules'))    // macOS .app
      push(path.join(dir, '..', '..', 'Resources', 'app', 'node_modules'))
      push(path.join(dir, '..', 'node_modules'))                        // 有些打包方式
    }
  } catch {}

  if (process.platform === 'win32') {
    // 尊重 ProgramFiles 环境变量：装在 D 盘、或系统盘不是 C 的情况都能命中
    const pf = process.env.ProgramFiles || 'C:' + path.sep + 'Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || pf
    push(path.join(pf, 'DSH NEXT', 'resources', 'app', 'node_modules'))
    push(path.join(pf, 'DSH', 'resources', 'app', 'node_modules'))
    push(path.join(pf86, 'DSH NEXT', 'resources', 'app', 'node_modules'))
    push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DSH NEXT', 'resources', 'app', 'node_modules'))
  } else if (process.platform === 'darwin') {
    push('/Applications/DSH NEXT.app/Contents/Resources/app/node_modules')
    push('/Applications/DSH.app/Contents/Resources/app/node_modules')
    push(path.join(os.homedir(), 'Applications', 'DSH NEXT.app', 'Contents', 'Resources', 'app', 'node_modules'))
  } else {
    push('/opt/dsh-next/resources/app/node_modules')
    push('/opt/DSH NEXT/resources/app/node_modules')
    push('/usr/lib/dsh-next/resources/app/node_modules')
    push('/usr/local/lib/dsh-next/resources/app/node_modules')
  }
  return roots
}

/**
 * 找 @deepseek-ai/dsh-llm。
 * 找不到就返回 null，调用方降级成「手工拼 chunk」。
 */
let _llmKit
export async function loadLlmKit() {
  if (_llmKit !== undefined) return _llmKit

  const { createRequire } = await import('node:module')
  const tryResolve = async (spec, base) => {
    try {
      const req = createRequire(base)
      const resolved = req.resolve(spec)
      return await import('file://' + resolved.replace(/\\/g, '/'))
    } catch {
      return null
    }
  }

  // ① 普通解析：宿主如果把 dsh-llm 暴露在可达路径，直接就能用
  try {
    const direct = await import('@deepseek-ai/dsh-llm')
    if (direct && direct.createUserMessage) {
      _llmKit = direct
      return _llmKit
    }
  } catch {}

  // ② 在各个候选根里解析
  for (const base of dshModuleRoots()) {
    const mod = await tryResolve('@deepseek-ai/dsh-llm', path.join(base, '_resolve.js'))
    if (mod && mod.createUserMessage) {
      _llmKit = mod
      return _llmKit
    }
  }
  _llmKit = null
  return _llmKit
}

/** 没有 BlockAssembler 时的兜底：按最常见的几种 chunk 形态累计文本 */
function collectText(chunks) {
  let out = ''
  for (const c of chunks) {
    if (!c || typeof c !== 'object') {
      if (typeof c === 'string') out += c
      continue
    }
    const kind = c.kind || c.type
    if (kind === 'finish' || kind === 'error' || kind === 'aborted') continue
    const cand =
      (typeof c.text === 'string' && c.text) ||
      (c.delta && typeof c.delta.text === 'string' && c.delta.text) ||
      (c.content && typeof c.content.text === 'string' && c.content.text) ||
      ''
    // block 形态给的是整块，delta 形态给的是增量；用 kind 区分
    if (cand) {
      if (kind && String(kind).includes('delta')) out += cand
      else if (!out.endsWith(cand)) out += cand
    }
  }
  return out
}

/**
 * 软获取 llm 服务。
 *
 * cordis 的 Context 是个 Proxy：**没在 `inject` 里声明过的服务，读一下就抛**
 * `cannot get property "llm" without inject`。这个坑差点把 DSH 干掉 ——
 * 异常从一次后台任务里冒成 unhandled rejection，host 直接 fatal 退出。
 *
 * 所以读 llm 一律走这里：能用 ctx.get 就用（返回 undefined 不抛），
 * 不行就 try/catch 兜住。真正想拿到 llm 实例，还得靠 index.js 里的
 * `ctx.inject(['llm'], ...)` 拿一个合法 ctx —— 这个函数只是「别崩」。
 */
export function pickLlm(ctx) {
  if (!ctx) return undefined
  try {
    if (typeof ctx.get === 'function') {
      const v = ctx.get('llm')
      if (v) return v
    }
  } catch {}
  try {
    return ctx.llm
  } catch {
    return undefined
  }
}

/**
 * 进程内的「坏通道」黑名单。
 *
 * 现实：deepseek-account 的账号认证 403，但 listModels 照样能拉到 2 个模型；
 * 每次调用都白试一遍，用户等几十秒才看到失败。所以谁挂过一次就记下来，
 * 十分钟内排到最后（不是永久拉黑 —— 额度会恢复、网络会好）。
 */
const BAD_PROVIDERS = new Map()
const BAD_TTL_MS = 10 * 60 * 1000

function markBad(provider, why) {
  if (!provider) return
  BAD_PROVIDERS.set(provider, { until: Date.now() + BAD_TTL_MS, why: String(why || '').slice(0, 120) })
}

function isBad(provider) {
  const hit = BAD_PROVIDERS.get(provider)
  if (!hit) return false
  if (Date.now() > hit.until) {
    BAD_PROVIDERS.delete(provider)
    return false
  }
  return true
}

/** 诊断用：当前哪些通道在冷却期、为什么 */
export function badChannels() {
  const now = Date.now()
  const out = []
  for (const [id, v] of BAD_PROVIDERS) {
    out.push({ id, why: v.why, leftSec: Math.max(0, Math.round((v.until - now) / 1000)) })
  }
  return out.filter((x) => x.leftSec > 0)
}

/**
 * 列出「可以试的通道」：每个有模型的 provider 配一个模型。
 *
 * 顺序：
 *   1. env DSH_STUDY_MODEL="provider/model" 钉死的那个（最优先）
 *   2. env DSH_STUDY_PROVIDER="a,b" 点名优先的 provider
 *   3. 其余按 listProviders 顺序，但**最近挂过的排到最后**
 *
 * 为什么每个 provider 只配一个模型：同一个 provider 下的模型往往一起挂
 * （认证 403、额度耗尽都是整个 provider 的事）。取两个只会白等两轮。
 */
async function modelCandidates(llm) {
  const out = []
  const seen = new Set()
  const push = (provider, model) => {
    if (!provider || !model) return
    const k = provider + '/' + model
    if (seen.has(k)) return
    seen.add(k)
    out.push({ provider, model })
  }

  // ① 用户在面板里选过的 —— 最优先，他选的肯定比猜的准
  const pref = readModelPref()
  if (pref) push(pref.provider, pref.model)

  // ② 环境变量钉死的
  const pinned = String(process.env.DSH_STUDY_MODEL || '').trim()
  if (pinned.includes('/')) {
    const i = pinned.indexOf('/')
    push(pinned.slice(0, i), pinned.slice(i + 1))
  }

  const prefer = String(process.env.DSH_STUDY_PROVIDER || '')
    .split(',').map((s) => s.trim()).filter(Boolean)

  let providers = []
  try {
    providers = (typeof llm.listProviders === 'function' ? llm.listProviders() : []) || []
  } catch {
    providers = []
  }
  const ids = providers.map((p) => p.id || p.provider || '').filter(Boolean)
  const ordered = [
    ...prefer.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !prefer.includes(id) && !isBad(id)),
    ...ids.filter((id) => !prefer.includes(id) && isBad(id)),
  ]

  const notes = []
  for (const id of ordered) {
    let models = []
    let err = ''
    try {
      models = (await llm.listModels(id)) || []
    } catch (e) {
      err = String((e && e.message) || e).slice(0, 100)
    }
    if (!models.length) {
      notes.push({ id, models: 0, error: err || 'no models' })
      continue
    }
    notes.push({ id, models: models.length, bad: isBad(id) })
    // 先挑看着不像 reasoning 的：reasoning 模型容易把 token 全烧在思考上、正文空着回来
    const plain = models.filter((m) => m && m.id && !/reason|think|\br1\b/i.test(m.id))
    const pick = (plain.length ? plain : models)[0]
    if (pick && pick.id) push(id, pick.id)
  }
  return { candidates: out, notes }
}

/** 调一次模型。失败不抛，把 finish / 块统计一起带回去，方便判断为什么空。 */
async function callModelOnce(llm, kit, { provider, model, system, user, maxTokens, signal, effort }) {
  const { BlockAssembler, createUserMessage } = kit
  const messages = [
    createUserMessage({
      content: [{ type: 'text', text: String(user || '').slice(0, 8000) }],
      source: { kind: 'dsh-study-coach' },
    }),
  ]

  let call
  try {
    /**
     * 关键：**把 reasoningEffort 压到最低**。
     *
     * 踩过的坑：deepseek-flash 是 reasoning 模型，默认 effort 是 high。
     * 插件只给 maxTokens=3000，模型把 token 全烧在思考上，正文一个字都没有 ——
     * 现象就是 empty-answer，而同一个模型在 DSH 对话里用得好好的（那边预算大）。
     *
     * prepareCall 的第三个参数 configure(controls, modelInfo) 是唯一能改这些的地方，
     * controls 是冻结的，必须返回新对象。efforts 里挑 none → minimal/low → medium。
     */
    call = await llm.prepareCall({ provider, model, maxTokens }, signal, (controls, info) => {
      const out = { ...controls }
      try {
        const r = info && info.reasoning
        if (r && Array.isArray(r.efforts) && r.efforts.length) {
          // 用户在面板里点了等级就听他的（只要这个模型支持）
          if (effort) {
            const hit = r.efforts.find((e) => String(e.id).toLowerCase() === String(effort).toLowerCase())
            if (hit) out.reasoningEffort = hit.id
          }
          if (out.reasoningEffort == null) {
            const pick =
              r.efforts.find((e) => /^none$/i.test(String(e.id))) ||
              r.efforts.find((e) => /^(off|minimal|low)$/i.test(String(e.id))) ||
              r.efforts.find((e) => /^medium$/i.test(String(e.id)))
            if (pick) out.reasoningEffort = pick.id
          }
        }
        // 模型自己报了默认预算就别客气，用大的那个（翻译这种小活也够）
        if (out.maxTokens == null && info && info.defaultMaxTokens) {
          out.maxTokens = Math.max(maxTokens, Math.min(info.defaultMaxTokens, 8000))
        }
      } catch {}
      return out
    })
  } catch (e) {
    return { ok: false, error: 'prepare-failed', detail: String((e && e.message) || e).slice(0, 300) }
  }

  const assembler = new BlockAssembler()
  const raw = []
  try {
    for await (const chunk of call.stream({ ...call.config, messages, system, signal })) {
      try {
        assembler.push(chunk)
      } catch {
        raw.push(chunk)
      }
    }
  } catch (e) {
    return { ok: false, error: 'stream-failed', detail: String((e && e.message) || e).slice(0, 300) }
  }

  let text = ''
  let finish
  let blockKinds = []
  try {
    const blocks = assembler.blocks()
    blockKinds = blocks.map((b) => b.type)
    text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
    finish = assembler.finish
  } catch {
    text = collectText(raw)
  }
  if (!text && raw.length) text = collectText(raw)

  const debug = {
    finish: finish ? (finish.kind || finish.type || '') : '',
    failure: finish && finish.failure ? String(finish.failure.message || finish.failure).slice(0, 200) : '',
    blocks: blockKinds,
    chunks: raw.length,
  }

  if (finish && (finish.kind === 'error' || finish.kind === 'aborted')) {
    return { ok: false, error: 'model-failed', detail: debug.failure || debug.finish, debug }
  }
  if (!text.trim()) {
    // 空正文最常见两种原因：reasoning 吃掉全部 token，或者这个通道根本没在回话
    return {
      ok: false,
      error: 'empty-answer',
      detail: debug.finish ? `模型回了 ${debug.finish} 但没有正文` : '模型没有返回文本',
      debug,
    }
  }
  return { ok: true, answer: text, provider, model, debug }
}

/** 一次调用最多试几个通道 —— 每个 provider 只配一个模型，所以这个数够覆盖全部 */
const MAX_TRIES = 6

/**
 * 通用的「问一次模型」：面板问答、翻译、知识点提炼、出卷都走这里。
 * 用的都是官方接口：listProviders / listModels / prepareCall。
 * 拿不到 llm 就返回 ok:false，调用方给降级提示 —— 绝不抛。
 */
export async function runModel(ctx, {
  system, user, maxTokens = 900, signal, llm: injected,
  feature = 'unknown', code = '',
}) {
  const llm = injected || pickLlm(ctx)
  if (!llm) {
    return {
      ok: false,
      error: 'no-llm',
      triedCount: 0,
      detail: '这个 DSH 没有暴露 llm 服务（插件没拿到合法 ctx）。把问题发到对话里一样能答。',
    }
  }

  const { candidates, notes } = await modelCandidates(llm)
  if (!candidates.length) {
    return {
      ok: false,
      error: 'no-model',
      triedCount: 0,
      detail: '所有 provider 都拿不到模型：' +
        (notes.length ? notes.map((t) => `${t.id}(${t.error || t.models})`).join(', ') : '列表为空') +
        '　可以在环境变量里指定 DSH_STUDY_MODEL=provider/model 或 DSH_STUDY_PROVIDER=a,b。',
      providers: notes,
    }
  }

  const kit = await loadLlmKit()
  if (!kit) {
    return {
      ok: false,
      error: 'no-sdk',
      triedCount: 0,
      detail: '解析不到 @deepseek-ai/dsh-llm。把问题发到对话里一样能答。',
    }
  }

  /**
   * 逐个通道试。
   * 「模型找到了但回空」和「这个通道挂了」在现象上很难分，所以不猜 —— 直接换下一个。
   * 只有 SDK 层面的问题（no-sdk）换通道也没用，那种立刻返回。
   */
  const failed = []
  for (const c of candidates.slice(0, MAX_TRIES)) {
    if (signal && signal.aborted) break
    const t0 = Date.now()
    const r = await callModelOnce(llm, kit, {
      provider: c.provider, model: c.model, system, user, maxTokens, signal,
      effort: (readModelPref() || {}).effort || '',
    })
    // 用量只记本插件发起的调用；失败也记（失败也花时间，有时也花 token）
    try {
      recordUsage({
        feature,
        code,
        provider: c.provider,
        model: c.model,
        promptChars: String(system || '').length + String(user || '').length,
        outputChars: r.ok ? String(r.answer || '').length : 0,
        ms: Date.now() - t0,
        ok: r.ok,
        error: r.ok ? '' : r.error,
      })
    } catch {}
    if (r.ok) {
      // 成功了就把它从黑名单里放出来
      BAD_PROVIDERS.delete(c.provider)
      return { ...r, triedCount: failed.length + 1 }
    }
    failed.push({ provider: c.provider, model: c.model, error: r.error, detail: r.detail, debug: r.debug })
    // 这个通道挂了（认证/额度/空回答）→ 十分钟内排到最后，别每次调用都先白试它
    markBad(c.provider, r.error + (r.detail ? ': ' + String(r.detail).slice(0, 80) : ''))
  }

  const last = failed[failed.length - 1] || {}
  return {
    ok: false,
    error: last.error || 'model-failed',
    detail: (last.detail || '所有通道都没回文本') +
      (failed.length
        ? '\n试过的通道：' + failed.map((f) => `${f.provider}/${f.model}(${f.error})`).join('、')
        : ''),
    tried: failed,
  }
}

/** 面板问答：包一层，把科目上下文塞进 system。 */
async function askModel(ctx, { question, context, signal, llm }) {
  const system = [
    '你是一个学习助手，正在帮一个学生复习他正在学的科目。',
    '回答要短、具体、直接给方法和结论，不要客套话。',
    '如果他问的是某道题，先给思路再给答案。',
    '数学符号用普通文本写，别用 Markdown 表格。',
    context
      ? '下面是这个科目的资料索引和你已知的知识点，可以据此回答：\n' + context
      : '',
  ].join('\n')
  return runModel(ctx, { system, user: question, maxTokens: 900, signal, llm, feature: 'ask' })
}

/**
 * 批量翻译：一次塞 12 条，让模型吐 JSON。返回 [{ k, v }]。
 * 分块是为了不让长科目把上下文塞爆，也方便失败时只重试一块。
 */
export async function translateTopics(ctx, code, { items, target, signal, llm } = {}) {
  const BATCH = 12
  const out = []
  const errors = []
  const dirText = target === 'en' ? '中文 → English' : 'English → 中文'

  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH)
    const system = [
      '你是术语翻译器，正在为一个IT / 数学科目做中英对照表。',
      `方向：${dirText}。`,
      '要求：',
      '1. 输出严格 JSON 数组，形如 [{"k":"原文","v":"译文"}]，不要任何解释、不要 Markdown 代码块以外的文字。',
      '2. k 必须和输入原文逐字一致，不要改写、不要加编号。',
      '3. 译文用学科标准术语（例如 Dijkstra 最短路径 → Dijkstra Shortest Path）。',
      '4. 不要音译人名以外的词，不要加句号。',
    ].join('\n')
    const user = JSON.stringify(slice.map((s) => s.src))

    const r = await runModel(ctx, { system, user, maxTokens: 1400, signal, llm, feature: 'translate', code })
    if (!r.ok) {
      errors.push({ from: i, error: r.error, detail: r.detail })
      continue
    }
    const pairs = parsePairs(r.answer)
    for (const p of pairs) {
      // 模型偶尔会把简体改成繁体或者加空格，按去掉空白后的原文对齐
      const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase()
      const hit = slice.find((s) => norm(s.src) === norm(p.k))
      if (hit) out.push({ k: hit.src, v: p.v })
    }
  }
  return { pairs: out, errors }
}

/* ================================================================ 整份文件翻译
 * 为什么不能复用 translateTopics：
 *   ① 那头翻的是「知识点标题」，一句话一段；这里要对付整页讲义，得先切段。
 *   ② 那头靠原文匹配回填，讲义里「Find x.」这种句子重复出现，按文本匹配必然串行 → 这里按序号回填。
 *   ③ 一份讲义几千字，译一次要花不少 token → 结果落盘缓存，同文件同方向再点就走缓存。
 */

const TRANS_FILE_VER = 1

const TRANS_FILE_PROMPT = [
  '你是一名专业翻译，在给IT / 数学课程做中英对照翻译。',
  '输入是一个 JSON 数组：[{"i":序号,"t":"原文"}]。',
  '输出严格的 JSON 数组，每条一个对象：{"i":同一个序号,"v":"译文"}。',
  '要求：',
  '1. 只输出 JSON 数组，不要解释、不要在数组外面加文字。',
  '2. i 原样照抄，不要重新编号，不要漏条目、不要合并条目。',
  '3. 一条输入对应一条输出；原文里的换行在译文里保留为 \\n。',
  '4. 专业术语用学科标准译法；人名、公式、代码、命令、变量名不翻译。',
  '5. 数学式子保持原样，用普通文本写（^ 表示幂），不要 LaTeX。',
]

function transCacheDir(code) {
  return path.join(dshHome(), 'study', String(code || 'PREVIEW').toUpperCase(), 'translate')
}

function transKey(file, target, maxChars) {
  let st
  try { st = fs.statSync(file) } catch { st = { size: 0, mtimeMs: 0 } }
  return crypto.createHash('sha1')
    .update([TRANS_FILE_VER, file, st.size, Math.round(st.mtimeMs), target, maxChars].join('|'))
    .digest('hex')
}

/**
 * 把整篇文本切成语义块。
 * 空行断段；单段超过 maxSegChars 按长度硬切（优先切在空格处）；
 * 总长超过 maxChars 截断并回报 truncated；页码、分隔线这种噪声直接丢掉。
 */
export function splitSegments(text, { maxSegChars = 700, maxChars = 12000 } = {}) {
  const raw = String(text || '').replace(/\r\n?/g, '\n')
  const clipped = raw.length > maxChars ? raw.slice(0, maxChars) : raw
  const out = []
  let buf = ''
  const hardSplit = (t) => {
    const parts = []
    let rest = t
    while (rest.length > maxSegChars) {
      let cut = maxSegChars
      const sp = rest.lastIndexOf(' ', maxSegChars)
      if (sp > maxSegChars * 0.5) cut = sp
      parts.push(rest.slice(0, cut))
      rest = rest.slice(cut).replace(/^\s+/, '')
    }
    if (rest.trim()) parts.push(rest)
    return parts
  }
  const flush = () => {
    const t = buf.replace(/\s+$/, '')
    buf = ''
    if (!t.trim()) return
    for (const part of hardSplit(t)) {
      // PDF 抽出来满地是页码、分隔线、"5" 这种 —— 送模型翻它们是纯烧 token
      const flat = part.replace(/\s+/g, '')
      if (flat.length < 3) continue
      if (/^[\d\s.\-–—•·/()[\]]+$/.test(part.trim())) continue
      out.push(part)
    }
  }
  for (const line of clipped.split('\n')) {
    const l = line.replace(/\s+$/, '')
    if (!l.trim()) { flush(); continue }
    if (buf && buf.length + l.length + 1 > maxSegChars) flush()
    buf = buf ? buf + '\n' + l : l
  }
  flush()
  return {
    segments: out,
    chars: clipped.length,
    total: raw.length,
    truncated: raw.length > clipped.length,
  }
}

/**
 * 解析模型回来的 [{i,v}]。
 * 这里靠序号对齐，不靠原文匹配 —— 讲义里重复句子太多，按文本对齐会串行。
 */
export function parseIndexed(raw) {
  const s = String(raw || '')
  const grab = (t) => {
    try {
      const j = JSON.parse(t.replace(/,\s*([\]}])/g, '$1'))
      return Array.isArray(j) ? j : null
    } catch { return null }
  }
  const a = s.indexOf('[')
  const b = s.lastIndexOf(']')
  let arr = a !== -1 && b > a ? grab(s.slice(a, b + 1)) : null
  if (!arr) {
    arr = []
    const re = /\{\s*"?i"?\s*:\s*(\d+)\s*,\s*"?v"?\s*:\s*"([\s\S]*?)"\s*\}/g
    let m
    while ((m = re.exec(s))) arr.push({ i: Number(m[1]), v: m[2] })
  }
  const out = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const i = Number(it.i ?? it.index ?? it.id)
    const v = it.v ?? it.t ?? it.text ?? it.dst ?? it.translation
    if (Number.isFinite(i) && typeof v === 'string') out.push({ i: Math.round(i), v })
  }
  return out
}

/**
 * 分段翻译：按条数 + 字符预算切批，串行调模型，按序号回填。
 * 返回 { out: string[], errors: [], batches }
 */
export async function translateSegments(ctx, code, { segments, target, signal, llm } = {}) {
  const dirText = target === 'en' ? '中文 → English' : 'English → 中文'
  const BATCH = 8
  const CHAR_BUDGET = 2000
  const plain = new Array(segments.length).fill('')
  const errors = []

  const batches = []
  let cur = []
  let chars = 0
  for (const s of segments) {
    const n = String(s.text || '').length
    if (cur.length && (cur.length >= BATCH || chars + n > CHAR_BUDGET)) {
      batches.push(cur)
      cur = []
      chars = 0
    }
    cur.push(s)
    chars += n
  }
  if (cur.length) batches.push(cur)

  const system = TRANS_FILE_PROMPT.concat([`方向：${dirText}。`]).join('\n')

  for (const batch of batches) {
    if (signal && signal.aborted) break
    const user = JSON.stringify(batch.map((s) => ({ i: s.i, t: s.text })))
    let r
    try {
      r = await runModel(ctx, {
        system, user, maxTokens: 1800, signal, llm, feature: 'translate-file', code,
      })
    } catch (e) {
      // SDK 抛出来的东西一律在这儿拦下：在 HTTP handler 里变成 unhandled rejection 会带崩 host
      errors.push({
        from: batch[0] ? batch[0].i : 0,
        error: 'model-threw',
        detail: String((e && e.message) || e).slice(0, 200),
      })
      continue
    }
    if (!r.ok) {
      errors.push({
        from: batch[0] ? batch[0].i : 0,
        error: r.error || 'model-failed',
        detail: String(r.detail || '').slice(0, 200),
      })
      continue
    }
    const got = parseIndexed(r.answer)
    const want = new Set(batch.map((s) => s.i))
    let hit = 0
    for (const g of got) {
      if (want.has(g.i)) { plain[g.i] = g.v; hit++ }
    }
    if (!hit) {
      // 模型把 i 丢了：条数刚好对得上就按顺序回填，否则记错
      if (got.length === batch.length) {
        batch.forEach((s, k) => { plain[s.i] = got[k].v })
      } else {
        errors.push({ from: batch[0] ? batch[0].i : 0, error: 'bad-index', detail: '模型没按序号回，且条数对不上' })
      }
    }
  }
  return { out: plain, errors, batches: batches.length }
}

const QUIZ_PROMPT = `你在把一道练习题改造成**单选题**，给不能打公式的学生做。

只输出 JSON，不要解释、不要代码块：
{
  "stem": "题干（可以沿用原题，也可以改写成更适合选择题的表述）",
  "options": [
    { "id": "A", "text": "选项内容" },
    { "id": "B", "text": "选项内容" },
    { "id": "C", "text": "选项内容" },
    { "id": "D", "text": "选项内容" }
  ],
  "answerId": "B",
  "why": "为什么这个是正确答案（一句话）",
  "trap": "最常见的错误选项会怎么错（一句话）"
}

要求：
1. **四个选项，只有一个对**。干扰项必须是「看起来合理但实际错」的常见误解，不要瞎编无关内容。
2. 选项长度尽量接近，别让正确答案明显更长或更短（那是送分）。
3. 数值题的干扰项用「算错一步会得到的值」——比如漏了排列、符号搞反、少乘一次。
4. 数学符号用普通文本（^ 表示幂），不要 LaTeX。
5. 原题如果是大题，就拆出其中一个可判定的点来做选择题。
6. answerId 只能是 A/B/C/D 之一。`

/**
 * 给一张题卡生成选择题形态（并缓存进 cards.json）。
 * 返回 { ok, mcq }。
 */
async function buildQuiz(ctx, { code, card, llm }) {
  if (card.mcq && card.mcq.options && card.mcq.options.length >= 2) {
    return { ok: true, mcq: card.mcq, cached: true }
  }
  const user = [
    `题目：${card.question}`,
    card.answer ? `参考答案：${card.answer}` : '',
    card.marks ? `分值：${card.marks}` : '',
    card.source ? `出处：${card.source}` : '',
  ].filter(Boolean).join('\n')

  const r = await runModel(ctx, {
    system: QUIZ_PROMPT, user, maxTokens: 1200, feature: 'quiz', code, llm,
  })
  if (!r.ok) return { ok: false, error: r.error, detail: r.detail }

  const j = parsePairs // 只为确保 parsePairs 被引用（下面用 parseJson）
  void j
  const text = String(r.answer || '')
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  let q = null
  if (a !== -1 && b > a) {
    try {
      q = JSON.parse(text.slice(a, b + 1).replace(/,\s*([\]}])/g, '$1'))
    } catch {}
  }
  if (!q || !Array.isArray(q.options) || q.options.length < 2) {
    return { ok: false, error: 'bad-quiz', detail: '模型没给出可用的选择题 JSON' }
  }
  const options = q.options
    .map((o, i) => ({
      id: String(o.id || String.fromCharCode(65 + i)).toUpperCase().slice(0, 1),
      text: String(o.text || '').trim(),
    }))
    .filter((o) => o.text)
  if (options.length < 2) return { ok: false, error: 'bad-quiz', detail: '选项太少' }

  const answerId = String(q.answerId || '').toUpperCase().slice(0, 1)
  const mcq = {
    stem: String(q.stem || card.question || ''),
    options,
    answerId: options.some((o) => o.id === answerId) ? answerId : options[0].id,
    why: String(q.why || '').slice(0, 400),
    trap: String(q.trap || '').slice(0, 400),
    at: new Date().toISOString(),
  }
  try {
    updateCard(code, card.id, { mcq })
  } catch {}
  return { ok: true, mcq }
}

/* ---------------------------------------------------------------- payload */
export function buildConfig() {
  return {
    ok: true,
    workspace: WORKSPACE,
    sections: SECTIONS.map((s) => ({
      key: s.key,
      label: s.label,
      labelEn: s.labelEn,
      icon: s.icon,
      dynamic: !!s.dynamic,
    })),
    // 生成物的命名特征由服务端下发，客户端导入分区时不再自带一份正则 ——
    // 以前两边各写一份，改了一边就悄悄不一致了。
    generatedPatterns: GENERATED_RE.source,
    generatedFlags: GENERATED_RE.flags,
    translateTargets: [
      { key: 'en', label: '中 → 英', labelEn: 'Chinese → English' },
      { key: 'zh', label: '英 → 中', labelEn: 'English → Chinese' },
    ],
  }
}

export function buildTree() {
  const subs = listSubjects()
  const subjects = subs.map((s) => {
    const sections = {}
    // 固定分区的目录，deep 扫描时要整棵跳过
    const primaryDirs = SECTIONS
      .filter((sec) => !sec.dynamic)
      .map((sec) => resolveSectionDir(s.code, sec.key))
      .filter(Boolean)

    for (const sec of SECTIONS) {
      if (sec.dynamic) {
        const root = resolveSectionDir(s.code, sec.key)
        sections[sec.key] = {
          label: sec.label,
          dir: root || '',
          dynamic: true,
          files: root
            ? listFilesDeep(root, s.code, primaryDirs).map((f) => ({
              name: f.name, rel: f.rel, path: f.path, ext: f.ext,
              size: f.size, sizeText: f.sizeText, mtime: f.mtime,
              origin: f.origin, originBy: f.originBy,
            }))
            : [],
        }
        continue
      }
      const dir = resolveSectionDir(s.code, sec.key)
      sections[sec.key] = {
        label: sec.label,
        dir: dir || '',
        files: dir ? listFiles(dir, s.code).map((f) => ({
          name: f.name, path: f.path, ext: f.ext,
          size: f.size, sizeText: f.sizeText, mtime: f.mtime,
          origin: f.origin, originBy: f.originBy,
        })) : [],
      }
    }
    const topics = readTopics(s.code).topics
    const cards = readCards(s.code).cards
    const avg = topics.length
      ? topics.reduce((a, t) => a + (t.mastery || 0), 0) / topics.length
      : 0
    return {
      code: s.code,
      name: s.name,
      examDate: s.examDate,
      notes: topics.length,
      cards: cards.length,
      avgMastery: Number(avg.toFixed(3)),
      sections,
    }
  })

  const known = new Set(subs.map((s) => String(s.code).toUpperCase()))
  const unregistered = discoverSubjects(WORKSPACE)
    .filter((d) => !known.has(d.code))
    .map((d) => ({ code: d.code, root: d.root, fileCount: d.fileCount }))

  return { ok: true, workspace: WORKSPACE, subjects, unregistered }
}

export function buildState(code) {
  const subjects = listSubjects()
  const target = code || subjects[0]?.code
  if (!target) return { ok: true, subjects: [], current: null }

  const st = stats(target)
  const plan = buildPlan(target, { perDay: 8 })
  const topics = readTopics(target).topics
  const rawCards = readCards(target).cards
  const lastByTopic = lastAttemptByTopic(target)
  const answers = {}
  for (const c of rawCards) answers[c.id] = c.answer

  let wrong = []
  try {
    const p = path.join(dshHome(), 'study', String(target).toUpperCase(), 'attempts.jsonl')
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    const byTopic = new Map()
    for (const ln of lines) {
      let a
      try {
        a = JSON.parse(ln)
      } catch {
        continue
      }
      if (!a.correct) byTopic.set(a.topicKey, (byTopic.get(a.topicKey) || 0) + 1)
    }
    wrong = [...byTopic.entries()]
      .map(([topicKey, n]) => {
        const t = topics.find((x) => x.key === topicKey)
        return { topicKey, times: n, title: t?.title ?? topicKey, mastery: t?.mastery ?? 0 }
      })
      .sort((a, b) => b.times - a.times)
      .slice(0, 12)
  } catch {}

  return {
    ok: true,
    subjects: subjects.map((s) => ({ code: s.code, name: s.name, examDate: s.examDate })),
    current: {
      code: target,
      name: subjects.find((s) => s.code === target)?.name ?? target,
      examDate: subjects.find((s) => s.code === target)?.examDate ?? '',
      stats: st,
      plan,
      topics: topics.map((t) => ({
        key: t.key, lecture: t.lecture, title: t.title, titleEn: t.titleEn,
        mastery: t.mastery, due: t.due, seen: t.seen, right: t.right, wrong: t.wrong,
      })),
      cards: rawCards.map((c) => ({
        id: c.id, topicKey: c.topicKey, question: c.question,
        marks: c.marks, source: c.source,
        // 选择题形态（做过一次就缓存进 cards.json，别再花 token 生成）
        mcq: c.mcq || null,
        // 上次作答结果：题目列表用它打 ✅ / ✗
        lastResult: c.topicKey && lastByTopic[c.topicKey] ? lastByTopic[c.topicKey] : null,
      })),
      answers,
      wrong,
    },
  }
}

/* -------------------------------------------------------------- documents */
const pct = (m) => Math.round((Number(m) || 0) * 100) + '%'

function groupByLecture(topics) {
  const g = {}
  for (const t of topics) (g[t.lecture || '—'] = g[t.lecture || '—'] || []).push(t)
  return Object.keys(g)
    .sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))
    .map((k) => [k, g[k]])
}

/**
 * 生成 Markdown 文档。
 *   kind = 'summary'    学习总结：按章节 + 掌握度 + 薄弱点 + 错题
 *   kind = 'cheatsheet' 速记卡：一页纸，每条一行，可带英文对照
 *   locale = 'zh' | 'en' | 'both'
 */
export function buildDocument(code, { kind = 'summary', locale = 'both', tz = '' } = {}) {
  const subj = listSubjects().find((s) => String(s.code).toUpperCase() === String(code).toUpperCase())
  if (!subj) return { ok: false, error: `科目 ${code} 未登记` }

  const topics = readTopics(code).topics
  const cards = readCards(code).cards
  const st = stats(code)
  const plan = buildPlan(code, { perDay: 8 })
  const groups = groupByLecture(topics)
  const title = subj.name || subj.code
  const L = []

  const wantZh = locale === 'zh' || locale === 'both'
  const wantEn = locale === 'en' || locale === 'both'

  if (kind === 'cheatsheet') {
    /* ------------------------------------------------ 速记卡 */
    L.push(`# ${subj.code} · ${title} — 速记卡`)
    L.push('')
    if (wantEn) L.push(`_Quick reference — ${title}_`)
    L.push('')
    L.push(`> 生成于 ${today()}${subj.examDate ? ` · 考试 ${subj.examDate}` : ''}` +
      (plan.daysLeft != null ? ` · 还有 ${plan.daysLeft} 天` : ''))
    L.push('')
    for (const [lec, list] of groups) {
      L.push(`## ${lec}`)
      L.push('')
      for (const t of list) {
        const m = pct(t.mastery)
        if (wantZh && wantEn && t.titleEn) L.push(`- **${t.title}** / ${t.titleEn}　\`${m}\``)
        else if (wantEn && t.titleEn) L.push(`- **${t.titleEn}**　\`${m}\``)
        else L.push(`- **${t.title}**　\`${m}\``)
      }
      L.push('')
    }
    if (st.weak.length) {
      L.push('## 最该补的 / Weakest first')
      L.push('')
      for (const w of st.weak) L.push(`- ${pct(w.mastery)}　${w.title}`)
      L.push('')
    }
    return { ok: true, kind, markdown: L.join('\n'), filename: `${subj.code}-cheatsheet.md` }
  }

  /* ------------------------------------------------ 学习总结 */
  L.push(`# ${subj.code} · ${title}`)
  L.push('')
  if (wantEn) L.push(`_Study summary — ${title}_`)
  L.push('')
  L.push(`> 生成于 ${today()}${subj.examDate ? ` · 考试 ${subj.examDate}` : ''}` +
    (plan.daysLeft != null ? ` · 还有 ${plan.daysLeft} 天` : ''))
  L.push('')

  L.push('## 总览 / Overview')
  L.push('')
  L.push('| 项目 | 数值 |')
  L.push('| --- | --- |')
  L.push(`| 知识点 Topics | ${st.totalTopics} |`)
  L.push(`| 学过 Studied | ${st.studied} |`)
  L.push(`| 平均掌握 Avg mastery | ${pct(st.avgMastery)} |`)
  L.push(`| 今天到期 Due today | ${st.dueNow} |`)
  L.push(`| 题卡 Cards | ${cards.length} |`)
  if (plan.perDayNeeded) L.push(`| 每天至少 Per day | ${plan.perDayNeeded} |`)
  L.push('')

  L.push('## 掌握度分布 / Mastery bands')
  L.push('')
  L.push('| 档位 Band | 数量 Count |')
  L.push('| --- | --- |')
  for (const b of st.byBucket) L.push(`| ${b.name} | ${b.count} |`)
  L.push('')

  L.push('## 按章节 / By lecture')
  L.push('')
  for (const [lec, list] of groups) {
    const avg = list.reduce((a, t) => a + (t.mastery || 0), 0) / list.length
    const done = list.filter((t) => (t.mastery || 0) >= 0.9).length
    L.push(`### ${lec}　${pct(avg)}（稳固 ${done}/${list.length}）`)
    L.push('')
    for (const t of list) {
      const en = wantEn && t.titleEn ? ` / ${t.titleEn}` : ''
      const mark = (t.mastery || 0) >= 0.9 ? '✅' : (t.mastery || 0) >= 0.5 ? '🟡' : '🔴'
      L.push(`- ${mark} ${wantEn && !wantZh ? t.titleEn : t.title}${wantEn && wantZh ? en : ''}　\`${pct(t.mastery)}\``)
    }
    L.push('')
  }

  if (st.weak.length) {
    L.push('## 最该先补 / Weakest topics')
    L.push('')
    for (const w of st.weak) L.push(`1. ${pct(w.mastery)}　${w.title}${wantEn && w.titleEn ? ` / ${w.titleEn}` : ''}`)
    L.push('')
  }

  if (plan.todayList.length) {
    L.push('## 今日计划 / Today')
    L.push('')
    for (const t of plan.todayList) L.push(`- [ ] ${t.title}　\`${pct(t.mastery)}\``)
    L.push('')
  }

  return { ok: true, kind, markdown: L.join('\n'), filename: `${subj.code}-summary.md` }
}

/* ---------------------------------------------------------------- routes */
/**
 * @param ctx  宿主 ctx
 * @param getLlm 可选：() => llm。由 index.js 用 ctx.inject(['llm'], ...) 拿到的合法
 *               实例；拿不到就返回 undefined，各接口降级而不是崩。
 */
export function makeRoutes(ctx, getLlm) {
  const log = (e) => {
    try {
      ctx?.logger?.warn?.(e)
    } catch {}
  }
  const fail = (res, e) => writeJson(res, 500, { ok: false, error: String((e && e.message) || e) })
  const llmNow = () => {
    try {
      return typeof getLlm === 'function' ? getLlm() : pickLlm(ctx)
    } catch {
      return undefined
    }
  }

  return [
    {
      kind: 'exact',
      path: ROUTES.config,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          writeJson(res, 200, buildConfig())
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.tree,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          writeJson(res, 200, buildTree())
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.state,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          writeJson(res, 200, buildState(url.searchParams.get('code')))
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.upload,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const buf = await readBody(req)
          const ct = req.headers['content-type'] || ''
          const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct)
          if (!m) return writeJson(res, 400, { ok: false, error: 'no boundary' })
          const parts = parseMultipart(buf, (m[1] || m[2]).trim())

          let code = ''
          let section = 'reference'
          const files = []
          for (const p of parts) {
            if (p.filename) files.push(p)
            else if (p.name === 'code') code = p.data.toString('utf8').trim()
            else if (p.name === 'section') section = p.data.toString('utf8').trim()
          }
          if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          if (!files.length) return writeJson(res, 400, { ok: false, error: '没有文件' })

          // 「其他目录」是只读浏览用的兜底分区，拖进去的文件一律落到「参考」，
          // 免得文件散进科目根，下次自己都找不到。
          let fallback = null
          if (SECTIONS.find((s) => s.key === section)?.dynamic) {
            fallback = 'reference'
            section = 'reference'
          }

          const dir = resolveSectionDir(code, section)
          if (!dir) return writeJson(res, 400, { ok: false, error: '未知分区 ' + section })
          fs.mkdirSync(dir, { recursive: true })
          const saved = []
          for (const f of files) {
            const name = path.basename(f.filename).replace(/[\\/:*?"<>|]/g, '_')
            fs.writeFileSync(safeJoin(dir, name), f.data)
            saved.push({ name, size: f.data.length, sizeText: fmtSize(f.data.length) })
          }
          writeJson(res, 200, { ok: true, dir, saved, redirectedTo: fallback })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.remove,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          // 支持单个 {path} 和批量 {paths:[...]} —— 面板上的多选删除走后者
          const list = Array.isArray(b.paths) ? b.paths : (b.path ? [b.path] : [])
          if (!list.length) return writeJson(res, 400, { ok: false, error: '没给要删的路径' })

          const done = []
          const skipped = []
          for (const raw of list) {
            const p = path.normalize(String(raw || ''))
            if (!p || !underWorkspace(p)) {
              skipped.push({ path: p, reason: '不在工作区里' })
              continue
            }
            try {
              // 只删文件，别让一个误传的目录把整个科目删掉
              const st = fs.statSync(p)
              if (st.isDirectory()) {
                skipped.push({ path: p, reason: '这是目录，批量删除只处理文件' })
                continue
              }
              fs.rmSync(p, { force: true })
              done.push(p)
            } catch (e) {
              skipped.push({ path: p, reason: String((e && e.message) || e).slice(0, 120) })
            }
          }
          writeJson(res, 200, {
            ok: done.length > 0,
            deleted: done.length,
            skipped,
            error: done.length ? undefined : (skipped[0] ? skipped[0].reason : '一个都没删成'),
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.subject,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const s = upsertSubject({
            code: b.code,
            name: b.name || b.code,
            examDate: b.examDate || '',
          })
          // 顺手把四个固定分区目录建好，用户拖文件进去就不会落空
          if (b.createDirs !== false) {
            for (const sec of SECTIONS) {
              if (sec.dynamic) continue
              try {
                fs.mkdirSync(resolveSectionDir(s.code, sec.key), { recursive: true })
              } catch {}
            }
          }
          writeJson(res, 200, { ok: true, subject: s })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.drill,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const r = pickQuestions(b.code, { count: b.count, topicKeys: b.topicKeys })
          writeJson(res, 200, { ok: true, cards: r.cards, reason: r.reason })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.check,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, reason: 'code 必填' })
          writeJson(res, 200, recordAttempt(b.code, {
            cardId: b.cardId, topicKey: b.topicKey, correct: !!b.correct,
          }))
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.file,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const p = path.normalize(url.searchParams.get('path') || '')
          if (!underWorkspace(p)) {
            res.writeHead(403)
            res.end('forbidden')
            return
          }
          const st = fs.statSync(p)
          const ext = path.extname(p).slice(1).toLowerCase()
          const mimes = {
            pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
            jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
            txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
          }
          const inline = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md'].includes(ext)
          res.writeHead(200, {
            'Content-Type': mimes[ext] || 'application/octet-stream',
            'Content-Length': st.size,
            'Content-Disposition': (inline ? 'inline' : 'attachment') +
              "; filename*=UTF-8''" + encodeURIComponent(path.basename(p)),
          })
          fs.createReadStream(p).pipe(res)
        } catch {
          res.writeHead(404)
          res.end('not found')
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.exportDoc,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const doc = buildDocument(b.code, {
            kind: b.kind === 'cheatsheet' ? 'cheatsheet' : 'summary',
            locale: ['zh', 'en', 'both'].includes(b.locale) ? b.locale : 'both',
          })
          if (!doc.ok) return writeJson(res, 400, doc)

          let savedPath = ''
          if (b.save) {
            const dir = resolveSectionDir(b.code, 'reference')
            fs.mkdirSync(dir, { recursive: true })
            savedPath = safeJoin(dir, doc.filename)
            fs.writeFileSync(savedPath, doc.markdown, 'utf8')
          }
          writeJson(res, 200, { ok: true, ...doc, path: savedPath })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------------ schedule */
    {
      kind: 'exact',
      path: ROUTES.schedule,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
          return writeJson(res, 405, { ok: false })
        }
        try {
          if (req.method === 'GET') {
            const url = new URL(req.url ?? '/', 'http://x')
            const code = url.searchParams.get('code')
            if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
            return writeJson(res, 200, {
              ok: true,
              code: String(code).toUpperCase(),
              types: EVENT_TYPES,
              events: readSchedule(code),
            })
          }
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const events = readSchedule(b.code)
          const ev = {
            id: b.id || 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            type: EVENT_TYPES.some((t) => t.key === b.type) ? b.type : 'other',
            title: String(b.title || '').slice(0, 120) || '未命名',
            date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today(),
            time: /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '',
            endTime: /^\d{2}:\d{2}$/.test(b.endTime || '') ? b.endTime : '',
            note: String(b.note || '').slice(0, 500),
            createdAt: new Date().toISOString(),
          }
          const i = events.findIndex((e) => e.id === ev.id)
          if (i >= 0) events[i] = { ...events[i], ...ev }
          else events.push(ev)
          events.sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0))
          writeSchedule(b.code, events)
          writeJson(res, 200, { ok: true, event: ev, events })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.scheduleRemove,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code || !b.id) return writeJson(res, 400, { ok: false, error: 'code / id 必填' })
          const events = readSchedule(b.code).filter((e) => e.id !== b.id)
          writeSchedule(b.code, events)
          writeJson(res, 200, { ok: true, events })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.ics,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const code = url.searchParams.get('code')
          if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const body = buildIcs(code, readSchedule(code))
          const fname = String(code).toUpperCase() + '-schedule.ics'
          res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(fname),
            'Cache-Control': 'no-store',
          })
          res.end(body)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ----------------------------------------------------------- ask */
    {
      kind: 'exact',
      path: ROUTES.ask,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.question) return writeJson(res, 400, { ok: false, error: 'question 必填' })

          // 给模型一点这个科目的上下文（知识点 + 章节），别让它瞎猜
          let context = ''
          if (b.code) {
            const topics = readTopics(b.code).topics
            const plan = buildPlan(b.code, { perDay: 8 })
            const lines = []
            lines.push(`科目：${b.code}${b.name ? ' ' + b.name : ''}`)
            if (plan.examDate) lines.push(`考试日：${plan.examDate}（还有 ${plan.daysLeft} 天）`)
            if (topics.length) {
              const byLec = {}
              for (const t of topics) (byLec[t.lecture || '—'] = byLec[t.lecture || '—'] || []).push(t)
              lines.push('知识点：')
              for (const [lec, list] of Object.entries(byLec)) {
                lines.push(
                  `  ${lec}: ` +
                  list.map((t) => `${t.title}${t.titleEn ? '(' + t.titleEn + ')' : ''} [掌握${Math.round((t.mastery || 0) * 100)}%]`).join('、'),
                )
              }
            }
            context = lines.join('\n')
          }

          const ctrl = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ctrl.abort() })
          const r = await askModel(ctx, { question: b.question, context, signal: ctrl.signal, llm: llmNow() })
          writeJson(res, r.ok ? 200 : 503, r)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------- 原件 / 生成物标记 */
    // POST { code, path, generated: true|false|null }
    // 手工纠正来源判定：真老师发的「总结.pdf」可以标回原件，我生成的也能标成生成物。
    {
      kind: 'exact',
      path: ROUTES.mark,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          if (!b.path) return writeJson(res, 400, { ok: false, error: 'path 必填' })
          if (!underWorkspace(b.path)) {
            return writeJson(res, 403, { ok: false, error: '只能标记 Workspace 里的文件' })
          }
          const flag = b.generated === null || b.generated === undefined
            ? null
            : !!b.generated
          setGeneratedFlag(b.code, { filePath: b.path, generated: flag })
          const src = resolveOrigin(b.code, b.path)
          writeJson(res, 200, { ok: true, origin: src.origin, by: src.by })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* --------------------------------------------- 给历史生成物补票 */
    // POST { code }：把按命名判成生成物的文件一次性写进清单
    {
      kind: 'exact',
      path: ROUTES.backfill,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const dirs = SECTIONS
            .map((s) => resolveSectionDir(b.code, s.key))
            .filter(Boolean)
          // 顺手把科目根目录也算上（有人直接甩文件在根下）
          dirs.push(path.join(WORKSPACE, String(b.code).toUpperCase()))
          const r = backfillGenerated(b.code, [...new Set(dirs)])
          writeJson(res, 200, { ok: true, ...r })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------------- 翻译 */
    // POST { code, target: 'en'|'zh', keys?: [], force?: bool, dryRun?: bool }
    // 把知识点的中/英标题互相补齐，写回 topics.json。口语化的说法见 README。
    {
      kind: 'exact',
      path: ROUTES.translate,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const target = b.target === 'zh' ? 'zh' : 'en'
          const pending = pendingTranslations(b.code, {
            target,
            keys: b.keys || [],
            force: !!b.force,
          })
          const items = pending.map((t) => ({
            key: t.key,
            src: String(target === 'en' ? t.title : t.titleEn).trim(),
          })).filter((x) => x.src)

          if (!items.length) {
            return writeJson(res, 200, {
              ok: true, target, pending: 0, updated: 0, pairs: [],
              note: '没有需要翻译的条目',
            })
          }
          if (b.dryRun) {
            return writeJson(res, 200, {
              ok: true, target, pending: items.length, updated: 0,
              preview: items.slice(0, 40),
            })
          }

          const ctrl = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ctrl.abort() })
          const t0 = Date.now()
          const { pairs, errors } = await translateTopics(ctx, b.code, {
            items, target, signal: ctrl.signal, llm: llmNow(),
          })
          const applied = applyTranslations(b.code, { target, pairs })
          writeJson(res, 200, {
            ok: true,
            target,
            pending: items.length,
            translated: pairs.length,
            updated: applied.updated,
            unmatched: applied.missing,
            ms: Date.now() - t0,
            errors,
            pairs: pairs.slice(0, 40),
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------ 翻译：整份文件（选文件 → 翻译 → 预览） */
    // POST { code, path, target:'zh'|'en', force?, dryRun?, maxChars? }
    //   → { ok, name, path, target, chars, truncated, segments:[{i,src,dst}], errors, ms, cached }
    // 同一个文件 + 同一个方向再点一次走缓存（不花 token）；要重译就 force:true。
    // dryRun:true 只切段不翻译 —— 给面板先看「这份文件多长、会切成几段」。
    {
      kind: 'exact',
      path: ROUTES.translateFile,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          if (!b.path) return writeJson(res, 400, { ok: false, error: 'path 必填' })

          const p = path.normalize(String(b.path))
          if (!underWorkspace(p)) return writeJson(res, 403, { ok: false, error: '只能翻 Workspace 里的文件' })
          if (!fs.existsSync(p)) return writeJson(res, 404, { ok: false, error: '文件不存在' })

          const target = b.target === 'en' ? 'en' : 'zh'
          const maxChars = Math.min(Math.max(Number(b.maxChars) || 12000, 500), 40000)
          const base = { name: path.basename(p), path: p, target }

          // 缓存：同文件同方向同上限，改过文件会自动换 key
          const key = transKey(p, target, maxChars)
          const cachePath = path.join(transCacheDir(b.code), key + '.json')
          if (!b.force && !b.dryRun) {
            try {
              const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
              if (cached && Array.isArray(cached.segments) && cached.segments.length) {
                return writeJson(res, 200, { ...cached, ok: true, cached: true })
              }
            } catch {}
          }

          const ex = await extractFile(b.code, p)
          if (!ex.ok) {
            return writeJson(res, 200, {
              ok: false, ...base,
              error: ex.error || 'extract-failed',
              detail: ex.detail || '抽不出文本（扫描版 PDF 要先 OCR，面板里做不了）',
            })
          }

          const split = splitSegments(ex.text, { maxChars })
          if (!split.segments.length) {
            return writeJson(res, 200, {
              ok: false, ...base,
              error: 'empty',
              detail: '这份文件抽不出文本（可能是扫描版，或者整页都是图）',
            })
          }
          const segs = split.segments.map((t, i) => ({ i, text: t }))

          if (b.dryRun) {
            return writeJson(res, 200, {
              ok: true, ...base, dryRun: true,
              chars: split.chars, total: split.total, truncated: split.truncated,
              segments: segs.map((s) => ({ i: s.i, src: s.text, dst: '' })),
            })
          }

          const ctrl = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ctrl.abort() })
          const t0 = Date.now()
          const { out, errors, batches } = await translateSegments(ctx, b.code, {
            segments: segs, target, signal: ctrl.signal, llm: llmNow(),
          })

          const payload = {
            ok: true,
            ...base,
            chars: split.chars,
            total: split.total,
            truncated: split.truncated,
            batches,
            at: new Date().toISOString(),
            ms: Date.now() - t0,
            errors,
            segments: segs.map((s) => ({ i: s.i, src: s.text, dst: out[s.i] || '' })),
          }
          try {
            fs.mkdirSync(path.dirname(cachePath), { recursive: true })
            fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8')
          } catch {}
          writeJson(res, 200, payload)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    // POST { code, path, target, segments:[{i,src,dst}] }
    //   → 写成 <CODE>/1_复习资料/<原名>_中英对照.md
    {
      kind: 'exact',
      path: ROUTES.translateFileSave,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const segs = Array.isArray(b.segments) ? b.segments : []
          if (!segs.length) return writeJson(res, 400, { ok: false, error: 'segments 是空的' })

          const target = b.target === 'en' ? 'en' : 'zh'
          const srcPath = String(b.path || 'note')
          const stem = path.basename(srcPath, path.extname(srcPath)) || 'note'
          const dir = reviewDirOf(b.code)
          fs.mkdirSync(dir, { recursive: true })
          const outName = `${stem}_中英对照.md`
          const outPath = path.join(dir, outName)

          const dirText = target === 'en' ? '中文 → English' : 'English → 中文'
          const L = [
            `# ${stem} · 中英对照`,
            '',
            `> 原文：\`${path.basename(srcPath)}\`　方向：${dirText}　生成：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
            '> 由 dsh-study-coach 生成；中文是讲解，英文是考场语言，两边对着看。',
            '',
            '---',
            '',
          ]
          for (const s of segs) {
            const src = String(s.src || '').trim()
            const dst = String(s.dst || '').trim()
            if (!src && !dst) continue
            L.push(`**[${String((Number(s.i) || 0) + 1).padStart(3, '0')}]**`, '')
            if (src) {
              for (const ln of src.split('\n')) L.push('> ' + ln)
              L.push('')
            }
            if (dst) {
              for (const ln of dst.split('\n')) L.push(ln)
              L.push('')
            }
            L.push('---', '')
          }
          fs.writeFileSync(outPath, L.join('\n'), 'utf8')
          writeJson(res, 200, { ok: true, path: outPath, name: outName, segments: segs.length })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* --------------------------------------- 流水线：能当原料的讲义 */
    // GET sources?code=  → 讲义分区里能抽文本的文件（pdf/docx/pptx/xlsx/txt/md）
    {
      kind: 'exact',
      path: ROUTES.sources,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const code = url.searchParams.get('code')
          if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const dir = resolveSectionDir(code, 'lecture')
          const files = dir ? listFiles(dir, code) : []
          const supported = files.filter((f) => EXTRACT_EXT.includes(f.ext))
          const skipped = files.filter((f) => !EXTRACT_EXT.includes(f.ext))
          writeJson(res, 200, {
            ok: true,
            dir,
            files: supported.map((f) => ({
              name: f.name, path: f.path, ext: f.ext,
              size: f.size, sizeText: f.sizeText, mtime: f.mtime,
              lecture: f.name.match(/(?:lec(?:ture)?|ch(?:apter)?|week)\s*(\d+)/i)
                ? 'Lec ' + f.name.match(/(?:lec(?:ture)?|ch(?:apter)?|week)\s*(\d+)/i)[1]
                : '',
            })),
            unsupported: skipped.map((f) => ({ name: f.name, ext: f.ext })),
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* --------------------------------------------- 流水线：开跑 */
    // POST { code, files: [...], want: {...} } → { jobId }，立刻返回
    {
      kind: 'exact',
      path: ROUTES.pipelineStart,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const files = (Array.isArray(b.files) ? b.files : []).filter((f) => underWorkspace(f))
          if (!files.length) {
            return writeJson(res, 400, { ok: false, error: '没有可用的讲义文件（要在 Workspace 里）' })
          }
          const pipeline = await import('./pipeline.js')
          const job = pipeline.startPipeline(
            { __runModel: (a) => runModel(ctx, { ...a, llm: llmNow() }), logger: ctx?.logger },
            { code: b.code, files, want: b.want || {}, seedTopics: b.seedTopics !== false, prefs: b.prefs },
          )
          writeJson(res, 200, { ok: true, jobId: job.id, total: job.progress.total })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* --------------------------------------------- 流水线：查进度 */
    {
      kind: 'exact',
      path: ROUTES.pipelineStatus,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const id = url.searchParams.get('id')
          if (!id) return writeJson(res, 400, { ok: false, error: 'id 必填' })
          const pipeline = await import('./pipeline.js')
          const job = pipeline.getJob(id)
          if (!job) {
            return writeJson(res, 404, {
              ok: false,
              error: '找不到这条任务记录（DSH 重启过就会丢）—— 如果刚才跑过，去「资料」页看 *_自动笔记.docx 在不在。',
            })
          }
          writeJson(res, 200, {
            ok: true,
            job: {
              id: job.id,
              code: job.code,
              state: job.state,
              step: job.step,
              progress: job.progress,
              logs: job.logs.slice(-60),
              out: job.out,
              errors: job.errors,
              ms: (job.finishedAt || Date.now()) - job.startedAt,
            },
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ---------------------------------------------------- 自检 */
    // GET health：这个环境到底能不能跑「问 / 翻译 / 一键生成」。
    // 出问题先看它，一眼知道是模型、SDK 还是 Python 断了。
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const llm = llmNow()
          let providers = []
          let models = []
          let selected = { provider: '', model: '' }
          const perProvider = []
          if (llm) {
            try {
              providers = (typeof llm.listProviders === 'function' ? llm.listProviders() : [])
                .map((p) => p.id || p.provider)
            } catch {}
            // 每个 provider 有几个模型 —— 哪个通道活着一眼看出来
            for (const id of providers) {
              let n = 0
              let first = ''
              let err = ''
              try {
                const ms = (await llm.listModels(id)) || []
                n = ms.length
                first = ms[0]?.id || ''
              } catch (e) {
                err = String((e && e.message) || e).slice(0, 100)
              }
              perProvider.push({ id, models: n, first, error: err })
              if (n > 0 && !selected.provider) {
                selected = { provider: id, model: first }
                models = [first]
              }
            }
          }
          const kit = await loadLlmKit()
          const caps = await pythonCaps()
          writeJson(res, 200, {
            ok: true,
            llm: {
              injected: !!llm,
              providers,
              perProvider,
              selected,
              pinned: process.env.DSH_STUDY_MODEL || '',
              model: selected.model,
            },
            sdk: { resolvable: !!kit },
            python: {
              path: caps.path, source: caps.source, version: caps.version,
              pdf: caps.pdf, docx: caps.docx, pptx: caps.pptx,
            },
            workspace: WORKSPACE,
            ready: {
              ask: !!llm && !!kit && !!selected.provider,
              translate: !!llm && !!kit && !!selected.provider,
              pipeline: !!llm && !!kit && !!caps.path && !!selected.provider,
              docx: !!caps.docx,
              pptx: !!caps.pptx,
            },
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ---------------------------------------------- 出卷：读版式缓存 */
    {
      kind: 'exact',
      path: ROUTES.paperTemplate,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const code = url.searchParams.get('code')
          if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const paper = await import('./paper.js')
          const tpl = paper.readTemplate(code)
          // 没有真卷也给出内置版式 —— 面板据此允许出卷，而不是把按钮锁死
          writeJson(res, 200, { ok: true, template: tpl || paper.BUILTIN_TEMPLATE, builtin: !tpl })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* -------------------------------------------- 出卷：解析真卷版式 */
    // POST { code, file }  —— 抽真卷 → 模型出骨架 → 存 paper-template.json
    // 这一步要一次模型调用（十几秒），所以同步返回，别让面板空等。
    {
      kind: 'exact',
      path: ROUTES.paperAnalyze,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          if (!b.file) return writeJson(res, 400, { ok: false, error: 'file 必填（选一份真卷）' })
          if (!underWorkspace(b.file)) {
            return writeJson(res, 403, { ok: false, error: '只能拿 Workspace 里的卷子当模板' })
          }
          const ctrl = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ctrl.abort() })
          const paper = await import('./paper.js')
          const r = await paper.analyzeTemplate(
            { __runModel: (a) => runModel(ctx, { ...a, llm: llmNow() }) },
            { code: b.code, file: b.file },
          )
          writeJson(res, r.ok ? 200 : 503, r)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 出卷：可选章节 */
    {
      kind: 'exact',
      path: ROUTES.paperScope,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const code = url.searchParams.get('code')
          if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const paper = await import('./paper.js')
          const options = paper.scopeOptions(code)
          // 顺手把试卷分区里能当模板的原件也带上，面板一个接口就够
          const dir = resolveSectionDir(code, 'exam')
          const files = (dir ? listFiles(dir, code) : [])
            .filter((f) => ['pdf', 'docx'].includes(f.ext))
            .map((f) => ({ name: f.name, path: f.path, ext: f.ext, size: f.size, sizeText: f.sizeText, mtime: f.mtime }))
          const tpl = paper.readTemplate(code)
          writeJson(res, 200, {
            ok: true,
            options,
            templates: files,
            current: tpl
              ? { sourceName: tpl.sourceName, analyzedAt: tpl.analyzedAt, sections: tpl.sections.map((s) => ({ name: s.name, questionCount: s.questionCount, marks: s.marks })) }
              : null,
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 出卷：开跑 */
    {
      kind: 'exact',
      path: ROUTES.paperGenerate,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const paper = await import('./paper.js')
          const job = paper.startPaper(
            { __runModel: (a) => runModel(ctx, { ...a, llm: llmNow() }), logger: ctx?.logger },
            {
              code: b.code,
              from: b.from ?? null,
              to: b.to ?? null,
              answers: b.answers !== false,
              pdf: b.pdf !== false,
              llm: llmNow(),
            },
          )
          writeJson(res, 200, { ok: true, jobId: job.id })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 卷子重排（不花模型） */
    // POST paper/rerender { code, file, want?:{docx,pdf,answers} }
    //   拿 .build/papers 里现成的 json 重新排 Word/PDF。
    //   排版代码改过之后用它刷成品 —— 题目和答案一个字不动，也不消耗模型额度。
    {
      kind: 'exact',
      path: ROUTES.paperRerender,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code || !b.file) return writeJson(res, 400, { ok: false, error: 'code / file 必填' })
          const buildRoot = path.join(dshHome(), 'study', String(b.code).toUpperCase(), '.build', 'papers')
          const jsonPath = path.join(buildRoot, path.basename(String(b.file)))
          if (!fs.existsSync(jsonPath)) {
            return writeJson(res, 404, { ok: false, error: '找不到这份卷子的 json：' + path.basename(String(b.file)) })
          }
          const paper = await import('./paper.js')
          const lines = []
          const r = await paper.rerenderPaper(b.code, {
            file: jsonPath,
            want: b.want && typeof b.want === 'object' ? b.want : {},
            log: (m) => lines.push(String(m)),
          })
          writeJson(res, 200, { ...r, log: lines })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 模型选择 */
    // GET  models        → 所有 provider 的模型 + 当前选择 + 哪个在冷却
    // POST models {provider, model} → 存进 model.json，立刻生效
    // POST models {reset:true}      → 清掉，回到自动挑
    {
      kind: 'exact',
      path: ROUTES.models,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const llm = llmNow()
            const pref = readModelPref()
            const groups = []
            if (llm) {
              let ids = []
              try {
                ids = (typeof llm.listProviders === 'function' ? llm.listProviders() : [])
                  .map((p) => p.id || p.provider).filter(Boolean)
              } catch {}
              for (const id of ids) {
                let models = []
                let err = ''
                try {
                  models = (await llm.listModels(id)) || []
                } catch (e) {
                  err = String((e && e.message) || e).slice(0, 100)
                }
                groups.push({
                  provider: id,
                  models: models.map((m) => m.id).filter(Boolean),
                  error: err,
                  bad: badChannels().some((b) => b.id === id),
                })
              }
            }
            return writeJson(res, 200, {
              ok: true,
              injected: !!llm,
              current: pref || null,
              pinned: process.env.DSH_STUDY_MODEL || '',
              // 推理等级：不是每个模型都支持，面板照样列出来，不支持时后端会自动退回
              efforts: [
                { id: '', label: '自动（推荐）' },
                { id: 'none', label: 'none' },
                { id: 'low', label: 'low' },
                { id: 'medium', label: 'medium' },
                { id: 'high', label: 'high' },
              ],
              groups,
              bad: badChannels(),
            })
          }

          if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
          const b = await readJson(req)
          if (b.reset) {
            clearModelPref()
            return writeJson(res, 200, { ok: true, current: null })
          }
          // 只改推理等级也行（provider/model 沿用现在的）
          const prev = readModelPref() || {}
          const provider = b.provider || prev.provider
          const model = b.model || prev.model
          if (!provider || !model) {
            return writeJson(res, 400, { ok: false, error: 'provider 和 model 都要给' })
          }
          const saved = writeModelPref({ provider, model, effort: b.effort ?? prev.effort ?? '' })
          writeJson(res, 200, { ok: true, current: saved })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 面板内预览 */
    // GET preview?path=&code=
    // PDF / 图片走 /file 直接内嵌（浏览器自己能看），这里只服务 docx / pptx / xlsx / 文本：
    // 抽成纯文本回给面板。为什么要文本：Electron 里没有 Office 渲染器，
    // docx 只能靠抽文本看内容 —— 比让人下载再用 Word 打开快得多。
    {
      kind: 'exact',
      path: ROUTES.preview,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const p = path.normalize(url.searchParams.get('path') || '')
          const code = url.searchParams.get('code')
            || (p.match(/[\\/]([A-Z]{2,4}\d{3,4})[\\/]/) || [])[1]
            || 'PREVIEW'
          if (!underWorkspace(p)) return writeJson(res, 403, { ok: false, error: '只能预览 Workspace 里的文件' })
          if (!fs.existsSync(p)) return writeJson(res, 404, { ok: false, error: '文件不存在' })

          const ext = path.extname(p).slice(1).toLowerCase()
          const st = fs.statSync(p)
          const base = {
            ok: true,
            name: path.basename(p),
            path: p,
            ext,
            size: st.size,
            sizeText: fmtSize(st.size),
            mtime: dayOf(st.mtimeMs),
            inline: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext),
          }

          if (base.inline) {
            return writeJson(res, 200, { ...base, kind: ext === 'pdf' ? 'pdf' : 'image' })
          }
          if (!EXTRACT_EXT.includes(ext)) {
            return writeJson(res, 200, {
              ...base,
              kind: 'binary',
              text: '',
              note: `这个类型（.${ext}）面板里看不了，点「另存」下载后用对应软件打开。`,
            })
          }

          const ex = await extractFile(code, p)
          if (!ex.ok) {
            return writeJson(res, 200, {
              ...base,
              kind: 'text',
              text: '',
              note: (ex.detail || ex.error || '抽不出文字') + '（可以点「另存」下载后用 Word 打开）',
            })
          }
          writeJson(res, 200, {
            ...base,
            kind: 'text',
            sourceKind: ex.kind,
            text: ex.text,
            chars: ex.chars,
            units: (ex.units || []).length,
            truncated: !!ex.truncated,
            note: ex.warning || '',
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 练习卷 / 交卷批改 */
    // GET  raw?path=   → 直接把图片 / PDF 的字节吐出来
    // preview 是「把内容包成 JSON 给面板」，图片没法当 <img src> 用；这个才是干那个的。
    // 只认 Workspace 里的图片和 pdf，别的一律不给。
    // POST paper-figures {code, file} → 把这份讲义 / 真卷里嵌的图抽出来
    //
    // 这个才是「别人的科目也能用」的关键：figure 只能表达顶点和边，
    // 别人考的是电路、化学结构、地图、财务报表 —— 模型一个字都描述不出来。
    // 但那些图本来就在老师发的 PDF / PPTX / DOCX 里，抽出来让人挑就行。
    {
      kind: 'exact',
      path: ROUTES.paperFigures,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code || !b.file) return writeJson(res, 400, { ok: false, error: 'code / file 必填' })
          if (!underWorkspace(b.file)) return writeJson(res, 400, { ok: false, error: '文件要在 Workspace 里' })
          if (!fs.existsSync(b.file)) return writeJson(res, 404, { ok: false, error: '找不到这份文件' })
          const py = await import('./python.js')
          const dir = path.join(dshHome(), 'study', String(b.code).toUpperCase(), 'figures')
          try { fs.mkdirSync(dir, { recursive: true }) } catch {}
          const r = await py.runScript('extract_images.py', [b.file, dir], { timeoutMs: 180000 })
          if (!r.ok) {
            return writeJson(res, 200, { ok: false, error: r.error, detail: r.detail || '' })
          }
          writeJson(res, 200, {
            ok: true,
            count: Number(r.count) || 0,
            images: Array.isArray(r.images) ? r.images : [],
            warning: r.warning || '',
            dir,
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.raw,
      handler: (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const p = path.normalize(url.searchParams.get('path') || '')
          if (!p) return writeJson(res, 400, { ok: false, error: 'path 必填' })
          if (!underWorkspace(p)) return writeJson(res, 403, { ok: false, error: '只能读 Workspace 里的文件' })
          if (!fs.existsSync(p)) return writeJson(res, 404, { ok: false, error: '文件不存在' })
          const MIME = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
            webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', pdf: 'application/pdf',
          }
          const mime = MIME[path.extname(p).slice(1).toLowerCase()]
          if (!mime) return writeJson(res, 400, { ok: false, error: '这个类型不直接给' })
          const buf = fs.readFileSync(p)
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': buf.length,
            'Cache-Control': 'no-store',
          })
          res.end(buf)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    // GET  papers?code=      → 列出可批改的练习卷（出卷时落的 .json）
    // POST grade {code, paper, answers:{A1:"...",A2:"..."}} → 逐题判分 + 讲错
    {
      kind: 'exact',
      path: ROUTES.papers,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const code = url.searchParams.get('code')
          if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const g = await import('./grade.js')
          const papers = g.listPapers(code)
          // 带一份题目清单，面板能直接渲染作答框
          let detail = null
          const want = url.searchParams.get('paper')
          if (want) {
            const hit = papers.find((p) => p.path === want || p.name === want)
            if (hit) {
              const j = JSON.parse(fs.readFileSync(hit.path, 'utf8'))
              detail = { paper: hit, items: g.flattenPaper(j) }
            }
          }
          writeJson(res, 200, { ok: true, papers, detail })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    // GET  paper-images?code=&paper=       → 这份卷子每题的配图 + 科目里的图片库
    // POST paper-images {code, paper, no, path} → 给某一题挂图（path 空 = 摘掉）
    //
    // 为什么要有：有些题离开图做不了（"下图是一个加权图…"、"根据下面真值表…"）。
    // 模型出不了图，所以留个地方让主人自己挂：哪一题、配哪张。
    {
      kind: 'exact',
      path: ROUTES.paperImages,
      handler: async (req, res) => {
        try {
          const core = await import('./core.js')
          const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

          if (req.method === 'GET') {
            const url = new URL(req.url ?? '/', 'http://x')
            const code = url.searchParams.get('code')
            if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
            const paper = url.searchParams.get('paper') || ''
            const all = core.readPaperImages(code)
            const want = paper ? path.basename(paper) + '::' : ''
            const images = {}
            if (want) {
              for (const [k, v] of Object.entries(all)) {
                if (k.startsWith(want)) images[k.slice(want.length)] = v
              }
            }
            // 图片库：科目目录下能当题目配图的文件
            const root = path.join(WORKSPACE, String(code).toUpperCase())
            const library = []
            const walk = (dir, depth) => {
              if (depth > 4 || library.length >= 200) return
              let ents = []
              try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
              for (const e of ents) {
                if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
                const full = path.join(dir, e.name)
                if (e.isDirectory()) {
                  // `_build` 里有复习用的图（figs/graph_A3.png 之类），别一律跳过；
                  // 只躲开这些一眼就不是资料的目录。
                  if (['node_modules', '.git', '__pycache__', '.venv', '_share'].includes(e.name)) continue
                  walk(full, depth + 1)
                  continue
                }
                const ext = path.extname(e.name).slice(1).toLowerCase()
                if (!IMG_EXT.has(ext)) continue
                try {
                  const st = fs.statSync(full)
                  library.push({
                    name: e.name,
                    rel: path.relative(root, full).replace(/\\/g, '/'),
                    path: full,
                    ext,
                    sizeText: fmtSize(st.size),
                    mtime: dayOf(st.mtimeMs),
                  })
                } catch {}
              }
            }
            walk(root, 0)
            // 从讲义/真卷里抽出来的图也一起列（存在 ~/.dsh/study/<CODE>/figures/）
            try {
              const figsDir = path.join(dshHome(), 'study', String(code).toUpperCase(), 'figures')
              for (const e of fs.readdirSync(figsDir, { withFileTypes: true })) {
                if (!e.isFile()) continue
                const ext = path.extname(e.name).slice(1).toLowerCase()
                if (!IMG_EXT.has(ext)) continue
                const full = path.join(figsDir, e.name)
                const st = fs.statSync(full)
                library.push({
                  name: e.name,
                  rel: '资料里抽出来的 / ' + e.name,
                  path: full,
                  ext,
                  sizeText: fmtSize(st.size),
                  mtime: dayOf(st.mtimeMs),
                  extracted: true,
                })
              }
            } catch {}
            library.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
            writeJson(res, 200, { ok: true, images, library })
            return
          }

          if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
          const b = await readJson(req)
          if (!b.code || !b.paper || !b.no) {
            return writeJson(res, 400, { ok: false, error: 'code / paper / no 都必填' })
          }
          let img = String(b.path || '').trim()
          if (img) {
            if (!underWorkspace(img)) {
              return writeJson(res, 400, { ok: false, error: '图片要在 Workspace 里' })
            }
            if (!fs.existsSync(img)) return writeJson(res, 404, { ok: false, error: '找不到这张图' })
            const ext = path.extname(img).slice(1).toLowerCase()
            if (!IMG_EXT.has(ext)) {
              return writeJson(res, 400, { ok: false, error: `这个类型（.${ext}）不是图片` })
            }
          }
          const all = core.setPaperImage(b.code, path.basename(String(b.paper)), String(b.no), img)
          const want = path.basename(String(b.paper)) + '::'
          const images = {}
          for (const [k, v] of Object.entries(all)) {
            if (k.startsWith(want)) images[k.slice(want.length)] = v
          }
          writeJson(res, 200, { ok: true, images })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.grade,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.paper) return writeJson(res, 400, { ok: false, error: 'paper 必填（选一份练习卷）' })
          // 卷子的 .json 现在落 $DSH_HOME/study/<CODE>/.build/papers/（中间格式不进资料库），
          // 老的还在 3_练习题 里 —— 两处都允许，其他一律拒绝。
          const buildRoot = path.join(dshHome(), 'study')
          const inBuild = path.normalize(String(b.paper)).startsWith(path.normalize(buildRoot))
          if (!underWorkspace(b.paper) && !inBuild) {
            return writeJson(res, 403, { ok: false, error: '只能批改资源库自己的练习卷' })
          }
          if (!String(b.paper).toLowerCase().endsWith('.json')) {
            return writeJson(res, 400, { ok: false, error: '只接受练习卷的 json 数据文件' })
          }
          if (!fs.existsSync(b.paper)) return writeJson(res, 404, { ok: false, error: '找不到这份卷子' })

          const g = await import('./grade.js')
          const paper = JSON.parse(fs.readFileSync(b.paper, 'utf8'))
          const items = g.flattenPaper(paper)
          if (!items.length) return writeJson(res, 400, { ok: false, error: '这份卷子里没有题目' })

          const answers = (b.answers && typeof b.answers === 'object') ? b.answers : {}
          const answered = Object.values(answers).filter((v) => String(v || '').trim()).length
          if (!answered) return writeJson(res, 400, { ok: false, error: '一个答案都没填，先写点东西再交' })

          const ctrl = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ctrl.abort() })
          const t0 = Date.now()
          const r = await g.gradePaper(
            { __runModel: (a) => runModel(ctx, { ...a, llm: llmNow() }) },
            { items, answers },
          )
          writeJson(res, 200, {
            ...r,
            paper: path.basename(b.paper),
            answered,
            total_questions: items.length,
            ms: Date.now() - t0,
          })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 用系统程序打开原文件 */
    // POST open { path, reveal?: true }
    //   reveal=false（默认）→ 用默认程序打开（Word / PowerPoint / PDF 阅读器）
    //   reveal=true         → 在文件管理器里定位并选中这个文件
    //
    // 为什么要在服务端做：Electron 的渲染进程不能从 http 页面跳转 file://，
    // 想「真的用 Word 打开」只能由主进程这一侧去唤起系统程序。
    // 路径一律锁在 WORKSPACE 内，越界直接 403。
    {
      kind: 'exact',
      path: ROUTES.open,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          const raw = String(b.path || '').trim()
          if (!raw) return writeJson(res, 400, { ok: false, error: 'path 必填' })
          const p = path.normalize(raw)
          if (!underWorkspace(p)) return writeJson(res, 403, { ok: false, error: '只能打开 Workspace 里的文件' })
          if (!fs.existsSync(p)) return writeJson(res, 404, { ok: false, error: '文件不存在：' + path.basename(p) })

          const reveal = !!b.reveal
          const { spawn } = await import('node:child_process')
          const fire = (cmd, args) => {
            const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false })
            child.unref()
          }

          if (process.platform === 'win32') {
            if (reveal) {
              // explorer /select,"路径" —— 打开文件夹并选中
              fire('explorer.exe', ['/select,', p])
            } else {
              // 用 cmd 的 start 走 shell 关联；第一个空参数是窗口标题占位
              fire('cmd.exe', ['/c', 'start', '', p])
            }
          } else if (process.platform === 'darwin') {
            fire('open', reveal ? ['-R', p] : [p])
          } else {
            fire('xdg-open', reveal ? [path.dirname(p)] : [p])
          }
          writeJson(res, 200, { ok: true, path: p, reveal })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 静态图（收款码 / 截图） */
    // GET asset?name=payme.png
    // 只从 assets/ 读、只认图片扩展名，挡掉 ../ 和绝对路径。
    // 面板里的「支持作者」用它显示收款码；图不在就 404，前端把 <img> 藏掉。
    {
      kind: 'exact',
      path: ROUTES.asset,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        const url = new URL(req.url ?? '/', 'http://x')
        const name = String(url.searchParams.get('name') || '')
        const safe = /^[A-Za-z0-9._-]+\.(png|jpe?g|svg|webp|gif)$/.test(name)
          && !name.includes('..')
          && !name.startsWith('.')
        if (!safe) return writeJson(res, 400, { ok: false, error: 'bad name' })
        try {
          const buf = fs.readFileSync(path.join(ASSETS_DIR, name))
          const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
          const mime = ext === 'png' ? 'image/png'
            : ext === 'svg' ? 'image/svg+xml'
              : ext === 'webp' ? 'image/webp'
                : ext === 'gif' ? 'image/gif' : 'image/jpeg'
          res.statusCode = 200
          res.setHeader('Content-Type', mime)
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end(buf)
        } catch {
          res.statusCode = 404
          res.end('not found')
        }
      },
    },

    /* ------------------------------------------------ 题卡导出 CSV */
    // GET cards.csv?code=COMP2011
    // 带 BOM，Excel / WPS 双击打开中文不乱码；列名固定，方便再导进 Anki。
    {
      kind: 'exact',
      path: ROUTES.cardsCsv,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const code = String(url.searchParams.get('code') || '').toUpperCase()
          if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const topics = readTopics(code).topics || []
          const lectureOf = new Map(topics.map((t) => [t.key, t.lecture || '']))
          const cards = readCards(code).cards || []
          const esc = (v) => {
            const s = String(v == null ? '' : v)
            return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
          }
          const rows = [['topicKey', 'lecture', 'question', 'answer', 'marks', 'source']]
          for (const c of cards) {
            rows.push([
              c.topicKey || '', lectureOf.get(c.topicKey) || '',
              c.question || '', c.answer || '', c.marks ?? '', c.source || '',
            ])
          }
          // \uFEFF 是给 Excel 认 UTF-8 用的，少了它中文全变问号
          const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/csv; charset=utf-8')
          res.setHeader('Content-Disposition', `attachment; filename="${code}_cards.csv"`)
          res.end(csv)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 备份 / 恢复 */
    // GET  backup   → 一个 JSON：所有科目的 topics/cards/generated/attempts + 全局 prefs
    // POST restore  → 写回去；写之前把当前文件先复制进 study/.backup-<ts>/
    {
      kind: 'exact',
      path: ROUTES.backup,
      handler: async (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
        try {
          const files = {}
          const subs = listSubjects()
          for (const s of subs) {
            const dir = subjectDir(s.code)
            for (const f of BACKUP_FILES) {
              try {
                files[`${s.code}/${f}`] = fs.readFileSync(path.join(dir, f), 'utf8')
              } catch {}
            }
          }
          let prefs = ''
          try { prefs = fs.readFileSync(path.join(studyRoot(), 'prefs.json'), 'utf8') } catch {}
          const payload = {
            format: 'dsh-study-coach-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            subjects: subs,
            prefs,
            files,
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Content-Disposition', `attachment; filename="dsh-study-coach-backup-${today()}.json"`)
          res.end(JSON.stringify(payload, null, 2))
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.restore,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          const data = b && b.backup ? b.backup : b
          if (!data || data.format !== 'dsh-study-coach-backup') {
            return writeJson(res, 400, { ok: false, error: '这不是本插件导出的备份文件' })
          }
          const files = data.files && typeof data.files === 'object' ? data.files : {}
          const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
          const trash = path.join(studyRoot(), '.backup-' + stamp)
          let restored = 0
          for (const [rel, text] of Object.entries(files)) {
            const [code, name] = String(rel).split('/')
            if (!/^[A-Za-z0-9_-]{1,32}$/.test(code || '')) continue
            if (!BACKUP_FILES.includes(name)) continue
            const dir = subjectDir(code)
            const dst = path.join(dir, name)
            // 先留一份现场再覆盖：恢复错了还能从 .backup-<ts> 捞回来
            if (fs.existsSync(dst)) {
              try {
                fs.mkdirSync(path.join(trash, code), { recursive: true })
                fs.copyFileSync(dst, path.join(trash, code, name))
              } catch {}
            }
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(dst, String(text), 'utf8')
            restored++
          }
          if (data.prefs) {
            try { fs.writeFileSync(path.join(studyRoot(), 'prefs.json'), String(data.prefs), 'utf8') } catch {}
          }
          writeJson(res, 200, { ok: true, restored, total: Object.keys(files).length })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 笔记清单（可编辑） */
    // GET  notes?code=                     → { list:[{path,name,origin,reason}], candidates:[...] }
    // POST notes { code, path, action }    → action: add | remove | auto
    // 让用户自己决定「哪些算笔记」，并且每条都说明它为什么在列表里。
    {
      kind: 'exact',
      path: ROUTES.notes,
      handler: async (req, res) => {
        try {
          const notesMod = await import('./notes.js')
          if (req.method === 'GET') {
            const url = new URL(req.url ?? '/', 'http://x')
            const code = url.searchParams.get('code')
            if (!code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
            const subj = buildTree().subjects.find(
              (s) => String(s.code).toUpperCase() === String(code).toUpperCase(),
            )
            if (!subj) return writeJson(res, 404, { ok: false, error: '没有这个科目' })
            const cfg = notesMod.readNotesCfg(code)
            const { list, candidates } = notesMod.classifyNotes(subj, cfg)
            return writeJson(res, 200, { ok: true, list, candidates, cfgPath: notesMod.notesCfgPath(code) })
          }

          if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          if (!b.path) return writeJson(res, 400, { ok: false, error: 'path 必填' })
          const action = ['add', 'remove', 'auto'].includes(b.action) ? b.action : 'auto'
          notesMod.setNoteFlag(b.code, { filePath: b.path, action })

          // 改完立刻回一份最新的，前端不用再请求一次
          const subj = buildTree().subjects.find(
            (s) => String(s.code).toUpperCase() === String(b.code).toUpperCase(),
          )
          const cfg = notesMod.readNotesCfg(b.code)
          const { list, candidates } = subj
            ? notesMod.classifyNotes(subj, cfg)
            : { list: [], candidates: [] }
          writeJson(res, 200, { ok: true, action, list, candidates })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 生成偏好 */
    // GET  prefs                    → { prefs, schema }  面板照着 schema 渲染选项
    // POST prefs { diagram, ... }   → 只改传进来的字段，其余保持不变
    {
      kind: 'exact',
      path: ROUTES.prefs,
      handler: async (req, res) => {
        try {
          const prefsMod = await import('./prefs.js')
          if (req.method === 'GET') {
            return writeJson(res, 200, {
              ok: true,
              prefs: prefsMod.readPrefs(),
              schema: prefsMod.PREFS_SCHEMA,
              defaults: prefsMod.DEFAULT_PREFS,
            })
          }
          if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
          const b = await readJson(req)
          const next = prefsMod.writePrefs(b || {})
          writeJson(res, 200, { ok: true, prefs: next })
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* ------------------------------------------------ 做题：选择题形态 */
    // POST quiz { code, cardId }  → { mcq: { stem, options[], answerId, why, trap } }
    // 第一次会问模型把题改造成单选（带干扰项），之后读 cards.json 的缓存。
    // 为什么要选择题：数学题在输入框里打公式基本没法用，点按钮才做得下去。
    {
      kind: 'exact',
      path: ROUTES.quiz,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          if (!b.cardId) return writeJson(res, 400, { ok: false, error: 'cardId 必填' })
          const card = readCards(b.code).cards.find((c) => c.id === b.cardId)
          if (!card) return writeJson(res, 404, { ok: false, error: '找不到这张题卡' })
          const ctrl = new AbortController()
          res.on('close', () => { if (!res.writableEnded) ctrl.abort() })
          const r = await buildQuiz(
            { __runModel: (a) => runModel(ctx, { ...a, llm: llmNow() }) },
            { code: b.code, card, llm: llmNow() },
          )
          writeJson(res, r.ok ? 200 : 503, r)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },

    /* --------------------------------------------- 流水线：只重排文档 */    // POST { code, kinds: ['docx','pptx'] }：用现成的知识点重出 Word/PPT
    {
      kind: 'exact',
      path: ROUTES.pipelineRender,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false })
        try {
          const b = await readJson(req)
          if (!b.code) return writeJson(res, 400, { ok: false, error: 'code 必填' })
          const pipeline = await import('./pipeline.js')
          const r = await pipeline.renderDocs(b.code, { kinds: b.kinds || ['docx', 'pptx'], scope: b.scope || '' })
          writeJson(res, 200, r)
        } catch (e) {
          log(e); fail(res, e)
        }
      },
    },
    // 用量统计（放在最后：它是聚合查询，跟具体业务无关）
    usageRoute(),
  ]
}

// 用量统计接口：只统计本插件发起的调用（翻译 / 生成 / 出卷 / 批改 / 问）
export function usageRoute() {
  return {
    kind: 'exact',
    path: ROUTES.usage,
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false })
      try {
        const url = new URL(req.url ?? '/', 'http://x')
        const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))
        const price = Number(url.searchParams.get('price')) || 0
        writeJson(res, 200, summarizeUsage({ days, pricePerMTok: price }))
      } catch (e) {
        writeJson(res, 500, { ok: false, error: String((e && e.message) || e) })
      }
    },
  }
}
