/**
 * dsh-study-coach 本地自测 —— 不依赖 DSH，直接跑 core.js。
 *   node test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// 用临时 DSH_HOME，别碰真实数据
const tmp = path.join(os.tmpdir(), 'study-coach-test-' + Date.now())
process.env.DSH_HOME = tmp

const core = await import('./lib/core.js')

let pass = 0
let fail = 0
function ok(cond, name, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}  ${extra}`)
  }
}

console.log('DSH_HOME(test) =', tmp)
console.log('studyRoot     =', core.studyRoot())

/* ---------------------------------------------------- 1. 科目登记 */
console.log('\n[1] 科目')
// 考试日按**本地**日期算 +10 天。
// 以前写 new Date(...).toISOString()，那是 UTC 日期；本地凌晨跑测试会正好差一天，
// 把一条正确的 stats 断言测成红的。
const examIn10 = (() => {
  const d = new Date()
  d.setDate(d.getDate() + 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()
const s = core.upsertSubject({
  code: 'COMP2011',
  name: 'Discrete Mathematics & Statistics',
  root: 'COMP2011',
  examDate: examIn10,
})
ok(s.code === 'COMP2011', '登记成功')
ok(core.listSubjects().length === 1, '清单里有 1 个')
ok(core.getSubject('comp2011')?.code === 'COMP2011', '小写也能查到')

/* ---------------------------------------------------- 2. 知识点 */
console.log('\n[2] 知识点')
const r1 = core.addTopics('COMP2011', [
  { lecture: 'Lec 6', title: 'Dijkstra 最短路径', titleEn: 'Shortest Path Algorithm' },
  { lecture: 'Lec 6', title: '树与最小生成树', titleEn: 'Trees and MST' },
  { lecture: 'Lec 7', title: '加法与乘法法则', titleEn: 'Sum and Product Rule' },
  { lecture: 'Lec 8', title: '排列与组合', titleEn: 'Permutation and Combination' },
  { lecture: 'Lec 9', title: '条件概率', titleEn: 'Conditional Probability' },
  { lecture: 'Lec 10', title: '随机变量与期望', titleEn: 'Random Variables' },
])
ok(r1.added === 6, `新增 6 个（实际 ${r1.added}）`)
const r2 = core.addTopics('COMP2011', [{ lecture: 'Lec 6', title: 'Dijkstra 最短路径' }])
ok(r2.added === 0, '重复添加被跳过（幂等）')

/* ---------------------------------------------------- 3. 题卡 */
console.log('\n[3] 题卡')
const topics = core.readTopics('COMP2011').topics
const keyOf = (t) => topics.find((x) => x.title.includes(t))?.key
const rc = core.addCards('COMP2011', [
  { topicKey: keyOf('Dijkstra'), question: 'Dijkstra 何时停止？', answer: 'T 一旦被赋予 potential', marks: 2 },
  { topicKey: keyOf('树与'), question: 'n 个顶点的树有多少条边？', answer: 'n − 1', marks: 1 },
  { topicKey: keyOf('排列'), question: 'C(10,4) = ?', answer: '210', marks: 1 },
  { topicKey: keyOf('条件概率'), question: 'P(A|B) 的公式？', answer: 'P(A∩B)/P(B)', marks: 2 },
])
ok(rc.added === 4, `新增 4 张卡（实际 ${rc.added}）`)

/* ---------------------------------------------------- 4. 计划 */
console.log('\n[4] 学习计划')
const plan = core.buildPlan('COMP2011', { perDay: 3 })
ok(plan.todayList.length === 3, `今天 3 个（实际 ${plan.todayList.length}）`)
ok(plan.daysLeft === 10, `距考试 10 天（实际 ${plan.daysLeft}）`)
ok(plan.totalTopics === 6, '知识点数正确')

/* ---------------------------------------------------- 5. 抽题 */
console.log('\n[5] 抽题')
const pick = core.pickQuestions('COMP2011', { count: 2 })
ok(pick.cards.length === 2, `抽到 2 道（实际 ${pick.cards.length}）`)
ok(pick.cards.every((c) => c.answer), '带答案（内部）')

/* ---------------------------------------------------- 6. 记对错 */
console.log('\n[6] 记对错 → 掌握度 / 到期')
const t1 = core.readTopics('COMP2011').topics.find((x) => x.title.includes('Dijkstra'))
const a1 = core.recordAttempt('COMP2011', { topicKey: t1.key, correct: true })
ok(a1.ok && a1.masteryAfter === 0.15, `答对 → 15%（实际 ${a1.masteryAfter}）`)
ok(a1.intervalDays === 1, `下次间隔 1 天（实际 ${a1.intervalDays}）`)

const a2 = core.recordAttempt('COMP2011', { topicKey: t1.key, correct: true })
ok(a2.masteryAfter === 0.3, `再答对 → 30%（实际 ${a2.masteryAfter}）`)

const a3 = core.recordAttempt('COMP2011', { topicKey: t1.key, correct: false })
ok(a3.masteryAfter === 0.05, `答错 -25% → 5%（实际 ${a3.masteryAfter}）`)

// 一路答对到 90% 以上看间隔是否拉开
let last = a3.masteryAfter
for (let i = 0; i < 10; i++) {
  last = core.recordAttempt('COMP2011', { topicKey: t1.key, correct: true }).masteryAfter
}
ok(last === 1, `连续答对封顶 100%（实际 ${last}）`)
const aTop = core.recordAttempt('COMP2011', { topicKey: t1.key, correct: true })
ok(aTop.intervalDays === 30, `满掌握时间隔 30 天（实际 ${aTop.intervalDays}）`)

const aBad = core.recordAttempt('COMP2011', { topicKey: 'no-such-topic', correct: true })
ok(aBad.ok === false && aBad.reason === 'topic-not-found', '找不到知识点时报错')

/* ---------------------------------------------------- 7. 统计 */
console.log('\n[7] 统计')
const st = core.stats('COMP2011')
ok(st.totalTopics === 6, `总知识点 6（实际 ${st.totalTopics}）`)
ok(st.studied === 1, `学过 1 个（实际 ${st.studied}）`)
const sumBuckets = st.byBucket.reduce((a, b) => a + b.count, 0)
ok(sumBuckets === 6, `分档合计 = 6（实际 ${sumBuckets}）`)
ok(st.lectureRows.length === 5, `章节数 5（实际 ${st.lectureRows.length}）`)

/* ---------------------------------------------------- 8. 流水 */
console.log('\n[8] 答题流水落盘')
const log = path.join(core.subjectDir('COMP2011'), 'attempts.jsonl')
const lines = fs.readFileSync(log, 'utf8').trim().split('\n')
ok(lines.length === 14, `写了 14 条（实际 ${lines.length}）`)
ok(JSON.parse(lines[0]).topicKey === t1.key, '第一条内容正确')

/* ---------------------------------------------------- 9. 生成物来源判定 */
console.log('\n[9] 生成物来源判定（命名 / 清单 / 手工）')
const WS = path.join(tmp, 'ws')
const DIR = path.join(WS, 'COMP2011', '0_课程材料', '试卷')
fs.mkdirSync(DIR, { recursive: true })
const touch = (name) => {
  const p = path.join(DIR, name)
  fs.writeFileSync(p, 'x')
  return p
}
const fPaper = touch('2024 CA Test 1.docx')
const fNote = touch('01-完整笔记.docx')
const fCheat = touch('05-考前冲刺单.docx')

ok(core.isGeneratedName('01-完整笔记.docx') === true, '命名命中：完整笔记')
ok(core.isGeneratedName('Lec 1 - Set Operations.pptx') === false, '命名不命中：Lec 1')
ok(core.resolveOrigin('COMP2011', fPaper).origin === 'source', '真题卷 → 原件（命名兜底）')
ok(core.resolveOrigin('COMP2011', fNote).origin === 'generated', '完整笔记 → 生成物（命名兜底）')

// 清单优先于命名：把「完整笔记」手工标回原件
core.setGeneratedFlag('COMP2011', { filePath: fNote, generated: false })
const rNote = core.resolveOrigin('COMP2011', fNote)
ok(rNote.origin === 'source' && rNote.by === 'manual', '手工标成原件后覆盖命名规则')
ok(core.isGeneratedName('01-完整笔记.docx') === true, '命名规则本身没被改掉')

// 反过来：把真题卷标成生成物
core.setGeneratedFlag('COMP2011', { filePath: fPaper, generated: true })
ok(core.resolveOrigin('COMP2011', fPaper).origin === 'generated', '手工标成生成物生效')

// 清除标记 → 回到命名判定
core.setGeneratedFlag('COMP2011', { filePath: fPaper, generated: null })
const rBack = core.resolveOrigin('COMP2011', fPaper)
ok(rBack.origin === 'source' && rBack.by === 'default', '清除标记后回到默认判定')

// 路径大小写 / 斜杠不敏感
core.setGeneratedFlag('COMP2011', { filePath: fPaper, generated: true })
const weird = fPaper.replace(/\\/g, '/').toUpperCase()
ok(core.resolveOrigin('COMP2011', weird).origin === 'generated', '大小写和斜杠不影响匹配')
core.setGeneratedFlag('COMP2011', { filePath: fPaper, generated: null })

// 补票：把没标过的生成物一次性写进清单
const bf = core.backfillGenerated('COMP2011', [DIR])
ok(bf.added === 1, `补票新增 1 个（冲刺单；笔记已手工标原件，实际 ${bf.added}）`)
ok(bf.kept === 1, `已标过的跳过 1 个（实际 ${bf.kept}）`)
const bf2 = core.backfillGenerated('COMP2011', [DIR])
ok(bf2.added === 0, '再跑一次幂等，不重复加')
ok(core.resolveOrigin('COMP2011', fCheat).by === 'manifest', '补票后凭清单判定')
ok(fs.existsSync(core.generatedManifestPath('COMP2011')), 'generated.json 落盘')

/* ---------------------------------------------------- 10. 翻译落库 */
console.log('\n[10] 翻译：缺哪边补哪边')
core.addTopics('COMP2011', [
  { lecture: 'Lec 6', title: '只中文的知识点' },
  { lecture: 'Lec 6', title: '两边都有', titleEn: 'Both Sides' },
])
const pend = core.pendingTranslations('COMP2011', { target: 'en' })
ok(pend.some((t) => t.title === '只中文的知识点'), '缺英文的被挑出来')
ok(!pend.some((t) => t.title === '两边都有'), '两边都有的不重复翻')
const pendForce = core.pendingTranslations('COMP2011', { target: 'en', force: true })
ok(pendForce.length > pend.length, `force 时把已有的也算上（${pend.length} → ${pendForce.length}）`)

const applied = core.applyTranslations('COMP2011', {
  target: 'en',
  pairs: [
    { k: '只中文的知识点', v: 'Topic With Chinese Only' },
    { k: '两边都有', v: 'Both Sides v2' },
  ],
})
ok(applied.updated === 2, `写回 2 条（实际 ${applied.updated}）`)
const after = core.readTopics('COMP2011').topics
ok(after.find((t) => t.title === '只中文的知识点').titleEn === 'Topic With Chinese Only', '英文字段写对了')
ok(after.find((t) => t.title === '两边都有').titleEn === 'Both Sides v2', '已存在的也能被覆盖')
ok(core.pendingTranslations('COMP2011', { target: 'en' }).every((t) => t.titleEn), '翻译完不再有待翻项')

// 反方向
core.addTopics('COMP2011', [{ lecture: 'Lec 7', titleEn: 'Only English Here' }])
const back = core.applyTranslations('COMP2011', {
  target: 'zh',
  pairs: [{ k: 'Only English Here', v: '只有英文' }],
})
ok(back.updated >= 1, `英→中也写回（${back.updated}）`)

/* ---------------------------------------------------- 11. 模型脏输出 */
console.log('\n[11] 模型返回的脏 JSON 也能解析')
const dirty = [
  ['```json 包裹', '好的\n```json\n[{"k":"卷积","v":"Convolution"}]\n```', 1],
  ['纯对象', '{"排列":"Permutation"}', 1],
  ['key/value 字段', '[{"key":"期望","value":"Expectation"}]', 1],
  ['用等号的行', '卷积 = Convolution\n期望 = Expectation', 2],
  ['尾逗号', '[{"k":"树","v":"Trees"},]', 1],
  ['空字符串', '   ', 0],
]
for (const [label, raw, n] of dirty) {
  const got = core.parsePairs(raw)
  ok(got.length === n, `${label} → ${n} 条（实际 ${got.length}）`)
}
const dedup = core.parsePairs('[{"k":"A","v":"B"},{"k":"A","v":"C"}]')
ok(dedup.length === 1 && dedup[0].v === 'B', '同一个 key 只留第一条')

/* ---------------------------------------------------- 12. 「其他目录」兜底分区 */
console.log('\n[12] 其他目录（1_复习资料 / 3_练习题 这类自建文件夹）')
process.env.DSH_STUDY_WORKSPACE = WS
const routes = await import('./lib/routes.js')

const sub2 = path.join(WS, 'ITP3903')
fs.mkdirSync(path.join(sub2, '0_课程材料', '讲义'), { recursive: true })
fs.mkdirSync(path.join(sub2, '1_复习资料'), { recursive: true })
fs.mkdirSync(path.join(sub2, '3_练习题', 'ch1'), { recursive: true })
fs.mkdirSync(path.join(sub2, '_build'), { recursive: true })
fs.mkdirSync(path.join(sub2, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(sub2, '0_课程材料', '讲义', 'Lec 1.pptx'), 'x')
fs.writeFileSync(path.join(sub2, '1_复习资料', '精讲手册.docx'), 'x')
fs.writeFileSync(path.join(sub2, '3_练习题', 'ch1', 'Paper1.docx'), 'x')
fs.writeFileSync(path.join(sub2, '_build', 'mkfigs.py'), 'x')
fs.writeFileSync(path.join(sub2, '.tmp', 'junk.txt'), 'x')
core.upsertSubject({ code: 'ITP3903', name: 'Test', root: sub2 })

ok(routes.sectionKeys().includes('extra') === false, '固定分区列表里不含 extra')
ok(routes.SECTIONS.some((s) => s.key === 'extra' && s.dynamic), 'SECTIONS 里有动态 extra')

const tr = routes.buildTree()
const got3903 = tr.subjects.find((s) => s.code === 'ITP3903')
const ex = got3903.sections.extra
const rels = ex.files.map((f) => f.rel)
ok(ex.files.length === 2, `其他目录收 2 个文件（实际 ${ex.files.length}: ${rels.join(', ')})`)
ok(rels.includes('1_复习资料/精讲手册.docx'), '收了 1_复习资料')
ok(rels.includes('3_练习题/ch1/Paper1.docx'), '收了 3_练习题（含子目录）')
ok(!rels.some((r) => r.startsWith('0_课程材料')), '固定分区里的文件不重复列')
ok(!rels.some((r) => r.startsWith('_build')), '跳过 _ 开头的目录')
ok(!rels.some((r) => r.startsWith('.tmp')), '跳过 . 开头的目录')
ok(got3903.sections.lecture.files.length === 1, '讲义分区照旧只放 Lec 原件')

// 生成物判定在 deep 扫描里也生效
ok(ex.files.find((f) => f.name === '精讲手册.docx').origin === 'generated', '精讲手册被判成生成物')
ok(ex.files.find((f) => f.name === 'Paper1.docx').origin === 'source', 'Paper1 算原件')

/* ---------------------------------------------------- 13. 流水线的纯逻辑 */
console.log('\n[13] 流水线：笔记拼装 / 范围标签 / job 表')
const pipe = await import('./lib/pipeline.js')
const extract = await import('./lib/extract.js')

const refinedSample = [
  {
    name: 'Lec 6 - Graph 2.pdf',
    lecture: 'Lec 6',
    topics: [
      { lecture: 'Lec 6', title: 'Dijkstra 最短路径', titleEn: 'Dijkstra Shortest Path', summary: '按距离逐步确定最短路', points: ['取 potential 最小的顶点'] },
      { lecture: 'Lec 6', title: '最小生成树', titleEn: 'Minimum Spanning Tree', summary: 'n-1 条边权最小', points: [] },
    ],
    cards: [{ question: 'When does Dijkstra stop?', answer: 'When S contains every vertex', marks: 2 }],
    note: '## 6.1 Shortest Path\n\n- **Dijkstra** 只适用于非负权',
  },
]
const md = pipe.composeNote('COMP2011', refinedSample, { scope: 'Lec6' })
ok(md.startsWith('# COMP2011 Lec6 学习笔记'), '笔记有标题')
ok(md.includes('| 章节 | 知识点 | English |'), '有总览表')
ok(md.includes('| Lec 6 | Dijkstra 最短路径 | Dijkstra Shortest Path |'), '总览表里中英并列')
ok(md.includes('### Dijkstra 最短路径 / Dijkstra Shortest Path'), '每个知识点一节，中英对照')
ok(md.includes('> 来源：Lec 6 - Graph 2.pdf'), '标了来源')
ok(md.includes('1. When does Dijkstra stop?'), '题卡进「练习」')
ok(md.includes('   - 答：When S contains every vertex'), '答案跟在题面下面')
ok(md.includes('## 6.1 Shortest Path'), '模型给的 note 原样保留')

ok(extract.scopeLabel(['a/Lec 6 - x.pdf', 'a/Lec 9 - y.pptx']) === 'Lec6-9', '范围标签 Lec6-9')
ok(extract.scopeLabel(['a/Lec 3 - x.pdf']) === 'Lec3', '单个范围 Lec3')
ok(extract.scopeLabel(['a/notes.pdf']) === '全部', '认不出章节就是「全部」')
ok(extract.lectureTag('Chapter 4 - Matrix.pptx') === 'Lec 4', 'Chapter 也认')
ok(extract.lectureTag('tutorial 2.pdf') === '', 'tutorial 不算章节')
ok(extract.isExtractable('a/b.PDF') === true, '大小写不影响类型判定')
ok(extract.isExtractable('a/b.jpg') === false, '图片抽不了文本')

ok(pipe.getJob('nope') === null, '未知 job 返回 null')

/* ---------------------------------------------------- 14. 崩过的那个坑 */
// 0.8.0 一次真实崩溃：cordis 的 ctx 是 Proxy，没 inject 过 llm 就读 ctx.llm
// 会抛 "cannot get property llm without inject"。这个异常从后台任务里冒成
// unhandled rejection，host 直接 fatal 退出。这一节专门盯死它。
console.log('\n[14] llm 不在 inject 里时不能崩')

const hostileCtx = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  },
)

const routesMod = await import('./lib/routes.js')
ok(routesMod.pickLlm(hostileCtx) === undefined, 'pickLlm 对会抛的 ctx 返回 undefined，不抛')
ok(routesMod.pickLlm(null) === undefined, 'pickLlm(null) 安全')
ok(routesMod.pickLlm({ get: () => undefined }) === undefined, 'pickLlm 在没有服务时也返回 undefined')

const r = await routesMod.runModel(hostileCtx, { system: 's', user: 'u' })
ok(r.ok === false, 'runModel 不抛，返回 ok:false')
ok(r.error === 'no-llm', `错误码是 no-llm（实际 ${r.error}）`)

// 后台任务的 rejection 必须被吃掉（否则就是 host fatal）
const boomFile = path.join(tmp, 'boom.md')
fs.writeFileSync(boomFile, '# hello\n\nsome lecture text', 'utf8')
const boomCtx = { __runModel: () => { throw new Error('model exploded') }, logger: { warn: () => {} } }
const job = pipe.startPipeline(boomCtx, { code: 'COMP2011', files: [boomFile], want: { note: true } })
ok(!!job.id, 'startPipeline 立刻返回 job')
ok(job.state === 'running', '刚起时是 running')

// Windows runner 上磁盘 + 杀毒扫描能把这个后台任务拖到好几秒，
// 原来固定等 4 秒（40×100ms）在 node 24 / windows-latest 上就翻过车。
// 改成带截止时间的轮询，正常 1 秒内收敛，最坏等 15 秒。
const pipeDeadline = Date.now() + 15000
while (job.state === 'running' && Date.now() < pipeDeadline) {
  await new Promise((r2) => setTimeout(r2, 100))
}
ok(job.state !== 'running', `任务已收敛（实际 ${job.state}）`)
ok(job.finishedAt > 0, '记了结束时间')
ok(job.errors.length > 0 || job.out.topics === 0, '错误被记进 job，没有冒出去')
ok(typeof job.logs === 'object', '日志可读')

/* ---------------------------------------------------- 15. 出卷的纯逻辑 */
console.log('\n[15] 出卷：章节范围 / 说明改写 / 版式缓存')
const paperMod = await import('./lib/paper.js')

// 造一批带章节号的第二科，范围判定才好测
core.upsertSubject({ code: 'ITP3904', name: 'Paper Test', root: path.join(WS, 'ITP3904') })
core.addTopics('ITP3904', [
  { lecture: 'Lec 1', title: '集合与运算', titleEn: 'Sets' },
  { lecture: 'Lec 1', title: '文氏图', titleEn: 'Venn Diagram' },
  { lecture: 'Lec 2', title: '模运算', titleEn: 'Modular Arithmetic' },
  { lecture: 'Lec 3', title: '布尔函数', titleEn: 'Boolean Functions' },
  { lecture: 'Lec 5', title: '图的基本概念', titleEn: 'Graph Basics' },
])

const opts = paperMod.scopeOptions('ITP3904')
ok(opts.length === 4, `4 个章节可选（实际 ${opts.length}）`)
ok(opts[0].label === 'Lec 1' && opts[0].num === 1, '第一个是 Lec 1')
ok(opts[0].count === 2, `Lec 1 有 2 个知识点（实际 ${opts[0].count}）`)
ok(opts.map((o) => o.num).join(',') === '1,2,3,5', `按章节号排序（实际 ${opts.map((o) => o.num).join(',')}）`)

const r12 = paperMod.pickScopeTopics('ITP3904', { from: 1, to: 2 })
ok(r12.length === 3, `Ch1-2 选出 3 个（实际 ${r12.length}）`)
ok(r12.every((t) => ['Lec 1', 'Lec 2'].includes(t.lecture)), '范围外的一个都没混进来')

const rFrom3 = paperMod.pickScopeTopics('ITP3904', { from: 3 })
ok(rFrom3.length === 2, `Ch3 起选出 2 个（实际 ${rFrom3.length}）`)

const rOnly5 = paperMod.pickScopeTopics('ITP3904', { from: 5, to: 5 })
ok(rOnly5.length === 1 && rOnly5[0].lecture === 'Lec 5', '只选 Ch5 就只出 Ch5')

const rAll = paperMod.pickScopeTopics('ITP3904', {})
ok(rAll.length === 5, `不给范围就是全部（实际 ${rAll.length}）`)

const rNone = paperMod.pickScopeTopics('ITP3904', { from: 9, to: 10 })
ok(rNone.length === 0, '范围里没知识点时返回空（面板据此拦住）')

// 说明文字要跟着实际题数改 —— 真卷写 EIGHT、FIVE，不能跟实际对不上
ok(paperMod.numWord(8) === 'EIGHT', '8 → EIGHT')
ok(paperMod.numWord(2) === 'TWO', '2 → TWO')
const fixed = paperMod.fixInstruction({
  instruction: [
    'This section contains EIGHT questions.',
    'Answer ALL questions.',
    'Each question is worth FIVE marks.',
  ],
  marksPerQuestion: 5,
  questions: [{ marks: 10 }, { marks: 10 }, { marks: 10 }],
})
ok(fixed[0] === 'This section contains THREE questions.', `题数改成实际（实际：${fixed[0]}）`)
ok(fixed[1] === 'Answer ALL questions.', '不含数字的行原样保留')
ok(fixed[2] === 'Each question is worth TEN marks.', `每题分值改成实际（实际：${fixed[2]}）`)

// 版式缓存读写
paperMod.writeTemplate('ITP3904', {
  sourceName: 'x.pdf', analyzedAt: '2026-11-10T00:00:00Z',
  meta: { moduleCode: 'ITP3904' },
  sections: [{ id: 'A', name: 'Section A', questionCount: 3, marksPerQuestion: 10, marks: 30, prefix: 'A', instruction: [], samples: [] }],
})
const tpl = paperMod.readTemplate('ITP3904')
ok(tpl && tpl.sourceName === 'x.pdf', '版式缓存能读回来')
ok(tpl.sections[0].questionCount === 3, '题数存下来了')
ok(fs.existsSync(paperMod.templatePath('ITP3904')), 'paper-template.json 落盘')
ok(paperMod.readTemplate('NOSUCH') === null, '没有缓存的科目返回 null')

/* ---------------------------------------------------- 16. 通道重试 */
// 「模型找到了但回空」实际踩过：deepseek-account 的模型回空正文，
// 而 freeroute / our-free-model 是好的。所以 runModel 必须自己换通道。
console.log('\n[16] 模型通道：第一个回空就换下一个')
const { runModel, loadLlmKit } = routesMod

// CI（没有 DSH 安装）里解析不到 @deepseek-ai/dsh-llm，这一节无法真跑 —— 明说跳过，
// 别让人误以为过了。本地 / 装了 DSH 的机器上会正常执行。
const haveKit = !!(await loadLlmKit())
if (!haveKit) {
  console.log('  ⚠️  跳过：解析不到 @deepseek-ai/dsh-llm（CI 环境正常现象）')
}

function fakeLlm({ dead = [], alive = [], allDead = false } = {}) {
  return {
    listProviders: () => [{ id: 'dead-provider' }, { id: 'alive-provider' }],
    listModels: async (id) => (
      id === 'dead-provider' ? dead.map((m) => ({ id: m })) : alive.map((m) => ({ id: m }))
    ),
    prepareCall: async (opts) => ({
      config: { provider: opts.provider, model: opts.model },
      stream: async function* () {
        const isDead = opts.provider === 'dead-provider'
        if (isDead || allDead) {
          // 空流：一个正文都没有
          return
        }
        yield { kind: 'text-delta', text: 'OK from ' + opts.provider }
      },
    }),
  }
}

if (haveKit) {
const rt1 = await runModel(null, { system: 's', user: 'u', llm: fakeLlm({ dead: ['dead-1'], alive: ['good-1'] }) })
ok(rt1.ok === true, `第一个通道回空后仍成功（实际 ${rt1.ok ? 'ok' : rt1.error}）`)
ok(rt1.provider === 'alive-provider', `落到第二个通道（实际 ${rt1.provider}）`)
ok(String(rt1.answer).includes('OK'), '拿到了正文')
ok(rt1.triedCount === 2, `记了试过 2 个（实际 ${rt1.triedCount}）`)

const rt2 = await runModel(null, { system: 's', user: 'u', llm: fakeLlm({ dead: ['d1'], alive: [], allDead: true }) })
ok(rt2.ok === false, '全都不行时 ok:false')
ok(Array.isArray(rt2.tried) && rt2.tried.length > 0, '带回了试过的通道明细')
ok(String(rt2.detail).includes('dead-provider'), 'detail 里说明了哪个通道怎么挂的')

// 一个 provider 都没有模型时不要瞎试
const rt3 = await runModel(null, { system: 's', user: 'u', llm: fakeLlm({ dead: [], alive: [] }) })
ok(rt3.ok === false && rt3.error === 'no-model', `没模型时报 no-model（实际 ${rt3.error}）`)

// 钉死通道：DSH_STUDY_MODEL 优先级最高
process.env.DSH_STUDY_MODEL = 'alive-provider/good-1'
const rt4 = await runModel(null, { system: 's', user: 'u', llm: fakeLlm({ dead: ['d1'], alive: ['good-1'] }) })
ok(rt4.ok === true && rt4.provider === 'alive-provider', '钉死的通道优先')
delete process.env.DSH_STUDY_MODEL
}

/* ---------------------------------------------------- 17. 模型偏好 */
console.log('\n[17] 模型选择：写盘 / 读回 / 清除')
const prefs = await import('./lib/modelprefs.js')

ok(prefs.readModelPref() === null, '没选过时返回 null')
prefs.writeModelPref({ provider: 'deepseek-account', model: 'deepseek-flash' })
const got = prefs.readModelPref()
ok(got && got.provider === 'deepseek-account', '存得住')
ok(got.model === 'deepseek-flash', 'model 也存住了')
ok(fs.existsSync(prefs.modelPrefPath()), 'model.json 落盘')
ok(prefs.readModelPref().at.length > 10, '记了时间')

prefs.clearModelPref()
ok(prefs.readModelPref() === null, '清除后回到自动')

// 选过的通道要排在候选表最前面。
// 这一段要真的跑一遍 runModel，而 runModel 内部要 loadLlmKit() 拿到 DSH 的 SDK。
// CI runner 上没装 DSH，必然拿不到 —— 跳过，别让它把整条 CI 拖红（本地有 DSH 会照常跑）。
const kitForPref = await routesMod.loadLlmKit()
if (!kitForPref) {
  console.log('  ⏭ 没有 DSH 运行时，跳过「偏好通道优先」两条（CI 正常）')
} else {
  prefs.writeModelPref({ provider: 'our-free-model', model: 'glm-5.3-flash-free' })
  const fakeForPref = {
    listProviders: () => [{ id: 'dead-provider' }, { id: 'our-free-model' }],
    listModels: async (id) => (
      id === 'dead-provider' ? [{ id: 'dead-1' }] : [{ id: 'glm-5.3-flash-free' }, { id: 'other' }]
    ),
    prepareCall: async (opts) => ({
      config: opts,
      stream: async function* () {
        yield { kind: 'text-delta', text: 'hi from ' + opts.provider + '/' + opts.model }
      },
    }),
  }
  const rp = await runModel(null, { system: 's', user: 'u', llm: fakeForPref })
  ok(rp.ok === true && rp.provider === 'our-free-model', `选过的通道被优先用（实际 ${rp.provider}）`)
  ok(rp.triedCount === 1, `第一个就是它，不用重试（实际试了 ${rp.triedCount} 个）`)
}
prefs.clearModelPref()

/* ---------------------------------------------------- 18. 批量删除 */
// 批量删除是破坏性操作，必须测：只删文件、拒绝目录、越界拒绝、逐条报错不整批失败。
console.log('\n[18] 批量删除（只删文件，目录和越界一律跳过）')

const delDir = path.join(WS, 'ITP3906', '3_练习题')
fs.mkdirSync(path.join(delDir, 'sub'), { recursive: true })
const mk = (n) => { const p = path.join(delDir, n); fs.writeFileSync(p, 'x'); return p }
const d1 = mk('a.docx')
const d2 = mk('b.docx')
const d3 = mk('c.docx')

const delRoute = routesMod.makeRoutes({}, () => null).find((r) => r.path === routesMod.ROUTES.remove)

/** 造一个假的 req/res 调 handler，拿回 { status, body } */
function callRoute(route, body, method = 'POST') {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body))
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    const req = {
      method,
      headers: { 'content-type': 'application/json' },
      on(ev, cb) {
        if (ev === 'data') cb(payload)
        else if (ev === 'end') cb()
        else if (ev === 'close') { /* 不触发 abort */ }
      },
    }
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v },
      writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}) },
      end(b) {
        let j = null
        try { j = JSON.parse(String(b)) } catch { j = { raw: String(b) } }
        finish({ status: this.statusCode, body: j })
      },
    }
    try { route.handler(req, res) } catch (e) { finish({ status: 0, body: { error: e.message } }) }
  })
}

const rb1 = await callRoute(delRoute, { paths: [d1, d2] })
ok(rb1.status === 200 && rb1.body.deleted === 2, `批量删 2 个（实际 ${rb1.body.deleted}）`)
ok(!fs.existsSync(d1) && !fs.existsSync(d2), '两个文件真没了')
ok(fs.existsSync(d3), '没点名的文件还在')

const rb2 = await callRoute(delRoute, { paths: [d3, path.join(delDir, 'sub')] })
ok(rb2.body.deleted === 1, `目录被跳过，只删了文件（实际删 ${rb2.body.deleted}）`)
ok(rb2.body.skipped.some((s) => /目录/.test(s.reason)), '跳过原因说明是目录')
ok(fs.existsSync(path.join(delDir, 'sub')), '目录本身还在')

const rb3 = await callRoute(delRoute, { paths: ['C:\\Windows\\System32\\drivers\\etc\\hosts'] })
ok(rb3.body.deleted === 0, '越界路径一个都没删')
ok(rb3.body.skipped.some((s) => /工作区/.test(s.reason)), '越界说明是不在工作区')

// 前缀伪装：C:\Workspace-evil 的字符串前缀正好是 C:\Workspace，只比 startsWith 就会放行
const evilDir = WS + '-evil'
fs.mkdirSync(evilDir, { recursive: true })
const evilFile = path.join(evilDir, 'x.docx')
fs.writeFileSync(evilFile, 'x')
const rbEvil = await callRoute(delRoute, { paths: [evilFile] })
ok(rbEvil.body.deleted === 0, '工作区同名前缀的兄弟目录不算工作区')
ok(fs.existsSync(evilFile), '兄弟目录里的文件没被误删')
fs.rmSync(evilDir, { recursive: true, force: true })

const rb4 = await callRoute(delRoute, {})
ok(rb4.status === 400, '没给路径时报 400')

const rb5 = await callRoute(delRoute, { path: mk('single.docx') })
ok(rb5.body.deleted === 1, '老的单个 {path} 用法仍然可用（向后兼容）')

/* ---------------------------------------------------- 19. 交卷批改 */console.log('\n[19] 交卷批改：题目摊平 / 分数夹取 / 未作答')
const grade = await import('./lib/grade.js')

// 造一份练习卷 json（跟出卷时落的格式一致）
const paperDir = path.join(WS, 'ITP3904', '3_练习题')
fs.mkdirSync(paperDir, { recursive: true })
const paperPath = path.join(paperDir, 'ITP3904_Ch1-Ch2_练习卷_2026-11-10.json')
fs.writeFileSync(paperPath, JSON.stringify({
  meta: { moduleCode: 'ITP3904' },
  sections: [
    {
      id: 'A', name: 'Section A', prefix: 'A',
      questions: [
        { stem: 'What is C(5,2)?', marks: 5, answer: '10' },
        { stem: 'Explain K-map grouping.', marks: 5, parts: [{ label: '(a)', text: 'state the rule', marks: 2 }, { label: '(b)', text: 'give an example', marks: 3 }], answer: '圈 2 的幂次个 1' },
      ],
    },
  ],
}, null, 2), 'utf8')

const papers = grade.listPapers('ITP3904')
ok(papers.length === 1, `找到 1 份练习卷（实际 ${papers.length}）`)
ok(papers[0].questions === 2, `题数 2（实际 ${papers[0].questions}）`)
ok(papers[0].marks === 10, `总分 10（实际 ${papers[0].marks}）`)

const flat = grade.flattenPaper(JSON.parse(fs.readFileSync(paperPath, 'utf8')))
ok(flat.length === 2, '摊平成 2 题')
ok(flat[0].no === 'A1' && flat[1].no === 'A2', '题号 A1 / A2')
ok(flat[1].marks === 5, '有子题的题，分值取 parts 之和')
ok(flat[0].answer === '10', '带参考答案')

// 假模型：故意给超分、给怪 verdict、漏一题
const fakeGradeCtx = {
  __runModel: async () => ({
    ok: true,
    answer: JSON.stringify({
      items: [
        { no: 'A1', score: 99, full: 5, verdict: 'correct', why: '对', explain: '' },
        { no: 'A2', score: 2, full: 5, verdict: 'partial', why: '只写了一条', explain: '要写两条' },
      ],
      summary: '整体还行',
    }),
  }),
}
const g1 = await grade.gradePaper(fakeGradeCtx, {
  items: flat,
  answers: { A1: '10', A2: '' },
})
ok(g1.total === 7, `总分夹取后 7（实际 ${g1.total}）`)
ok(g1.items.find((x) => x.no === 'A1').score === 5, '超分被夹到满分')
ok(g1.items.find((x) => x.no === 'A2').score === 2, '部分分保留')
ok(g1.full === 10, '满分 10')
ok(g1.percent === 70, `百分比 70（实际 ${g1.percent}）`)
ok(g1.summary === '整体还行', '带上整份总结')

// 模型失败时不能整批挂掉，要带回错误
const failCtx = { __runModel: async () => ({ ok: false, error: 'model-failed', detail: 'x' }) }
const g2 = await grade.gradePaper(failCtx, { items: flat, answers: { A1: '10' } })
ok(g2.ok === false, '模型全失败时 ok:false')
ok(g2.errors.length > 0, '带回错误明细')

/* ---------------------------------------------------- 20. 用量统计 */
console.log('\n[20] 用量统计')
const usage = await import('./lib/usage.js')
const usageBefore = usage.summarize({ days: 1 }).calls
usage.record({ feature: 'grade', code: 'ITP3904', provider: 'p', model: 'm1', promptChars: 1000, outputChars: 500, ms: 2500, ok: true })
usage.record({ feature: 'translate', code: 'ITP3904', provider: 'p', model: 'm2', promptChars: 600, outputChars: 300, ms: 1500, ok: false, error: 'empty-answer' })
const usageAfter = usage.summarize({ days: 1 })
ok(usageAfter.calls === usageBefore + 2, `记了 2 次（${usageBefore} → ${usageAfter.calls}）`)
ok(usageAfter.fails >= 1, '失败也计入')
ok(usageAfter.tokens > 0, `估算出 token（${usageAfter.tokens}）`)
ok(usageAfter.cost === null, '没填单价时不给假费用')
ok(usageAfter.byFeature.grade && usageAfter.byFeature.grade.calls >= 1, '按功能分组')
ok(usageAfter.byModel['p/m1'] && usageAfter.byModel['p/m1'].calls >= 1, '按模型分组')
const priced = usage.summarize({ days: 30, pricePerMTok: 10 })
ok(typeof priced.cost === 'number', '填了单价才给费用')
ok(fs.existsSync(usage.usagePath()), 'usage.jsonl 落盘')

/* ---------------------------------------------------- 21. PDF 能力 */
console.log('\n[21] PDF：能力探测 / 缺文件时明确失败')
const pdfMod = await import('./lib/pdf.js')
const cap = await pdfMod.pdfCapability()
ok(cap && typeof cap.ok === 'boolean', `报得出 PDF 能力（via=${cap.via}）`)
ok(String(cap.via) !== '' , '有 via 字段说明用哪条路')
const missing = await pdfMod.docxToPdf(
  path.join(tmp, 'no-such-file.docx'),
  path.join(tmp, 'no-such-out.pdf'),
)
ok(missing.ok === false, '源文件不存在时 ok:false')
ok(missing.error === 'no-source', `错误码是 no-source（实际 ${missing.error}）`)

/* ---------------------------------------------------- 22. 打开原文件 */
// 只测边界：越界 / 不存在。成功路径会真的唤起系统程序，测试里不能点。
console.log('\n[22] 打开原文件：越界拒绝 / 不存在报错')
const openRoute = routesMod.makeRoutes({}, () => null).find((r) => r.path === routesMod.ROUTES.open)
ok(!!openRoute, '有 /open 路由')

const ob1 = await callRoute(openRoute, { path: 'C:\\Windows\\System32\\notepad.exe' })
ok(ob1.status === 403, `越界路径被拒（实际 ${ob1.status}）`)
ok(/Workspace|工作区/.test(ob1.body.error || ''), '错误信息说明了原因')

const ob2 = await callRoute(openRoute, { path: path.join(WS, 'COMP2011', 'nope.docx') })
ok(ob2.status === 404, `文件不存在报 404（实际 ${ob2.status}）`)

const ob3 = await callRoute(openRoute, {})
ok(ob3.status === 400, '没给 path 报 400')

/* ---------------------------------------------------- 23. 中间格式不进资料库 */
// 原则：「模型 / 脚本之间用什么格式」跟「用户拿到什么」是两件事。
// md 和练习卷的 json 都属于前者 —— 落在 .build，资料目录里只有 docx/pdf/pptx。
console.log('\n[23] 中间格式落在 .build，不污染资料目录')
const pipeline = await import('./lib/pipeline.js')

const midNote = pipeline.composeNote('ITP3904', [{
  name: 'x.pdf', lecture: 'Lec 1',
  topics: [{ lecture: 'Lec 1', title: '测试知识点', titleEn: 'Test', summary: '', points: [] }],
  cards: [], note: '',
}], { scope: 'Lec1' })
ok(midNote.startsWith('# '), '笔记正文（md）能生成 —— 内部照旧用 md')

// 练习卷的 json 应该在 .build/papers 下，listPapers 能读到
const pDir = path.join(core.studyRoot(), 'ITP3904', '.build', 'papers')
fs.mkdirSync(pDir, { recursive: true })
const midPaper = path.join(pDir, 'ITP3904_Ch1_练习卷_2026-11-11.json')
fs.writeFileSync(midPaper, JSON.stringify({
  meta: { moduleCode: 'ITP3904' },
  sections: [{ id: 'A', prefix: 'A', name: 'Section A', questions: [{ stem: 'q1', marks: 5, answer: 'a1' }] }],
}), 'utf8')

const found = grade.listPapers('ITP3904')
ok(found.some((p) => p.path === midPaper), '.build 里的练习卷能被找到')
ok(found.find((p) => p.path === midPaper).legacy === false, '标记为新位置（非 legacy）')

// 老的 3_练习题 里的 json 仍然要能读（向后兼容）
const legacyDir = path.join(WS, 'ITP3904', '3_练习题')
fs.writeFileSync(path.join(legacyDir, 'old-paper.json'), JSON.stringify({
  meta: {}, sections: [{ id: 'A', prefix: 'A', name: 'A', questions: [{ stem: 'q', marks: 1, answer: 'a' }] }],
}), 'utf8')
const found2 = grade.listPapers('ITP3904')
ok(found2.some((p) => p.name === 'old-paper.json' && p.legacy === true), '老位置的 json 也读得到（兼容）')

/* ---------------------------------------------------- 24. 笔记清单可编辑 */
console.log('\n[24] 笔记清单：规则判定 / 手动加入 / 手动移除')
const notesMod = await import('./lib/notes.js')

const fakeSubject = {
  code: 'ITP3907',
  sections: {
    lecture: {
      files: [
        { name: '普通讲义.docx', path: path.join(WS, 'ITP3907', 'a.docx'), ext: 'docx', origin: 'source', mtime: '2026-11-01' },
        { name: '我的笔记.docx', path: path.join(WS, 'ITP3907', 'b.docx'), ext: 'docx', origin: 'source', mtime: '2026-11-02' },
        { name: 'machine-output.pdf', path: path.join(WS, 'ITP3907', 'c.pdf'), ext: 'pdf', origin: 'generated', mtime: '2026-11-03' },
        { name: '随手写的.docx', path: path.join(WS, 'ITP3907', 'd.docx'), ext: 'docx', origin: 'source', mtime: '2026-11-04' },
      ],
    },
  },
}

// ① 纯规则
const clean = notesMod.classifyNotes(fakeSubject, { include: {}, exclude: {} })
ok(clean.list.length === 2, `默认算 2 份笔记（实际 ${clean.list.length}）`)
ok(clean.list.some((f) => f.name === '我的笔记.docx' && f.origin === 'name'), '名字命中 → 算笔记')
ok(clean.list.some((f) => f.name === 'machine-output.pdf' && f.origin === 'generated'), 'DSH 生成 → 算笔记')
ok(clean.candidates.length === 2, `另外 2 个进候选（实际 ${clean.candidates.length}）`)
ok(clean.list.every((f) => !!f.reason), '每条都带「为什么算笔记」的原因')

// ② 手动加入一个候选
notesMod.setNoteFlag('ITP3907', { filePath: fakeSubject.sections.lecture.files[3].path, action: 'add' })
const withAdd = notesMod.classifyNotes(fakeSubject, notesMod.readNotesCfg('ITP3907'))
ok(withAdd.list.length === 3, `加了 1 个 → 3 份（实际 ${withAdd.list.length}）`)
ok(withAdd.list.some((f) => f.name === '随手写的.docx' && f.origin === 'manual'), '手动加入的标 manual')
ok(withAdd.list[0].origin === 'manual', '手动加入的排最前')

// ③ 手动移除一个本来是笔记的（纠正规则误判）
notesMod.setNoteFlag('ITP3907', { filePath: fakeSubject.sections.lecture.files[1].path, action: 'remove' })
const withRemove = notesMod.classifyNotes(fakeSubject, notesMod.readNotesCfg('ITP3907'))
ok(!withRemove.list.some((f) => f.name === '我的笔记.docx'), '手动移除后不在列表里')
ok(withRemove.candidates.some((f) => f.name === '我的笔记.docx'), '移到候选区（文件没删，还能加回来）')
ok(withRemove.list.length === 2, `2 份（实际 ${withRemove.list.length}）`)

// ④ 恢复自动判定
notesMod.setNoteFlag('ITP3907', { filePath: fakeSubject.sections.lecture.files[1].path, action: 'auto' })
const restored = notesMod.classifyNotes(fakeSubject, notesMod.readNotesCfg('ITP3907'))
ok(restored.list.some((f) => f.name === '我的笔记.docx' && f.origin === 'name'), '恢复后又按名字算笔记')

ok(fs.existsSync(notesMod.notesCfgPath('ITP3907')), 'notes.json 落盘')

/* ---------------------------------------------------- 25. 生成偏好 */
console.log('\n[25] 生成偏好：读 / 写 / 翻译成 prompt')
const prefsMod = await import('./lib/prefs.js')

const dflt = prefsMod.readPrefs()
ok(dflt.diagram === 'some' && dflt.examples === '1', '默认值合理')
ok(prefsMod.PREFS_SCHEMA.length >= 4, `选项表有 ${prefsMod.PREFS_SCHEMA.length} 组`)

// 只改一个字段，其余保持不变
const after1 = prefsMod.writePrefs({ diagram: 'lots' })
ok(after1.diagram === 'lots', '改了 diagram')
ok(after1.examples === dflt.examples, '没传的字段保持不变')

// 非法值被忽略（不能把 prompt 弄坏）
const after2 = prefsMod.writePrefs({ diagram: 'evil', verbosity: 'detailed' })
ok(after2.diagram === 'lots', '非法值被忽略，保留旧值')
ok(after2.verbosity === 'detailed', '合法值正常写入')

// 落到 prompt：选项必须真的改变输出要求
const promptLot = prefsMod.prefsToPrompt({ diagram: 'lots', examples: '3', verbosity: 'detailed', bilingual: 'both', formulas: 'steps' })
ok(/图示优先/.test(promptLot), '「多图示」写进了 prompt')
ok(/ASCII 示意图/.test(promptLot), '提示了怎么画（ASCII）')
ok(/3 道例题/.test(promptLot), '例题数量写进了 prompt')
ok(/详细模式/.test(promptLot), '详略写进了 prompt')
ok(/中英并排/.test(promptLot), '中英要求写进了 prompt')
ok(/分步推导/.test(promptLot), '公式要求写进了 prompt')

const promptFew = prefsMod.prefsToPrompt({ diagram: 'few', examples: '1', verbosity: 'brief', bilingual: 'term', formulas: 'plain' })
ok(!/图示优先/.test(promptFew), '「少图示」不会要求图示优先')
ok(/图能省则省/.test(promptFew), '「少图示」有对应的指令')
ok(/精简模式/.test(promptFew), '精简模式生效')
ok(/LaTeX|普通文本/.test(promptFew), '公式给了普通文本要求')

ok(fs.existsSync(prefsMod.prefsPath()), 'prefs.json 落盘')

/* ---------------------------------------------------- 26. 做题：缓存与状态 */
console.log('\n[26] 做题：选择题缓存 / 每题上次结果')
core.upsertSubject({ code: 'ITP3908', name: 'Quiz Test', root: path.join(WS, 'ITP3908') })
const qt = core.addTopics('ITP3908', [
  { lecture: 'Lec 1', title: '组合数', titleEn: 'Combination' },
  { lecture: 'Lec 1', title: '排列数', titleEn: 'Permutation' },
])
const qTopics = core.readTopics('ITP3908').topics
const qc = core.addCards('ITP3908', [
  { topicKey: qTopics[0].key, question: 'C(5,2) = ?', answer: '10', marks: 2 },
  { topicKey: qTopics[1].key, question: 'A(5,2) = ?', answer: '20', marks: 2 },
])
ok(qc.added === 2, '建了 2 张题卡')

const cardId = core.readCards('ITP3908').cards[0].id

// 把选择题形态写进卡片（模拟第一次做题后缓存下来）
const mcq = {
  stem: 'C(5,2) = ?',
  options: [{ id: 'A', text: '10' }, { id: 'B', text: '20' }],
  answerId: 'A',
  why: '10',
  trap: '算成排列',
}
const up = core.updateCard('ITP3908', cardId, { mcq })
ok(up.ok, 'updateCard 成功')
ok(core.readCards('ITP3908').cards[0].mcq.answerId === 'A', '选择题缓存住了')
ok(core.updateCard('ITP3908', 'no-such-card', { mcq }).ok === false, '卡不存在时返回 ok:false')

// 每次作答后，按 topic 记录「最近一次结果」
core.recordAttempt('ITP3908', { cardId, topicKey: qTopics[0].key, correct: true })
let qLast = core.lastAttemptByTopic('ITP3908')
ok(qLast[qTopics[0].key] && qLast[qTopics[0].key].correct === true, '答对 → 记录 correct=true')

core.recordAttempt('ITP3908', { cardId, topicKey: qTopics[0].key, correct: false })
qLast = core.lastAttemptByTopic('ITP3908')
ok(qLast[qTopics[0].key].correct === false, '再答错 → 覆盖成 false（取最后一次）')
ok(qLast[qTopics[1].key] === undefined, '没做过的题没有记录（列表打空心圈）')

/* ------------------------------------------------- 12. 整份文件翻译 */
// 后端那套「选文件 → 翻译 → 预览」的核心是两个纯函数：切段、按序号解析。
// 它们不碰模型，所以能在这儿直接测。
console.log('\n[12] 整份文件翻译：切段 + 序号解析')
const R = await import('./lib/routes.js')

const sp = R.splitSegments('Para one\nstill one\n\nPara two\n\n\nPara three.', {})
ok(sp.segments.length === 3, '空行切段 → 3 段', JSON.stringify(sp.segments))
ok(sp.segments[0] === 'Para one\nstill one', '段内的单行换行保留')
ok(sp.truncated === false, '没超上限时 truncated=false')

const spLong = R.splitSegments('x'.repeat(5000), { maxChars: 1000 })
ok(spLong.truncated === true, '超过 maxChars 会截断')
ok(spLong.chars === 1000, '截断到 maxChars')
ok(spLong.total === 5000, 'total 记的是原文全长')

const spHard = R.splitSegments('word '.repeat(400), { maxSegChars: 200 })
ok(spHard.segments.every((x) => x.length <= 200), '没有单段超过 maxSegChars',
  spHard.segments.map((x) => x.length).join(','))
ok(spHard.segments.length >= 3, '一整行长文本会被硬切成多段')

const pj = R.parseIndexed('[{"i":0,"v":"甲"},{"i":2,"v":"乙"}]')
ok(pj.length === 2 && pj[0].i === 0 && pj[1].v === '乙', '解析标准 JSON 数组')

const pjF = R.parseIndexed('好的：\n```json\n[{"i":1,"v":"A \\"q\\" B"}]\n```')
ok(pjF.length === 1 && pjF[0].v === 'A "q" B', '代码块里带转义的 JSON 也认')

const pjL = R.parseIndexed('{"i":3,"v":"丙"}\n{"i":4,"v":"丁"}')
ok(pjL.length === 2 && pjL[1].i === 4, '零散对象走兜底正则')

const pjBad = R.parseIndexed('完全不是 JSON 的一段话')
ok(Array.isArray(pjBad) && pjBad.length === 0, '乱字符串返回空数组（调用方会记 bad-index）')

/* ---------------------------------------------------- 20. 日期按本地时区 */
// 旧代码用 toISOString().slice(0,10)，那是 UTC 日期。
// 在香港（UTC+8）凌晨 0~8 点，UTC 还停在前一天 —— 熬夜复习的人当天没有题可做，
// 考试倒计时还多一天。这条断言在 UTC 时区的 CI 上恒真，但本地一跑就能抓回来。
console.log('\n[22] 日期：本地时区，不是 UTC')
const nowD = new Date()
const pad2 = (n) => String(n).padStart(2, '0')
const localToday = `${nowD.getFullYear()}-${pad2(nowD.getMonth() + 1)}-${pad2(nowD.getDate())}`
ok(core.today() === localToday, `today() 是本地日期（${core.today()}）`)
ok(/^\d{4}-\d{2}-\d{2}$/.test(core.today()), 'today() 格式是 YYYY-MM-DD')
ok(core.dayOf(nowD.getTime()) === localToday, 'dayOf(now) 和 today() 一致')
ok(core.dayOf(Date.parse('2026-01-02T03:04:05Z')).length === 10, 'dayOf 接受任意时间戳')

/* ---------------------------------------------------- 23. 备份 / 恢复 */
console.log('\n[23] 备份 / 恢复（换机器就靠它）')
const backupRoutes = routesMod.makeRoutes({}, () => null)
const bRoute = backupRoutes.find((r) => r.path === routesMod.ROUTES.backup)
const bRes = await callRoute(bRoute, {}, 'GET')
ok(bRes.status === 200 && bRes.body.format === 'dsh-study-coach-backup', '导出的 JSON 有 format 标记')
const bFiles = Object.keys(bRes.body.files || {})
ok(bFiles.length > 0, `导出带上了 ${bFiles.length} 个文件`)
ok(bFiles.some((k) => k.startsWith('COMP2011/')), '文件按 <科目>/<文件> 组织')
const rRoute = backupRoutes.find((r) => r.path === routesMod.ROUTES.restore)
const rRes = await callRoute(rRoute, bRes.body)
ok(rRes.status === 200 && rRes.body.restored === bFiles.length, `原样恢复 ${rRes.body.restored} 个文件`)
const badRes = await callRoute(rRoute, { nope: true })
ok(badRes.status === 400, '不是备份文件时拒绝（400）')

/* ---------------------------------------------------- 24. 提炼失败自动救回 */
console.log('\n[24] 提炼：坏 JSON 自动重试 / 长文本拆半')
const pipe2 = await import('./lib/pipeline.js')
const mkJob = () => ({ state: 'running', logs: [], errors: [], progress: {}, out: {} })

// ① 第一次吐坏 JSON，第二次正常 → 应该自己重试成功
let calls = 0
const flaky = {
  logger: { warn: () => {} },
  __runModel: async () => {
    calls++
    if (calls === 1) return { ok: true, answer: '这不是 JSON，是模型跑题了' }
    return {
      ok: true,
      answer: JSON.stringify({ topics: [{ lecture: 'Lec 1', title: 'T1' }], cards: [], note: 'n' }),
    }
  },
}
const rRetry = await pipe2.refineOne(flaky, mkJob(), { file: 'x.pdf', name: 'Lec1.pdf', text: 'aaaa' }, 0, 1, {})
ok(rRetry.ok === true, '第一次坏 JSON 后自动重试成功')
ok(rRetry.topics.length === 1, `拿到 ${rRetry.topics.length} 个知识点`)
ok(calls === 2, `一共调了 ${calls} 次模型`)

// ② 整份永远失败，但拆成两半各自能成 → 合并两段
let n = 0
const halves = {
  logger: { warn: () => {} },
  __runModel: async ({ user }) => {
    n++
    const body = String(user).split('--- 讲义正文开始 ---')[1] || ''
    // 只有「整份」才会超过 15000；拆半后每段约 10000，就能过
    if (body.length > 15000) return { ok: true, answer: '太长，吐不出来' }
    return {
      ok: true,
      answer: JSON.stringify({
        topics: [{ lecture: 'Lec 2', title: 'T' + n }],
        cards: [],
        note: '',
      }),
    }
  },
}
const longText = 'x'.repeat(10000) + '\n' + 'y'.repeat(10000)
const rSplit = await pipe2.refineOne(halves, mkJob(), { file: 'big.pdf', name: 'Lec2.pdf', text: longText }, 0, 1, {})
ok(rSplit.ok === true, '整份失败后拆半救回来了')
ok(rSplit.topics.length === 2, `两半各出一个知识点（实际 ${rSplit.topics.length}）`)

/* ---------------------------------------------------- 结果 */
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${pass}   失败 ${fail}`)
if (fail === 0) console.log('全部通过 ✅')
try {
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('临时目录已清理')
} catch {}
process.exit(fail === 0 ? 0 : 1)
