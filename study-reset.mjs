/**
 * study-reset.mjs —— 把一个科目的掌握度、答题流水全部清零（知识点和题卡保留）。
 *
 *   node study-reset.mjs <科目代码>          # 例：node study-reset.mjs COMP2012
 *   node study-reset.mjs <科目代码> --all    # 连知识点和题卡一起删
 */
import fs from 'node:fs'
import path from 'node:path'

const C = await import('./lib/core.js')

const args = process.argv.slice(2)
const codeArg = args.find((a) => !a.startsWith('--'))
const nuke = args.includes('--all')

if (args.includes('--help') || args.includes('-h') || !codeArg) {
  console.log('用法: node study-reset.mjs <科目代码> [--all]')
  const subs = (() => { try { return C.listSubjects() } catch { return [] } })()
  if (subs.length) {
    console.log('现有科目:')
    for (const s of subs) console.log(`  ${String(s.code).padEnd(10)} ${s.name || ''}`)
  } else {
    console.log('还没有科目 —— 先在面板里加一个。')
  }
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1)
}

const code = codeArg.toUpperCase()

const dir = C.subjectDir(code)
if (!fs.existsSync(dir)) {
  console.log(`没有 ${code} 的数据目录：${dir}`)
  process.exit(1)
}

if (nuke) {
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`已删除整个 ${code} 数据目录：${dir}`)
  process.exit(0)
}

// 只清进度，保留知识点与题卡
const data = C.readTopics(code)
const before = data.topics.length
for (const t of data.topics) {
  t.mastery = 0
  t.seen = 0
  t.right = 0
  t.wrong = 0
  t.due = C.today()
  t.lastSeen = null
}
C.writeTopics(code, data)

const logPath = path.join(dir, 'attempts.jsonl')
let n = 0
if (fs.existsSync(logPath)) {
  n = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).length
  fs.writeFileSync(logPath, '', 'utf8')
}

const cards = C.readCards(code).cards.length
console.log(`已重置 ${code}`)
console.log(`  知识点 ${before} 个 → 掌握度归零、到期日改为今天`)
console.log(`  题卡 ${cards} 张（保留）`)
console.log(`  答题流水清空 ${n} 条`)
console.log(`\n面板刷新一下就是全新状态。`)


