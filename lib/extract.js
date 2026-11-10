/**
 * dsh-study-coach / extract.js
 *
 * 把讲义变成纯文本，带缓存。
 *
 * 为什么缓存：一份 PDF 抽一次几百毫秒到几秒，但流水线可能反复跑
 * （先出笔记、再出 PPT、再补翻译）。缓存键 = 路径 + 大小 + mtime，
 * 文件一改就自动失效，不需要手动清。
 *
 * 缓存在 $DSH_HOME/study/<CODE>/extract/<sha1>.json
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { runScript, pythonCaps, canDo } from './python.js'

export const EXTRACT_EXT = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'csv']

export function isExtractable(p) {
  return EXTRACT_EXT.includes(path.extname(String(p)).slice(1).toLowerCase())
}

function cacheDir(code) {
  return path.join(
    process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    'study', String(code).toUpperCase(), 'extract',
  )
}

function cacheKey(file) {
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return null
  }
  return crypto.createHash('sha1')
    .update(String(file) + '|' + st.size + '|' + Math.round(st.mtimeMs))
    .digest('hex')
}

/**
 * 抽一个文件。
 * 返回 { ok, kind, text, units, chars, warning, cached, error }
 */
export async function extractFile(code, file) {
  if (!isExtractable(file)) {
    return { ok: false, error: 'unsupported', detail: `这个类型抽不了文本：${path.extname(file)}` }
  }

  const caps = await pythonCaps()
  const ext = path.extname(file).slice(1).toLowerCase()
  const needKind = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : ext === 'pptx' ? 'pptx' : null
  if (needKind && !canDo(caps, needKind)) {
    return {
      ok: false,
      error: 'no-library',
      detail: `这个 Python 没装 ${needKind === 'pdf' ? 'PyMuPDF' : needKind === 'docx' ? 'python-docx' : 'python-pptx'}`,
    }
  }

  const key = cacheKey(file)
  const dir = cacheDir(code)
  const cachePath = key ? path.join(dir, key + '.json') : null

  if (cachePath && fs.existsSync(cachePath)) {
    try {
      const hit = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      return { ...hit, cached: true }
    } catch {}
  }

  const r = await runScript('extract.py', [file], { timeoutMs: 120000 })
  if (!r.ok) {
    return { ok: false, error: r.error, detail: r.detail, name: path.basename(file) }
  }

  const text = (r.units || []).map((u) => u.text).join('\n\n')
  const result = {
    ok: true,
    file,
    name: r.name || path.basename(file),
    kind: r.kind,
    units: r.units || [],
    text,
    chars: text.length,
    truncated: !!r.truncated,
    warning: r.warning || '',
    cached: false,
  }

  if (cachePath) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(cachePath, JSON.stringify(result), 'utf8')
    } catch {}
  }
  return result
}

/**
 * 批量抽。按顺序跑（PDF 解析吃 CPU，并发反而慢），单个失败不中断。
 * 返回 { ok, okCount, failed: [...], texts: [{file, name, text, units, kind}] }
 */
export async function extractMany(code, files, onProgress) {
  const texts = []
  const failed = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const r = await extractFile(code, f)
    if (r.ok && r.text && r.text.trim()) {
      texts.push({ file: f, name: r.name, text: r.text, units: r.units, kind: r.kind, chars: r.chars })
    } else {
      failed.push({
        file: f,
        name: path.basename(f),
        error: r.error,
        detail: r.detail || r.warning || '',
      })
    }
    try {
      onProgress && onProgress(i + 1, files.length, path.basename(f))
    } catch {}
  }
  return { ok: true, okCount: texts.length, failed, texts }
}

/** 从文件名里抠「Lec 6」这种标签，用来分组和命名产物 */
export function lectureTag(file) {
  const base = path.basename(String(file))
  const m = /(?:lec(?:ture)?\s*|ch(?:apter)?\s*|week\s*)(\d+)/i.exec(base)
  if (m) return 'Lec ' + m[1]
  return ''
}

/** 给产物起名用的范围标签：Lec6-10 / 全部 */
export function scopeLabel(files) {
  const nums = []
  for (const f of files) {
    const t = lectureTag(f)
    const m = /(\d+)/.exec(t)
    if (m) nums.push(Number(m[1]))
  }
  if (!nums.length) return '全部'
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  return lo === hi ? `Lec${lo}` : `Lec${lo}-${hi}`
}
