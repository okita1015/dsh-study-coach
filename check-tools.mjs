/**
 * 用真的 @deepseek-ai/dsh-tools 跑一遍 apply()。
 *
 * 为什么必须跑：工具 JSON schema 里漏一个 additionalProperties，DSH 会在 apply() 里抛
 * JsonSchemaError，整个插件加载失败 —— 连 HTTP 路由都挂不上，界面上什么都看不见。
 * 假 ctx + 假 schema 都会掩盖这个问题（README「踩过的坑」第 5 条）。
 *
 *   node check-tools.mjs
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const tmp = path.join(os.tmpdir(), 'study-coach-tools-' + Date.now())
fs.mkdirSync(tmp, { recursive: true })
process.env.DSH_HOME = tmp
process.env.DSH_STUDY_WORKSPACE = path.join(tmp, 'ws')

const here = path.dirname(fileURLToPath(import.meta.url))
const DSH = process.env.DSH_INSTALL_DIR
  ? path.join(process.env.DSH_INSTALL_DIR, 'resources', 'app', 'node_modules')
  : 'C:\\Program Files\\DSH NEXT\\resources\\app\\node_modules'

let tools
try {
  const req = createRequire(path.join(DSH, '_r.js'))
  const p = req.resolve('@deepseek-ai/dsh-tools')
  tools = await import('file://' + p.replace(/\\/g, '/'))
} catch (e) {
  console.log('⚠️  解析不到 @deepseek-ai/dsh-tools：' + e.message)
  console.log('   设 DSH_INSTALL_DIR 指向 DSH 安装根目录再跑。')
  process.exit(2)
}

// 用真的 defineTool（这一步就会校验 schema）
const mod = await import('file://' + path.join(here, 'lib', 'index.js').replace(/\\/g, '/'))
const registered = []
const routes = []
const disposers = []
const ctx = {
  logger: { warn: (m) => console.log('  [warn]', m && m.message ? m.message : m) },
  tools: { register: (t) => { registered.push(t); return () => {} } },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
}

let failed = 0
try {
  mod.apply(ctx)
} catch (e) {
  failed++
  console.log('❌ apply() 抛异常：' + e.message)
  console.log(e.stack.split('\n').slice(0, 8).join('\n'))
}

console.log('注册工具：' + registered.length)
for (const t of registered) {
  const name = t.name || t.spec?.name
  const hasParams = !!(t.parameters || t.spec?.parameters)
  console.log(`  ${name.padEnd(18)} ${hasParams ? 'schema ok' : 'no params'}`)
}

console.log('挂载路由：' + routes.length)
for (const r of routes) console.log('  ' + (r.path || r.route || '?'))

const want = [
  'study_library', 'study_subjects', 'study_add', 'study_topics', 'study_cards',
  'study_plan', 'study_drill', 'study_check', 'study_stats',
  'study_translate', 'study_mark', 'study_generate', 'study_paper', 'study_health',
]
const got = new Set(registered.map((t) => t.name || t.spec?.name))
for (const w of want) {
  if (!got.has(w)) {
    failed++
    console.log('❌ 缺工具 ' + w)
  }
}
const wantRoutes = ['mark', 'translate', 'generated/backfill', 'sources', 'pipeline/start', 'pipeline/status', 'pipeline/render', 'health', 'paper/analyze', 'paper/scope', 'paper/generate', 'paper/template', 'asset', 'cards.csv', 'backup', 'restore']
for (const w of wantRoutes) {
  if (!routes.some((r) => String(r.path || '').includes(w))) {
    failed++
    console.log('❌ 缺路由 ' + w)
  }
}

try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {}

/* ---------------------------------------------- 真的跑几个工具 */
// schema 过了不代表 execute() 里没有未定义符号 —— study_health 就因为漏 import
// loadLlmKit 在运行时炸过一次。所以这里把不依赖外部服务的工具都实际执行一遍。
console.log('\n执行工具（不碰网络的）:')
const byName = new Map(registered.map((t) => [t.name || t.spec?.name, t]))
const smoke = [
  ['study_health', {}],
  ['study_subjects', {}],
  ['study_library', {}],
  ['study_mark', { code: 'COMP2011', list: true }],
]
for (const [name, args] of smoke) {
  const tool = byName.get(name)
  if (!tool) continue
  try {
    const r = await tool.execute(args)
    const okish = r && (r.ok === true || r.code)
    console.log(`  ${okish ? '✅' : '⚠️ '} ${name.padEnd(16)} ${r && r.ok === false ? 'ok:false ' + (r.error || '') : ''}`)
    if (name === 'study_health') {
      console.log('     llm injected:', r?.llm?.injected, '| python:', r?.python?.path ? 'found' : 'missing')
      if (Array.isArray(r?.llm?.perProvider)) {
        for (const p of r.llm.perProvider) console.log(`       ${p.models > 0 ? '✅' : '❌'} ${p.id} → ${p.models} models${p.error ? ' (' + p.error + ')' : ''}`)
      }
    }
  } catch (e) {
    failed++
    console.log(`  ❌ ${name} 执行抛异常：${e.message}`)
  }
}

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 处失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
