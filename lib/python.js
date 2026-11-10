/**
 * dsh-study-coach / python.js
 *
 * 找得到一个能用的 Python，并跑插件自带的 scripts/*.py。
 *
 * 为什么不用 node 做这些事：
 *   - PDF 抽文字（含中文）现写不现实，PyMuPDF 已经在 DSH 自带运行时里了
 *   - docx / pptx 的读写，python-docx / python-pptx 一个函数就完事，
 *     node 侧手搓 OOXML 只会写出打不开的文件
 *
 * 定位顺序（第一个能跑就行）：
 *   1. env DSH_STUDY_PYTHON
 *   2. $DSH_HOME/dsh-runtimes/<任意>/dependencies/python/python.exe
 *   3. PATH 里的 python / python3
 *
 * 全程 spawn + 参数数组，不经 shell —— 路径里带空格、中文都不会翻车。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SCRIPTS = path.join(HERE, '..', 'scripts')

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** DSH 运行时可能挂在 DSH_HOME 下，也可能挂在家目录的 .dsh 下 —— 都找 */
function runtimeHomes() {
  const out = [dshHome(), path.join(os.homedir(), '.dsh')]
  return [...new Set(out.map((p) => path.normalize(p)))]
}

/** 在 dsh-runtimes 下找解释器（DSH 每次升级目录名会变，所以是通配） */
function findRuntimePythons() {
  const hits = []
  // Windows 是 python/python.exe；POSIX 装在 <root>/python/bin/python3
  const rels = process.platform === 'win32'
    ? [['python', 'python.exe'], ['python', 'python3.exe'], ['python3', 'python3.exe']]
    : [['python', 'bin', 'python3'], ['python', 'bin', 'python'], ['python3', 'bin', 'python3']]

  for (const home of runtimeHomes()) {
    const base = path.join(home, 'dsh-runtimes')
    let dirs = []
    try {
      dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      continue
    }
    for (const d of dirs) {
      for (const rel of rels) {
        const p = path.join(base, d.name, 'dependencies', ...rel)
        try {
          if (fs.existsSync(p) && !hits.includes(p)) hits.push(p)
        } catch {}
      }
    }
  }
  return hits
}

let _py
/** 候选列表：[{ path, source }]，按优先级排好 */
export function findPython() {
  if (_py !== undefined) return _py
  const cands = []
  if (process.env.DSH_STUDY_PYTHON) cands.push({ path: process.env.DSH_STUDY_PYTHON, source: 'env' })
  for (const p of findRuntimePythons()) cands.push({ path: p, source: 'dsh-runtime' })
  // PATH 兜底：POSIX 上 python 常常不存在，只有 python3
  if (process.platform === 'win32') {
    cands.push({ path: 'python', source: 'path' })
    cands.push({ path: 'py', source: 'path' })
  } else {
    cands.push({ path: 'python3', source: 'path' })
    cands.push({ path: 'python', source: 'path' })
  }
  _py = cands
  return _py
}

/** 跑一段 python -c，拿 stdout（超时杀） */
function runPython(exe, args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(exe, args, { windowsHide: true })
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message) })
      return
    }
    const out = []
    const err = []
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
    }, timeoutMs)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(e && e.message) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      })
    })
  })
}

let _caps
/**
 * 探测这个 python 有哪些能力。
 *
 * 关键点：**不能只取「第一个能跑的」**。系统 PATH 里的 python 往往是裸装，
 * 没 pymupdf / python-docx；而 DSH 运行时里那个是齐的。所以全部候选都探一遍，
 * 按「能干的活最多」排序取最优。一次探测缓存整进程。
 */
export async function pythonCaps() {
  if (_caps !== undefined) return _caps
  const probe = [
    'import json,sys',
    'caps={}',
    'for name,mod in [("pdf","pymupdf"),("docx","docx"),("pptx","pptx"),("xlsx","openpyxl")]:',
    '    try:',
    '        __import__(mod); caps[name]=True',
    '    except Exception: caps[name]=False',
    'caps["version"]=sys.version.split()[0]',
    'print(json.dumps(caps))',
  ].join('\n')

  let best = null
  let fallback = null
  for (const cand of findPython()) {
    const r = await runPython(cand.path, ['-c', probe], { timeoutMs: 20000 })
    if (!r.ok) continue
    let j = null
    try {
      j = JSON.parse(r.stdout.trim().split('\n').pop())
    } catch {
      continue
    }
    const caps = { ...j, path: cand.path, source: cand.source }
    const score = (caps.pdf ? 1 : 0) + (caps.docx ? 1 : 0) + (caps.pptx ? 1 : 0) + (caps.xlsx ? 1 : 0)
    caps.score = score
    if (!fallback) fallback = caps
    if (!best || score > best.score) best = caps
    if (score === 4) break // 全都有，不用再找了
  }

  _caps = best && best.score > 0 ? best : (fallback || {
    pdf: false, docx: false, pptx: false, xlsx: false,
    path: '', source: 'none', version: '', score: 0,
  })
  return _caps
}

/** 跑 scripts/<name>.py，把它的 stdout 当 JSON 解。脚本自己保证输出 JSON。 */
export async function runScript(name, args, { timeoutMs = 120000 } = {}) {
  const caps = await pythonCaps()
  if (!caps.path) {
    return { ok: false, error: 'no-python', detail: '这台机器找不到可用的 Python（也没在 DSH 运行时里找到）' }
  }
  const script = path.join(SCRIPTS, name)
  if (!fs.existsSync(script)) {
    return { ok: false, error: 'no-script', detail: '缺脚本 ' + script }
  }
  const r = await runPython(caps.path, [script, ...args], { timeoutMs })
  const text = (r.stdout || '').trim()
  if (!text) {
    return {
      ok: false,
      error: 'empty-output',
      detail: (r.stderr || '').slice(-600) || `python 退出码 ${r.code}`,
    }
  }
  try {
    return JSON.parse(text.split('\n').pop())
  } catch {
    return { ok: false, error: 'bad-json', detail: text.slice(-600) }
  }
}

/** 给外部用：这个 python 能不能干这类活 */
export function canDo(caps, kind) {
  if (!caps || !caps.path) return false
  if (kind === 'pdf') return !!caps.pdf
  if (kind === 'docx') return !!caps.docx
  if (kind === 'pptx') return !!caps.pptx
  return true
}
