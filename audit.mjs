#!/usr/bin/env node
/**
 * dsh-study-coach / audit.mjs
 *
 * 跨平台适配审计。回答一个问题：**把插件拷到 Windows / macOS / Linux 上，会不会有东西悄悄不工作。**
 *
 *   node audit.mjs
 *
 * 查什么：
 *   1. 硬编码盘符（C:\...）—— 换机器必挂
 *   2. `.exe` / PowerShell / explorer 这类 Windows 专属命令，是不是只在 win32 分支里
 *   3. 路径拼接有没有绕开 path.join（手写 '\\' 或 '/'）
 *   4. Python 脚本有没有平台专属 import、有没有 BOM、有没有 shebang 问题
 *   5. 运行时探测（python 能力 / PDF 引擎 / 字体方案）
 *   6. package.json 的 os / engines 声明
 *
 * 退出码 0 = 没发现硬伤（不代表每台机器功能都全，缺的会在运行时给出明确提示）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.join(here, 'lib')
const SCRIPTS = path.join(here, 'scripts')

const problems = []
const warns = []
const notes = []

function bad(msg) { problems.push(msg) }
function warn(msg) { warns.push(msg) }
function note(msg) { notes.push(msg) }

/* ---------------------------------------------------- 1. 硬编码盘符 */
// 判定要点：**在 win32 分支里的盘符是有意兜底，不算硬伤**。
// 真正危险的是全局作用域、或 POSIX 分支里出现的盘符字面量。
const libFiles = fs.readdirSync(LIB).filter((f) => f.endsWith('.js'))
const driveRe = /['"`][A-Za-z]:[\\/]/

function inWin32Branch(lines, idx) {
  // 往前找 40 行，命中 win32 判定就算受保护（足够覆盖 'if (process.platform === win32) {' 块）
  const ctx = lines.slice(Math.max(0, idx - 40), idx + 1).join('\n')
  return /platform\s*===\s*'win32'/.test(ctx)
}

for (const f of libFiles) {
  const src = fs.readFileSync(path.join(LIB, f), 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('//')) return // 注释里写示例没关系
    if (!driveRe.test(line)) return
    if (inWin32Branch(lines, i)) {
      note(`${f}:${i + 1} 盘符兜底（win32 分支内，正常）`)
      return
    }
    bad(`${f}:${i + 1} 硬编码盘符且不在 win32 分支里 → ${t.slice(0, 80)}`)
  })
}

/* ---------------------------------------------------- 2. Windows 专属命令 */
const winOnly = [
  { re: /powershell\.exe/i, name: 'PowerShell' },
  { re: /explorer\.exe/i, name: 'explorer' },
  { re: /cmd\.exe/i, name: 'cmd' },
  { re: /WINWORD\.EXE/i, name: 'Word' },
  { re: /taskkill/i, name: 'taskkill' },
]

for (const f of libFiles) {
  const src = fs.readFileSync(path.join(LIB, f), 'utf8')
  const lines = src.split('\n')
  for (const w of winOnly) {
    lines.forEach((line, i) => {
      if (!w.re.test(line)) return
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) return
      // 往前 40 行里找 win32 判定；找到就算有保护
      const ctx = lines.slice(Math.max(0, i - 40), i + 1).join('\n')
      const guarded = /platform\s*===\s*'win32'|platform\s*!==\s*'win32'/.test(ctx)
      if (!guarded) bad(`${f}:${i + 1} 用了 Windows 专属命令 ${w.name} 但没看到 win32 判定`)
    })
  }
}

/* ---------------------------------------------------- 3. 手写路径分隔符 */
for (const f of libFiles) {
  const src = fs.readFileSync(path.join(LIB, f), 'utf8')
  src.split('\n').forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('//')) return
    // 形如 'a\\b' 或 "a/b" 直接拼路径（正则里的 \\ 不算）
    if (/(['"`])[^'"`]*[A-Za-z0-9_-]\\\\[A-Za-z0-9_-][^'"`]*\1/.test(t) && !/\.replace|RegExp|match|test|split/.test(t)) {
      warn(`${f}:${i + 1} 可能手写了反斜杠拼路径 → ${t.slice(0, 80)}`)
    }
  })
}

/* ---------------------------------------------------- 4. Python 脚本 */
if (fs.existsSync(SCRIPTS)) {
  for (const f of fs.readdirSync(SCRIPTS).filter((x) => x.endsWith('.py'))) {
    const full = path.join(SCRIPTS, f)
    const raw = fs.readFileSync(full)
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
      warn(`${f} 带 UTF-8 BOM —— Python 能读，但和别的工具混用时容易出怪问题`)
    }
    const src = raw.toString('utf8')
    if (/^import win32|^from win32/m.test(src)) bad(`${f} 用了 pywin32，mac/Linux 上会 ImportError`)
    if (/^\s*import (msvcrt|winreg)/m.test(src)) bad(`${f} 用了 Windows 专属模块`)
    // 平台字体：必须走 _fonts.py
    if (/微软雅黑|宋体|Consolas/.test(src) && !/_fonts/.test(src) && !/font_set\(\)/.test(src)) {
      bad(`${f} 写死了 Windows 字体名，应该用 _fonts.font_set()`)
    }
  }
  const fontFile = path.join(SCRIPTS, '_fonts.py')
  if (!fs.existsSync(fontFile)) bad('缺 scripts/_fonts.py（跨平台字体）')
  else {
    const fsSrc = fs.readFileSync(fontFile, 'utf8')
    for (const p of ['Darwin', 'Windows']) {
      if (!fsSrc.includes(p)) bad(`_fonts.py 没处理 ${p}`)
    }
    if (!/Linux|Noto|DejaVu/i.test(fsSrc)) bad('_fonts.py 没给 Linux 的字体方案')
  }
}

/* ---------------------------------------------------- 5. 运行时探测 */
const { pythonCaps } = await import('./lib/python.js')
const caps = await pythonCaps()
note(`Python: ${caps.path || '（没找到）'}${caps.version ? ' · ' + caps.version : ''}`)
note(`  能力 pdf=${caps.pdf} docx=${caps.docx} pptx=${caps.pptx}`)
if (!caps.path) warn('这台机器上没有 Python —— 抽讲义 / 出 Word 用不了（面板会明说）')

const { pdfCapability } = await import('./lib/pdf.js')
const pdfCap = await pdfCapability()
note(`PDF 引擎: ${pdfCap.via}${pdfCap.via === 'none' ? '（只能出 docx）' : ''}`)
if (pdfCap.via === 'none') warn('这台机器没有 Word / LibreOffice —— PDF 出不来，但 docx 不受影响')

const routes = await import('./lib/routes.js')
note(`工作区: ${routes.WORKSPACE}`)
note(`DSH 模块根候选（${routes.dshModuleRoots().length} 个）:`)
for (const r of routes.dshModuleRoots().slice(0, 4)) note(`  ${r}`)
const kit = await routes.loadLlmKit()
if (!kit) warn('解析不到 @deepseek-ai/dsh-llm —— AI 功能会降级（面板会明说），非 AI 功能正常')
else note('DSH 运行时: 已解析')

/* ---------------------------------------------------- 6. package.json */
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'))
const osList = pkg.os || []
for (const p of ['win32', 'darwin', 'linux']) {
  if (!osList.includes(p)) warn(`package.json 的 os 里缺 ${p}`)
}
if (!pkg.engines || !pkg.engines.node) warn('package.json 没声明 engines.node')

/* ---------------------------------------------------- 输出 */
const icon = { bad: '❌', warn: '⚠️ ', note: '·' }
console.log('\ndsh-study-coach 跨平台适配审计\n' + '='.repeat(52))

if (problems.length) {
  console.log('\n硬伤（换系统会挂）：')
  for (const p of problems) console.log('  ❌ ' + p)
} else {
  console.log('\n✅ 没发现硬编码 / 平台专属命令漏判')
}

if (warns.length) {
  console.log('\n需要留意：')
  for (const w of warns) console.log('  ⚠️  ' + w)
}

console.log('\n本机情况：')
for (const n of notes) console.log('  · ' + n)

console.log('\n' + '='.repeat(52))
console.log(problems.length === 0
  ? `适配审计通过（${warns.length} 条留意项）`
  : `${problems.length} 处硬伤需要修`)

// 依赖清单，方便写进 README / 回答「别人装得上吗」
console.log(`
别人装上需要什么：
  · Node >= 22（DSH 自带运行时满足）
  · Python 3.10+，且装了 pymupdf / python-docx / python-pptx
      DSH 运行时就带齐了；没有的话 pip install pymupdf python-docx python-pptx
  · PDF 输出二选一：Windows 装 Office，或任意平台装 LibreOffice
  · DSH 安装目录能被解析（自动探测；失败时设 DSH_INSTALL_DIR）
`)

process.exit(problems.length === 0 ? 0 : 1)
