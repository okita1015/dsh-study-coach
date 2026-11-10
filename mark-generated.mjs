/**
 * 给「已经躺在资源库里的历史文件」补记来源清单。
 *
 * 背景：判定一个文件是不是 DSH 生成物，最靠得住的是科目清单 generated.json；
 * 命名约定只是兜底。清单是这次新加的，之前那批生成物没票，所以跑一遍补上。
 *
 * 用法：
 *   node mark-generated.mjs                # 只看会标哪些，不写
 *   node mark-generated.mjs --apply        # 真写
 *   node mark-generated.mjs --apply ITP3901
 *
 * 幂等：已经标过（不管是自动补票还是手工标过）的一律跳过，不会覆盖手工纠正。
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const only = args.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase())

const core = await import('./lib/core.js')
const routes = await import('./lib/routes.js')

const subs = core.listSubjects()
const targets = only.length ? subs.filter((s) => only.includes(String(s.code).toUpperCase())) : subs

console.log(`DSH_HOME = ${core.dshHome()}`)
console.log(`${apply ? '写入' : '预演（加 --apply 才写）'} · 科目 ${targets.length} 个\n`)

let totalAdded = 0
for (const s of targets) {
  const dirs = []
  for (const sec of routes.SECTIONS) {
    const d = routes.resolveSectionDir(s.code, sec.key)
    if (d) dirs.push(d)
  }
  const root = path.join(routes.WORKSPACE, String(s.code).toUpperCase())
  if (fs.existsSync(root)) dirs.push(root)

  if (!apply) {
    // 预演：自己数一遍，不写盘
    const man = core.readGenerated(s.code)
    let hit = 0
    const names = []
    for (const dir of [...new Set(dirs)]) {
      let ents = []
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of ents) {
        if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~$')) continue
        const key = core.manifestKey(path.join(dir, e.name))
        if (man.files[key] || man.unmarked[key]) continue
        if (!core.isGeneratedName(e.name)) continue
        hit++
        names.push(e.name)
      }
    }
    console.log(`${s.code}: 会新增 ${hit} 条（已有清单 ${Object.keys(man.files).length} 条）`)
    for (const n of names.slice(0, 8)) console.log('  · ' + n)
    if (names.length > 8) console.log(`  …还有 ${names.length - 8} 条`)
    totalAdded += hit
  } else {
    const r = core.backfillGenerated(s.code, [...new Set(dirs)])
    console.log(`${s.code}: 新增 ${r.added} 条，跳过已标 ${r.kept} 条，扫描 ${r.scanned} 个文件`)
    totalAdded += r.added
  }
}

console.log(`\n${apply ? '已写入' : '预计新增'} ${totalAdded} 条 → ${path.join(core.studyRoot(), '<CODE>', 'generated.json')}`)
