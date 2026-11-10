/**
 * dsh-study-coach / pdf.js
 *
 * docx → pdf。为什么值得单独做一层：
 *   PDF 排版固定、手机上一眼能看、发给同学不会因为字体缺失而走样。
 *   docx 适合自己改，PDF 适合读和传。
 *
 * 三层兜底（按效果好坏排）：
 *   1. **Word COM**（Windows + 装了 Office）—— 直接吃我们自己排的 docx，版式一毫不差
 *   2. **LibreOffice --headless**（mac / Linux 常见，Windows 装了也行）
 *   3. 都没有 → 明确报错，告诉用户装什么；**不让整个流水线失败**（docx 已经出来了）
 *
 * 为什么用 -EncodedCommand 调 PowerShell：路径里中文、空格、引号都会把命令行吃掉，
 * base64(UTF-16LE) 是唯一不吃亏的传法。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

function run(cmd, args, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(e && e.message) })
      return
    }
    const out = []
    const err = []
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      try { child.kill() } catch {}
    }, timeoutMs)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, code: -1, stdout: '', stderr: String(e && e.message) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !killed,
        code,
        killed,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      })
    })
  })
}

/** soffice 候选位置 */
function sofficeCandidates() {
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || pf
    return [
      path.join(pf, 'LibreOffice', 'program', 'soffice.exe'),
      path.join(pf86, 'LibreOffice', 'program', 'soffice.exe'),
    ]
  }
  if (process.platform === 'darwin') {
    return ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice']
  }
  return ['/usr/bin/soffice', '/usr/local/bin/soffice', 'soffice']
}

function findSoffice() {
  for (const c of sofficeCandidates()) {
    if (c === 'soffice') return c
    try {
      if (fs.existsSync(c)) return c
    } catch {}
  }
  return null
}

/** 用 LibreOffice headless 转 */
async function viaSoffice(soffice, src, outDir) {
  const r = await run(soffice, [
    '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, src,
  ], { timeoutMs: 180000 })
  const expect = path.join(outDir, path.basename(src).replace(/\.docx$/i, '.pdf'))
  if (fs.existsSync(expect)) return { ok: true, out: expect, via: 'libreoffice' }
  return { ok: false, error: 'soffice-failed', detail: (r.stderr || r.stdout || '').slice(-300) }
}

/** 用 Word COM 转（Windows） */
async function viaWord(src, dst) {
  if (process.platform !== 'win32') return { ok: false, error: 'not-windows' }
  // PowerShell 单引号字符串里，单引号要写成两个
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$w = New-Object -ComObject Word.Application',
    '$w.Visible = $false',
    '$w.DisplayAlerts = 0',
    '$w.AutomationSecurity = 3',
    `$doc = $w.Documents.Open(${q(src)}, $false, $true)`,
    `$doc.SaveAs([ref]${q(dst)}, [ref]17)`,   // 17 = wdFormatPDF
    '$doc.Close($false)',
    '$w.Quit()',
    'Write-Output "PDF-OK"',
  ].join('; ')

  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    timeoutMs: 180000,
  })
  if (fs.existsSync(dst) && fs.statSync(dst).size > 1000) {
    return { ok: true, out: dst, via: 'word' }
  }
  return {
    ok: false,
    error: 'word-failed',
    detail: ((r.stderr || '') + ' ' + (r.stdout || '')).trim().slice(-300) || 'Word 没生成 PDF',
  }
}

/**
 * docx → pdf，自动挑能用的办法。
 * 返回 { ok, out, via } 或 { ok:false, error, detail }
 */
export async function docxToPdf(src, dst) {
  if (!fs.existsSync(src)) return { ok: false, error: 'no-source', detail: src }
  const outDir = path.dirname(dst)
  try {
    fs.mkdirSync(outDir, { recursive: true })
  } catch {}

  const tried = []

  // ① Word（Windows 上版式最准）
  if (process.platform === 'win32') {
    const w = await viaWord(src, dst)
    if (w.ok) return w
    tried.push('word: ' + (w.error || ''))
  }

  // ② LibreOffice
  const soffice = findSoffice()
  if (soffice) {
    const l = await viaSoffice(soffice, src, outDir)
    if (l.ok) {
      // soffice 输出的文件名固定，改名到目标名
      if (path.normalize(l.out) !== path.normalize(dst)) {
        try { fs.renameSync(l.out, dst) } catch {}
      }
      return { ok: true, out: fs.existsSync(dst) ? dst : l.out, via: 'libreoffice' }
    }
    tried.push('libreoffice: ' + (l.detail || l.error || ''))
  } else {
    tried.push('libreoffice: 没装')
  }

  return {
    ok: false,
    error: 'no-pdf-engine',
    detail: '这台机器上找不到能把 Word 转 PDF 的工具：' +
      (process.platform === 'win32' ? '装 Office（Word）或 LibreOffice' : '装 LibreOffice（soffice）') +
      (tried.length ? '　试过：' + tried.join(' / ') : ''),
  }
}

/** 让面板能提前知道 PDF 能不能出 */
export async function pdfCapability() {
  const so = findSoffice()
  if (process.platform === 'win32') {
    // 有 Word 就直接说能（不真起 Word 探，太慢）
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || pf
    const word = [
      path.join(pf, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
      path.join(pf86, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
    ].some((p) => {
      try { return fs.existsSync(p) } catch { return false }
    })
    return { ok: true, via: word ? 'word' : (so ? 'libreoffice' : 'none'), soffice: !!so, word }
  }
  return { ok: !!so, via: so ? 'libreoffice' : 'none', soffice: !!so, word: false }
}

void os
