/**
 * dsh-study-coach / notes.js
 *
 * 「哪些文件算笔记」这件事，以前是暗规则：
 *   扩展名 ∈ md/docx/pdf/html/txt，且（名字命中 笔记/note/手册/总结… 或 来源是 DSH 生成）
 *
 * 问题：用户看不懂为什么某个文件在列表里、也改不了。
 * 现在改成三层，**每条都告诉用户它为什么在这**：
 *
 *   1. 手动加入（include）  → 一定在，标「手动」
 *   2. 手动移除（exclude）  → 一定不在（优先级高于规则，所以能纠正误判）
 *   3. 自动规则            → 标「名字含笔记」「DSH 生成」
 *
 * 存 $DSH_HOME/study/<CODE>/notes.json
 *   { "include": { "<绝对路径>": {...} }, "exclude": { "<绝对路径>": {...} } }
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function key(p) {
  return path.normalize(String(p || '')).replace(/\\/g, '/').toLowerCase()
}

export function notesCfgPath(code) {
  return path.join(dshHome(), 'study', String(code).toUpperCase(), 'notes.json')
}

export function readNotesCfg(code) {
  try {
    const j = JSON.parse(fs.readFileSync(notesCfgPath(code), 'utf8'))
    return { include: (j && j.include) || {}, exclude: (j && j.exclude) || {} }
  } catch {
    return { include: {}, exclude: {} }
  }
}

export function writeNotesCfg(code, cfg) {
  const p = notesCfgPath(code)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ include: cfg.include || {}, exclude: cfg.exclude || {} }, null, 2) + '\n', 'utf8')
  return cfg
}

/** 增删一条。action: 'add' | 'remove' | 'auto'（清除手动设置，回到规则判定） */
export function setNoteFlag(code, { filePath, action }) {
  const k = key(filePath)
  if (!k) throw new Error('filePath 必填')
  const cfg = readNotesCfg(code)
  delete cfg.include[k]
  delete cfg.exclude[k]
  const at = new Date().toISOString()
  if (action === 'add') cfg.include[k] = { at }
  else if (action === 'remove') cfg.exclude[k] = { at }
  writeNotesCfg(code, cfg)
  return cfg
}

/** 哪些扩展名可能是笔记 */
export const NOTE_EXTS = ['md', 'docx', 'pdf', 'html', 'txt']

/** 名字像笔记的关键词 */
export const NOTE_NAME_RE = /笔记|note|手册|总结|提纲|速记|精讲|cheatsheet|summary/i

/**
 * 算出「笔记页要显示哪些文件」，并给每一条打上原因。
 * @param subject tree 里的那个科目对象
 * @param cfg     readNotesCfg() 的结果
 * @returns { list, candidates }
 *   list       = 已纳入笔记的（带 origin / reason）
 *   candidates = 可以手动加入的（同类扩展名、但当前不在列表里）
 */
export function classifyNotes(subject, cfg) {
  const include = (cfg && cfg.include) || {}
  const exclude = (cfg && cfg.exclude) || {}
  const list = []
  const candidates = []

  const sections = (subject && subject.sections) || {}
  for (const [secKey, box] of Object.entries(sections)) {
    for (const f of (box.files || [])) {
      if (!NOTE_EXTS.includes(f.ext)) continue
      const k = key(f.path)
      const item = { ...f, sectionKey: secKey, cfgKey: k }

      // ① 手动排除最优先 —— 用来纠正规则误判
      if (exclude[k]) {
        candidates.push({ ...item, why: '被手动移除' })
        continue
      }
      // ② 手动加入
      if (include[k]) {
        list.push({ ...item, origin: 'manual', reason: '手动加入' })
        continue
      }
      // ③ 自动规则
      if (NOTE_NAME_RE.test(f.name)) {
        list.push({ ...item, origin: 'name', reason: '名字含「笔记 / 手册 / 总结」这类词' })
        continue
      }
      if (f.origin === 'generated') {
        list.push({ ...item, origin: 'generated', reason: 'DSH 生成的文件' })
        continue
      }
      candidates.push({ ...item, why: '没命中规则' })
    }
  }

  // 排序：手动的排最前，然后真·笔记，最后按时间新到旧
  const rank = { manual: 0, name: 1, generated: 2 }
  list.sort((a, b) => {
    const ra = rank[a.origin] ?? 9
    const rb = rank[b.origin] ?? 9
    if (ra !== rb) return ra - rb
    return String(b.mtime).localeCompare(String(a.mtime))
  })
  candidates.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
  return { list, candidates }
}
