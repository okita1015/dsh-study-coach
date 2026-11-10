/**
 * dsh-study-coach / doctor.mjs
 *
 * 装完之后先跑这个 —— 它告诉你这台机器上哪些功能能用、哪些缺东西。
 *
 *   node doctor.mjs
 *
 * 检查项：
 *   node 版本 / DSH 安装能不能解析到 dsh-llm / Python 在不在、能不能抽 PDF·写 Word·写 PPT
 *   工作区目录 / 数据目录能不能写
 *
 * 退出码：0 全通，1 有缺（缺的项会给出具体修法）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const rows = []
let bad = 0

function line(status, label, detail = '') {
  rows.push({ status, label, detail })
  if (status === 'FAIL') bad++
}

/* ------------------------------------------------------------ node */
const major = Number(process.versions.node.split('.')[0])
line(major >= 22 ? 'OK' : 'FAIL', `Node ${process.versions.node}`, major >= 22 ? '' : '需要 >= 22（package.json engines）')

/* ------------------------------------------------------- 插件自检 */
let routes
try {
  routes = await import('./lib/routes.js')
  line('OK', '插件模块加载', 'lib/routes.js')
} catch (e) {
  line('FAIL', '插件模块加载', e.message)
}

if (routes) {
  // 工作区
  const ws = routes.WORKSPACE
  const wsOk = (() => {
    try {
      return fs.statSync(ws).isDirectory()
    } catch {
      return false
    }
  })()
  line(wsOk ? 'OK' : 'FAIL', '工作区目录', ws + (wsOk ? '' : '　← 建它，或设 DSH_STUDY_WORKSPACE 指向你放资料的目录'))

  // DSH 安装
  const roots = routes.dshModuleRoots()
  const kit = await routes.loadLlmKit()
  line(kit ? 'OK' : 'FAIL', 'DSH 运行时（@deepseek-ai/dsh-llm）',
    kit ? '已解析' : `解析不到。候选路径都试过了：\n      ${roots.slice(0, 4).join('\n      ')}\n      ← 设 DSH_INSTALL_DIR 指向 DSH 安装根目录`)

  if (kit) {
    for (const k of ['createUserMessage', 'BlockAssembler']) {
      line(typeof kit[k] === 'function' ? 'OK' : 'FAIL', `dsh-llm.${k}`, kit[k] ? '' : 'SDK 版本可能太旧')
    }
  }
}

/* ---------------------------------------------------------- Python */
const py = await import('./lib/python.js')
const caps = await py.pythonCaps()
if (!caps.path) {
  line('FAIL', 'Python', '没找到解释器。装一个，或用 DSH_STUDY_PYTHON 指定路径')
} else {
  line('OK', 'Python', `${caps.version}（来源 ${caps.source}）\n      ${caps.path}`)
  line(caps.pdf ? 'OK' : 'FAIL', 'PDF 抽文本（pymupdf）',
    caps.pdf ? '' : 'pip install pymupdf　← 没有它「一键生成」读不了 PDF 讲义')
  line(caps.docx ? 'OK' : 'FAIL', 'Word 读写（python-docx）',
    caps.docx ? '' : 'pip install python-docx　← 没有它导不出 .docx')
  line(caps.pptx ? 'OK' : 'FAIL', 'PPT 生成（python-pptx）',
    caps.pptx ? '' : 'pip install python-pptx　← 没有它导不出 .pptx')
}

/* ------------------------------------------------------- PDF 引擎 */
// docx 好出，pdf 要看这台机器有没有 Word（Windows）或 LibreOffice（任意平台）。
// 单独报一行：否则学生只会看到「全部 OK」，导出 PDF 时才发现没引擎。
try {
  const { pdfCapability } = await import('./lib/pdf.js')
  const cap = await pdfCapability()
  line(cap.via === 'none' ? 'FAIL' : 'OK', 'PDF 输出引擎',
    cap.via === 'none'
      ? '没有 Word / LibreOffice　← 只能出 .docx。Windows 装 Office，或任意平台装 LibreOffice（soffice）'
      : `via ${cap.via}`)
} catch (e) {
  line('FAIL', 'PDF 输出引擎', '探测失败：' + e.message)
}

/* ------------------------------------------------------- 数据目录 */
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const studyDir = path.join(home, 'study')
try {
  fs.mkdirSync(studyDir, { recursive: true })
  const probe = path.join(studyDir, '.doctor-probe')
  fs.writeFileSync(probe, 'ok')
  fs.rmSync(probe, { force: true })
  line('OK', '数据目录可写', studyDir)
} catch (e) {
  line('FAIL', '数据目录可写', studyDir + '：' + e.message)
}

/* ------------------------------------------------ 跨平台：目录约定 */
// 「翻译成中英对照」和「一键生成」都要往复习目录落文件。
// 目录名是各人自己起的（1_复习资料 / review / notes …），所以要告诉用户会落到哪。
if (routes && routes.reviewDirOf) {
  const subjects = (() => {
    try { return routes.buildTree().subjects || [] } catch { return [] }
  })()
  if (!subjects.length) {
    line('OK', '复习目录', '还没有科目 —— 面板里加一个科目就会按 1_复习资料 → 复习资料 → review → notes 的顺序找')
  } else {
    for (const s of subjects.slice(0, 5)) {
      let dir = ''
      try { dir = routes.reviewDirOf(s.code) } catch (e) { dir = '解析失败：' + e.message }
      line(dir && !dir.startsWith('解析失败') ? 'OK' : 'FAIL', `复习目录 · ${s.code}`, dir)
    }
  }
  const cn = process.platform === 'win32' ? '中文目录名没问题' : 'UTF-8 文件名没问题'
  line('OK', `路径编码（${process.platform}）`, cn)
}

/* ------------------------------------------------------------ 输出 */
const icon = { OK: '✅', FAIL: '❌' }
console.log('\ndsh-study-coach 环境自检\n' + '='.repeat(46))
for (const r of rows) {
  console.log(`${icon[r.status]} ${r.label}${r.detail ? '\n    ' + r.detail : ''}`)
}
console.log('='.repeat(46))
console.log(bad === 0
  ? '全部就绪 ✅　面板里：🪄 一键生成 / 📝 出练习卷 / 🌐 翻译 都能用'
  : `${bad} 项需要处理 ❌　上面标出的都补齐就能用`)

// 顺便提示模型通道：没有 llm 服务的话 AI 功能都会降级
if (routes && (await routes.loadLlmKit())) {
  console.log('\n提示：AI 功能用哪个模型由面板顶栏 🧠 决定。')
  console.log('      掉线的通道（比如账号认证失败）会把正文回空，换一个能用的即可。')
}
process.exit(bad === 0 ? 0 : 1)
