/**
 * dsh-study-coach - 让 DSH 变成一个管进度、会盯人的学习教练。
 *
 * 它不替你读讲义，它管的是「学没学会」这件事：
 *   知识点记账 → 按遗忘曲线排今天该复习什么 → 抽题 → 记对错 → 算掌握度
 *
 * Tools:
 *   study_subjects  - 有哪些科目、考试还有几天、整体掌握度
 *   study_add       - 登记一个科目（或按 Workspace 目录自动发现）
 *   study_topics    - 查看 / 写入某科目的知识点清单
 *   study_cards     - 查看 / 写入题卡
 *   study_plan      - 今天该复习哪几个知识点（按到期 + 掌握度排序）
 *   study_drill     - 按掌握度加权抽题，给出题面
 *   study_check     - 记一次作答，更新掌握度与下次复习日
 *   study_stats     - 掌握度报表（按章节、按分档、最薄弱的几个）
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import fs from 'node:fs'
import path from 'node:path'

const readdirSyncSafe = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }) } catch { return [] } }
const statSyncSafe = (p) => fs.statSync(p)
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'
import {
  makeRoutes, SECTIONS as SECTION_DEFS, resolveSectionDir, translateTopics, buildTree,
  runModel, loadLlmKit, badChannels, WORKSPACE,
} from './routes.js'
import { EXTRACT_EXT } from './extract.js'
import { pythonCaps } from './python.js'
import {
  dshHome, studyRoot, listSubjects, upsertSubject, getSubject, discoverSubjects,
  readTopics, addTopics, readCards, addCards, buildPlan, pickQuestions,
  recordAttempt, stats, today, dayOf,
  pendingTranslations, applyTranslations, setGeneratedFlag, resolveOrigin, readGenerated,
} from './core.js'

export const name = 'dsh-study-coach'
export const inject = ['tools', 'webServer']

const txt = (s) => [{ type: 'text', text: String(s) }]

/** 列目录里的文件（只要文件，跳过隐藏的和 Office 锁文件） */
function listFilesIn(dir) {
  const out = []
  if (!dir) return out
  let ents = []
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~$')) continue
    const full = path.join(dir, e.name)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    out.push({
      name: e.name,
      path: full,
      ext: path.extname(e.name).slice(1).toLowerCase(),
      size: st.size,
      sizeText: fmtSize(st.size),
    })
  }
  return out
}

/** job 去掉内部字段，给工具输出用 */
function publicJob(job) {
  return {
    id: job.id,
    code: job.code,
    state: job.state,
    step: job.step,
    progress: job.progress,
    out: job.out,
    errors: job.errors,
    ms: (job.finishedAt || Date.now()) - job.startedAt,
  }
}

function pct(m) {
  return `${Math.round((Number(m) || 0) * 100)}%`
}

function bar(m) {
  const n = Math.round((Number(m) || 0) * 10)
  return '█'.repeat(n) + '░'.repeat(10 - n)
}

export function apply(ctx) {
  /* ------------------------------------------------------- llm 软依赖 */
  // cords 的 ctx 是 Proxy：**没 inject 过的服务，读一下就抛**
  // 「cannot get property "llm" without inject」—— 这个异常从后台任务里
  // 冒成 unhandled rejection，会把整个 host 干掉（0.8.0 就是这么崩的）。
  //
  // 所以 llm 走动态注入：服务在，就拿一个合法 ctx；服务不在，面板照开，
  // 只是「问 / 翻译 / 一键生成」会明确说没模型，而不是拖垮 DSH。
  const llmRef = { ctx: null, ready: false }
  try {
    if (typeof ctx.inject === 'function') {
      // 写法照 @opencode2dsh/dsh-plugin：ctx.inject 可能返回 Promise 也可能返回值，
      // 一律 Promise.resolve 包一下；回调参数才是**合法**的、能直接读 .llm 的 ctx。
      Promise.resolve(
        ctx.inject(['llm'], (c) => {
          llmRef.ctx = c
          llmRef.ready = true
          // 这行是排查用的：DSH 日志里能看到 llm 到底注入成功没有
          try { console.warn('[study-coach] llm service injected') } catch {}
          return () => {
            llmRef.ctx = null
            llmRef.ready = false
          }
        }),
      ).catch((e) => {
        try { console.warn('[study-coach] llm inject failed:', e && e.message) } catch {}
      })
    }
  } catch (e) {
    try { console.warn('[study-coach] llm inject skipped:', e && e.message) } catch {}
  }
  /** 拿 llm 实例，拿不到返回 undefined —— 永远不抛 */
  const getLlm = () => {
    try {
      return llmRef.ctx ? llmRef.ctx.llm : undefined
    } catch {
      return undefined
    }
  }

  /* ------------------------------------------------ http routes */
  // 资源库的文件读写、上传、做题记录全部走这里，
  // 不再需要另起一个 node 进程，DSH 活着它就活着。
  try {
    const routes = makeRoutes(ctx, getLlm)
    ctx.effect(() => {
      const disposers = routes.map((r) => ctx.webServer.register(r))
      return () => {
        for (const d of disposers) {
          try { d() } catch {}
        }
      }
    }, 'study-coach: http routes')
  } catch (e) {
    try { console.warn('[study-coach] route mount failed:', e && e.message) } catch {}
  }

  /* ------------------------------------------------- study_library */
  ctx.tools.register(defineTool({
    name: 'study_library',
    description:
      'List the study library: every registered subject with the files sitting in each section ' +
      '(讲义 / Tutorial / 试卷 / 其他), plus note and question counts. Use this to see what ' +
      'material has been dropped in before reading or turning it into topics and cards.',
    parameters: {
      code: { type: 'string', description: 'Only show this subject (optional).' },
      section: {
        type: 'string',
        description: 'Only show this section: 讲义 / Tutorial / 试卷 / 其他 (optional).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}`)
        if (!v.subjects.length) return txt('资源库里还没有科目。先 study_add 登记一个。')
        const lines = []
        for (const s of v.subjects) {
          lines.push(`${s.code}  ${s.name || ''}   笔记 ${s.notes} / 题 ${s.cards}`)
          for (const [sec, files] of Object.entries(s.sections)) {
            if (!files.length) continue
            lines.push(`  ${sec}（${files.length}）`)
            for (const f of files) lines.push(`    · ${f.name}  ${f.sizeText}`)
          }
          if (!Object.values(s.sections).some((f) => f.length)) lines.push('  （还没有资料文件）')
          lines.push('')
        }
        if (v.unregistered.length) {
          lines.push('工作区里有目录但没登记：' + v.unregistered.join(', '))
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      const WS = WORKSPACE
      const list = (dir) => {
        let out = []
        try {
          for (const e of readdirSyncSafe(dir)) {
            if (!e.isFile() || e.name.startsWith('.')) continue
            let st
            try {
              st = statSyncSafe(path.join(dir, e.name))
            } catch {
              continue
            }
            out.push({
              name: e.name,
              size: st.size,
              sizeText: fmtSize(st.size),
              mtime: dayOf(st.mtimeMs),
            })
          }
        } catch {}
        return out.sort((a, b) => b.size - a.size)
      }

      const subjects = []
      for (const s of listSubjects()) {
        if (args.code && String(args.code).toUpperCase() !== String(s.code).toUpperCase()) continue
        const sections = {}
        for (const def of SECTION_DEFS) {
          if (args.section && args.section !== def.label && args.section !== def.key) continue
          const dir = resolveSectionDir(s.code, def.key)
          if (def.dynamic) {
            // 「其他目录」= 科目根下没被固定分区收走的文件，直接借 buildTree 的结果，别自己再走一遍
            try {
              const t = buildTree()
              const sub = (t.subjects || []).find((x) => x.code === s.code)
              const files = (sub && sub.sections && sub.sections[def.key] && sub.sections[def.key].files) || []
              sections[def.label] = files.map((f) => ({
                name: f.rel || f.name, size: f.size, sizeText: f.sizeText, mtime: f.mtime,
              }))
            } catch {
              sections[def.label] = []
            }
            continue
          }
          sections[def.label] = list(dir)
        }
        subjects.push({
          code: s.code,
          name: s.name,
          notes: readTopics(s.code).topics.length,
          cards: readCards(s.code).cards.length,
          sections,
        })
      }

      const known = new Set(listSubjects().map((s) => String(s.code).toUpperCase()))
      const unregistered = (args.code || args.section ? [] : discoverSubjects(WS))
        .filter((d) => !known.has(d.code))
        .map((d) => d.code)

      return { ok: true, subjects, unregistered }
    },
  }))

  /* ---------------------------------------------------- study_subjects */
  ctx.tools.register(defineTool({
    name: 'study_subjects',
    description:
      'List every subject registered with the study coach, with exam date, days remaining, ' +
      'topic count and average mastery. Also reports subject folders found in the workspace ' +
      'that are not registered yet, so they can be added in one call.',
    parameters: {
      scanWorkspace: {
        type: 'string',
        description: 'Optional workspace root to scan for folders like COMP2011 (defaults to the configured workspace).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        const lines = []
        lines.push(`学习数据目录  ${v.root}`)
        if (!v.subjects.length) {
          lines.push('还没有登记任何科目。')
        } else {
          for (const s of v.subjects) {
            const left = s.daysLeft === null ? '未设考试日' : `还有 ${s.daysLeft} 天`
            lines.push(
              `· ${s.code}  ${s.name}   ${left}   知识点 ${s.totalTopics}   平均掌握 ${pct(s.avgMastery)}`,
            )
          }
        }
        if (v.unregistered.length) {
          lines.push('')
          lines.push('工作区里发现但还没登记的：')
          for (const u of v.unregistered) lines.push(`  + ${u.code}  (${u.fileCount} 个文件)  ${u.root}`)
          lines.push('  用 study_add 登记它们。')
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      const root = studyRoot()
      const registered = listSubjects().map((s) => {
        const code = s.code
        const topicsData = readTopics(code)
        const total = topicsData.topics.length
        const avg = total
          ? topicsData.topics.reduce((a, x) => a + (x.mastery ?? 0), 0) / total
          : 0
        let daysLeft = null
        if (s.examDate) {
          const d = Math.round(
            (new Date(s.examDate + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000,
          )
          daysLeft = d
        }
        return { ...s, totalTopics: total, avgMastery: Number(avg.toFixed(3)), daysLeft }
      })

      const scanRoot = args.scanWorkspace || WORKSPACE
      const found = discoverSubjects(scanRoot)
      const have = new Set(listSubjects().map((s) => String(s.code).toUpperCase()))
      const unregistered = found.filter((f) => !have.has(f.code))

      return { ok: true, root, subjects: registered, unregistered }
    },
  }))

  /* --------------------------------------------------------- study_add */
  ctx.tools.register(defineTool({
    name: 'study_add',
    description:
      'Register a subject with the study coach, or update its exam date / name / note. ' +
      'Use the subject code as the key, e.g. COMP2011.',
    parameters: {
      code: { type: 'string', description: 'Subject code, e.g. COMP2011.' },
      name: { type: 'string', description: 'Human name, e.g. Discrete Mathematics & Statistics.' },
      root: { type: 'string', description: 'Folder holding the course materials.' },
      examDate: { type: 'string', description: 'Exam date YYYY-MM-DD.' },
      note: { type: 'string', description: 'Any free note.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) =>
        v.ok
          ? txt(`已登记 ${v.subject.code}  ${v.subject.name}\n考试日 ${v.subject.examDate || '（未设）'}\n材料目录 ${v.subject.root || '（未设）'}`)
          : txt(`登记失败：${v.error}`),
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      const s = upsertSubject(args)
      return { ok: true, subject: s }
    },
  }))

  /* ------------------------------------------------------ study_topics */
  ctx.tools.register(defineTool({
    name: 'study_topics',
    description:
      'List the topics of a subject, or add new ones. Each topic is one testable idea ' +
      '(one lecture section). Adding is idempotent: existing keys are skipped.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
      add: {
        type: 'array',
        description: 'Topics to add: [{lecture, title, titleEn?}]',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lecture: { type: 'string' },
            title: { type: 'string' },
            titleEn: { type: 'string' },
            key: { type: 'string' },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}`)
        const lines = []
        if (v.added !== null) lines.push(`新增 ${v.added} 个知识点，现有 ${v.total} 个。`)
        for (const t of v.topics) {
          lines.push(`${(t.lecture || '?').padEnd(7)} ${bar(t.mastery)} ${pct(t.mastery).padStart(4)}  到期 ${t.due}   ${t.title}`)
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      let added = null
      let total = null
      if (Array.isArray(args.add) && args.add.length) {
        const r = addTopics(args.code, args.add)
        added = r.added
        total = r.total
      }
      const data = readTopics(args.code)
      return { ok: true, added, total, topics: data.topics }
    },
  }))

  /* ------------------------------------------------------- study_cards */
  ctx.tools.register(defineTool({
    name: 'study_cards',
    description:
      'List question cards of a subject, or add new ones. A card is one question with its answer, ' +
      'attached to a topic key.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
      add: {
        type: 'array',
        description: 'Cards to add: [{topicKey, question, answer, marks?, source?}]',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            topicKey: { type: 'string' },
            question: { type: 'string' },
            answer: { type: 'string' },
            marks: { type: 'number' },
            source: { type: 'string' },
            id: { type: 'string' },
          },
        },
      },
      limit: { type: 'number', description: 'How many to list (default 30).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}`)
        const lines = []
        if (v.added !== null) lines.push(`新增 ${v.added} 张卡，现有 ${v.total} 张。`)
        for (const c of v.cards) {
          lines.push(`[${c.id}] ${c.topicKey}  ${c.question}`)
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      let added = null
      let total = null
      if (Array.isArray(args.add) && args.add.length) {
        const r = addCards(args.code, args.add)
        added = r.added
        total = r.total
      }
      const data = readCards(args.code)
      const limit = Math.max(1, Number(args.limit) || 30)
      return { ok: true, added, total, cards: data.cards.slice(0, limit) }
    },
  }))

  /* -------------------------------------------------------- study_plan */
  ctx.tools.register(defineTool({
    name: 'study_plan',
    description:
      'Build today\'s study plan for a subject: which topics are due now (sorted by weakest first), ' +
      'how many minutes it needs, and what is coming up next.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
      perDay: { type: 'number', description: 'How many topics you are willing to do today (default 8).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}`)
        const p = v.plan
        const lines = []
        const head = p.daysLeft === null ? '' : ` · 距考试 ${p.daysLeft} 天`
        lines.push(`${p.code} ${p.name}   ${p.today}${head}`)
        lines.push(
          `知识点 ${p.totalTopics} 个，平均掌握 ${pct(p.avgMastery)}，` +
            `待复习 ${p.reviewCount} 个 / 未学 ${p.freshCount} 个`,
        )
        if (p.perDayNeeded) {
          lines.push(`要在考前过完，平均每天至少 ${p.perDayNeeded} 个（还剩 ${p.remaining} 个没掌握）`)
        }
        lines.push('')

        if (!p.todayList.length) {
          lines.push('今天没有到期的 —— 要么全掌握了，要么还没登记知识点。')
        } else {
          lines.push(`今天做这 ${p.todayList.length} 个（约 ${p.estimatedMinutes} 分钟）：`)
          if (p.reviewList.length) {
            lines.push('  【该复习了】')
            for (const t of p.reviewList) {
              lines.push(`    ${bar(t.mastery)} ${pct(t.mastery).padStart(4)}  ${(t.lecture || '?').padEnd(7)} ${t.title}`)
            }
          }
          if (p.freshList.length) {
            lines.push('  【还没学过】')
            for (const t of p.freshList) {
              lines.push(`    ${bar(t.mastery)} ${pct(t.mastery).padStart(4)}  ${(t.lecture || '?').padEnd(7)} ${t.title}`)
            }
          }
        }
        if (p.upcoming.length) {
          lines.push('')
          lines.push('接下来到期：')
          for (const t of p.upcoming) lines.push(`  ${t.due}  ${t.title}`)
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      if (!getSubject(args.code)) return { ok: false, error: `科目 ${args.code} 未登记，先 study_add` }
      const plan = buildPlan(args.code, { perDay: args.perDay })
      return { ok: true, plan }
    },
  }))

  /* ------------------------------------------------------- study_drill */
  ctx.tools.register(defineTool({
    name: 'study_drill',
    description:
      'Pull N question cards for a subject, weighted towards topics with low mastery. ' +
      'Returns the questions only (answers withheld so you can try first). ' +
      'Call study_check afterwards with the result of each card.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
      count: { type: 'number', description: 'How many questions (default 5).' },
      topicKeys: {
        type: 'array',
        description: 'Restrict to these topic keys.',
        items: { type: 'string' },
      },
      withAnswers: { type: 'boolean', description: 'Include answers in the output (default false).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}`)
        if (!v.cards.length) {
          return txt(
            v.reason === 'no-cards'
              ? '这个科目还没有题卡。用 study_cards 把题目加进去。'
              : '这些知识点下没有题卡。',
          )
        }
        const lines = [`${v.code} 抽题 ${v.cards.length} 道：`]
        v.cards.forEach((c, i) => {
          lines.push('')
          lines.push(`${i + 1}. ${c.question}`)
          if (c.marks) lines.push(`   （${c.marks} 分）`)
          if (v.withAnswers) lines.push(`   → ${c.answer}`)
        })
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      const r = pickQuestions(args.code, { count: args.count, topicKeys: args.topicKeys })
      const withAnswers = !!args.withAnswers
      return {
        ok: true,
        code: String(args.code).toUpperCase(),
        reason: r.reason,
        withAnswers,
        cards: r.cards.map((c) => ({
          id: c.id,
          topicKey: c.topicKey,
          question: c.question,
          answer: withAnswers ? c.answer : undefined,
          marks: c.marks,
        })),
      }
    },
  }))

  /* ------------------------------------------------------- study_check */
  ctx.tools.register(defineTool({
    name: 'study_check',
    description:
      'Record the result of one question. Updates the topic mastery (+0.15 correct / -0.25 wrong) ' +
      'and schedules the next review by spaced repetition. Pass the card id, or the topic key.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
      cardId: { type: 'string', description: 'Card id from study_drill.' },
      topicKey: { type: 'string', description: 'Topic key (if you know it directly).' },
      correct: { type: 'boolean', description: 'true if the answer was right.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`没记上：${v.reason === 'topic-not-found' ? '找不到这个知识点' : v.reason}`)
        const arrow = v.correct ? '✅ 对' : '❌ 错'
        return txt(
          `${v.code}  ${v.title}\n${arrow}   掌握度 ${pct(v.masteryBefore)} → ${pct(v.masteryAfter)}\n` +
            `下次复习：${v.nextDue}（${v.intervalDays} 天后）`,
        )
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, reason: 'code 必填' }
      const r = recordAttempt(args.code, {
        cardId: args.cardId,
        topicKey: args.topicKey,
        correct: args.correct,
      })
      return r
    },
  }))

  /* ------------------------------------------------------- study_stats */
  ctx.tools.register(defineTool({
    name: 'study_stats',
    description:
      'Mastery report for a subject: overall, by mastery band, by lecture, and the weakest topics ' +
      'to attack first.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}`)
        const s = v.stats
        const lines = []
        lines.push(`${s.code}  知识点 ${s.totalTopics} 个 / 学过 ${s.studied} 个 / 今天到期 ${s.dueNow} 个`)
        lines.push(`平均掌握 ${pct(s.avgMastery)}  ${bar(s.avgMastery)}`)
        lines.push('')
        lines.push('分档：')
        for (const b of s.byBucket) lines.push(`  ${b.name.padEnd(14)} ${b.count}`)
        if (s.lectureRows.length) {
          lines.push('')
          lines.push('按章节：')
          for (const r of s.lectureRows) {
            lines.push(`  ${String(r.lecture).padEnd(8)} ${bar(r.avg)} ${pct(r.avg).padStart(4)}   稳固 ${r.mastered}/${r.total}`)
          }
        }
        if (s.weak.length) {
          lines.push('')
          lines.push('最该补的：')
          for (const w of s.weak) lines.push(`  ${pct(w.mastery).padStart(4)}  ${w.title}`)
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      return { ok: true, stats: stats(args.code) }
    },
  }))

  /* ----------------------------------------------------- study_generate */
  // 一条流水线：讲义 → 抽文本 → 提炼知识点/题卡 → 出笔记 / 总结 / 速记 / Word / PPT。
  // 面板上是异步轮询，这里给 AI 用就同步等完再回结果（超时给 5 分钟）。
  ctx.tools.register(defineTool({
    name: 'study_generate',
    description:
      'Turn lecture files into study material in one run: extract the text of each lecture ' +
      '(PDF/PPTX/DOCX), ask the model for topics + question cards + a note, write them into ' +
      'topics.json/cards.json, then produce a note, a summary, a crib sheet, a .docx and a .pptx ' +
      'in the subject\'s review folder. Call study_library first to see what lecture files exist. ' +
      'Long running (a minute per few files); pass wait=false to only start it and poll later.',
    parameters: {
      code: { type: 'string', description: 'Subject code, e.g. COMP2011.' },
      files: {
        type: 'array',
        description: 'Lecture file paths to use. Omit to take every supported file in the lecture section.',
        items: { type: 'string' },
      },
      want: {
        type: 'object',
        description: 'Which outputs to produce: {note, summary, cheatsheet, docx, pptx}. Default all but cheatsheet.',
        additionalProperties: true,
      },
      seedTopics: {
        type: 'boolean',
        description: 'Write the extracted topics/cards into the library (default true).',
      },
      wait: { type: 'boolean', description: 'Wait until it finishes (default true).' },
      timeoutMs: { type: 'number', description: 'Max wait in ms when wait=true (default 300000).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}${v.detail ? '（' + v.detail + '）' : ''}`)
        const j = v.job
        const lines = []
        lines.push(`流水线 ${j.id} · ${j.code} · ${j.state}`)
        lines.push(`步骤：${j.step}　进度 ${j.progress.done}/${j.progress.total}`)
        lines.push(`知识点 +${j.out.topics}　题卡 +${j.out.cards}　文件 ${j.out.files.length} 个`)
        if (j.out.files.length) {
          lines.push('')
          for (const f of j.out.files) lines.push(`  · ${f.kind.padEnd(10)} ${f.name}`)
        }
        if (j.errors.length) {
          lines.push('')
          lines.push('有失败：')
          for (const e of j.errors.slice(0, 6)) lines.push(`  · [${e.stage}] ${e.name || e.file || ''} ${e.error || ''}`)
        }
        if (v.logs && v.logs.length) {
          lines.push('')
          lines.push('日志（末尾）：')
          for (const l of v.logs.slice(-12)) lines.push('  ' + l.text)
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      const code = String(args.code).toUpperCase()

      // 没给文件就用讲义分区里所有能抽的类型
      let files = Array.isArray(args.files) ? args.files.slice() : []
      if (!files.length) {
        const dir = resolveSectionDir(code, 'lecture')
        files = listFilesIn(dir).filter((f) => EXTRACT_EXT.includes(f.ext)).map((f) => f.path)
      }
      if (!files.length) {
        return { ok: false, error: 'no-sources', detail: '讲义分区里没有 pdf/pptx/docx 文件，先把讲义放进「讲义」分区' }
      }

      const pipeline = await import('./pipeline.js')
      const job = pipeline.startPipeline(
        { __runModel: (a) => runModel(ctx, { ...a, llm: getLlm() }), logger: ctx?.logger },
        { code, files, want: args.want || {}, seedTopics: args.seedTopics !== false },
      )

      if (args.wait === false) {
        return { ok: true, job: publicJob(job), logs: [] }
      }

      const deadline = Date.now() + (Number(args.timeoutMs) || 300000)
      while (!job.finishedAt && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200))
      }
      return {
        ok: true,
        job: publicJob(job),
        logs: job.logs.slice(-30),
        timedOut: !job.finishedAt,
      }
    },
  }))

  /* ------------------------------------------------------- study_paper */
  // 照校内真卷的版式出练习卷：先解析真卷骨架，再按章节范围填题。
  // 这条是主人明确要求的 —— 不许自创版式，题型/分值/题号/页眉页脚全照原卷。
  ctx.tools.register(defineTool({
    name: 'study_paper',
    description:
      'Generate a practice paper that copies the FORMAT of a real past paper: same sections, ' +
      'question numbering, marks per question, header/footer, language and phrasing. Only the ' +
      'questions change, and they are drawn from the chapter range you pass. ' +
      'First call with analyze=true (and template=<past paper path>) to extract the format skeleton; ' +
      'after that, calling it with from/to generates a paper. Produces a blank paper plus an answer key in the practice folder.',
    parameters: {
      code: { type: 'string', description: 'Subject code, e.g. COMP2011.' },
      template: {
        type: 'string',
        description: 'Path of the real past paper to copy the format from (needed with analyze=true, or when none is cached).',
      },
      analyze: {
        type: 'boolean',
        description: 'Only analyse the template and cache its skeleton (default false).',
      },
      from: { type: 'number', description: 'First chapter number to draw questions from, e.g. 1.' },
      to: { type: 'number', description: 'Last chapter number, e.g. 5.' },
      answers: { type: 'boolean', description: 'Also produce an answer key (default true).' },
      wait: { type: 'boolean', description: 'Wait until finished (default true).' },
      timeoutMs: { type: 'number', description: 'Max wait in ms when wait=true (default 300000).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}${v.detail ? '（' + v.detail + '）' : ''}`)
        if (v.template) {
          const t = v.template
          const lines = [`版式解析完成：${t.sourceName}`]
          lines.push(`科目：${t.meta?.moduleCode || ''} ${t.meta?.moduleTitle || ''}　${t.meta?.paperName || ''}`)
          for (const s of t.sections) {
            lines.push(`  ${s.name}：${s.questionCount} 题${s.marksPerQuestion ? ` · 每题 ${s.marksPerQuestion} 分` : ''}${s.marks ? ` · 共 ${s.marks} 分` : ''}`)
          }
          if (t.sections.some((s) => s.samples && s.samples.length)) {
            lines.push('')
            lines.push('出题口吻样本：')
            for (const s of t.sections) {
              if (s.samples && s.samples[0]) lines.push('  · ' + String(s.samples[0]).slice(0, 160))
            }
          }
          return txt(lines.join('\n'))
        }
        const j = v.job
        const lines = [
          `练习卷 ${j.id} · ${j.code} · ${j.state}`,
          `步骤：${j.step}　进度 ${j.progress.done}/${j.progress.total}`,
          `题数 ${j.out.cards}　文件 ${j.out.files.length} 个`,
        ]
        if (j.out.files.length) {
          lines.push('')
          for (const f of j.out.files) {
            lines.push(`  · ${f.kind === 'paper' ? '试卷' : '答案'}  ${f.name}${f.questions ? `（${f.questions} 题 / ${f.marks} 分）` : ''}`)
          }
        }
        if (j.errors.length) {
          lines.push('')
          lines.push('有失败：')
          for (const e of j.errors.slice(0, 6)) lines.push(`  · [${e.stage}] ${e.name || e.section || ''} ${e.error || ''}`)
        }
        if (v.logs && v.logs.length) {
          lines.push('')
          for (const l of v.logs.slice(-10)) lines.push('  ' + l.text)
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      const code = String(args.code).toUpperCase()
      const paper = await import('./paper.js')
      const runModelFor = (a) => runModel(ctx, { ...a, llm: getLlm() })

      if (args.analyze) {
        if (!args.template) return { ok: false, error: 'template 必填', detail: '要指定一份真卷当模板' }
        const r = await paper.analyzeTemplate({ __runModel: runModelFor }, { code, file: args.template })
        return r.ok ? { ok: true, template: r.template } : { ok: false, error: r.error, detail: r.detail }
      }

      // 没缓存就顺手分析一次
      if (!paper.readTemplate(code)) {
        if (!args.template) {
          return {
            ok: false, error: 'no-template',
            detail: '还没解析过版式。传 template=<真卷路径> 或者先 analyze=true 跑一次。',
          }
        }
        const r = await paper.analyzeTemplate({ __runModel: runModelFor }, { code, file: args.template })
        if (!r.ok) return { ok: false, error: r.error, detail: r.detail }
      }

      const job = paper.startPaper(
        { __runModel: runModelFor, logger: ctx?.logger },
        { code, from: args.from, to: args.to, answers: args.answers !== false, llm: getLlm() },
      )
      if (args.wait === false) return { ok: true, job: publicJob(job), logs: [] }

      const deadline = Date.now() + (Number(args.timeoutMs) || 300000)
      while (!job.finishedAt && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200))
      }
      return { ok: true, job: publicJob(job), logs: job.logs.slice(-30), timedOut: !job.finishedAt }
    },
  }))

  /* ------------------------------------------------------ study_health */
  // 一条命令看清「学习资源库」到底哪一环断了：llm 注入 / 哪个 provider 有模型 /
  // Python 能力 / 各项功能 ready。出问题时先跑它，别猜。
  ctx.tools.register(defineTool({
    name: 'study_health',
    description:
      'Diagnose the study coach: whether the llm service got injected, which provider/model will be ' +
      'used (and how many models every provider has), Python capabilities for PDF/DOCX/PPTX, and which ' +
      'features are ready. Run this first whenever translation, one-click generation or paper ' +
      'generation fails.',
    parameters: {
      verbose: { type: 'boolean', description: 'Also list every provider with its model count (default true).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        const L = []
        L.push('学习资源库自检')
        L.push(`llm 服务注入：${v.llm.injected ? '✅ 是' : '❌ 否（插件拿不到合法 ctx）'}`)
        if (v.llm.pinned) L.push(`手动钉死：${v.llm.pinned}`)
        L.push(`选中：${v.llm.selected.provider || '—'} / ${v.llm.selected.model || '—'}`)
        if (v.llm.perProvider && v.llm.perProvider.length) {
          L.push('各通道：')
          for (const p of v.llm.perProvider) {
            L.push(`  ${p.models > 0 ? '✅' : '❌'} ${String(p.id).padEnd(28)} ${p.models} 个模型${p.error ? '（' + p.error + '）' : ''}`)
          }
        }
        L.push(`SDK 可解析：${v.sdk.resolvable ? '✅' : '❌ @deepseek-ai/dsh-llm'}`)
        L.push(`Python：${v.python.path || '❌ 没找到'}${v.python.version ? '（' + v.python.version + '）' : ''}`)
        L.push(`  能力：pdf ${v.python.pdf ? '✅' : '❌'} / docx ${v.python.docx ? '✅' : '❌'} / pptx ${v.python.pptx ? '✅' : '❌'}`)
        L.push('')
        L.push('功能：')
        for (const [k, ok] of Object.entries(v.ready)) {
          L.push(`  ${ok ? '✅' : '❌'} ${k}`)
        }
        if (v.badChannels && v.badChannels.length) {
          L.push('')
          L.push('冷却中的通道（十分钟内排到最后）：')
          for (const b of v.badChannels) L.push(`  ⏸ ${b.id}  ${b.leftSec}s  ${b.why}`)
        }
        if (v.hint) {
          L.push('')
          L.push('提示：' + v.hint)
        }
        return txt(L.join('\n'))
      },
    },
    execute: async () => {
      const llm = getLlm()
      const perProvider = []
      let selected = { provider: '', model: '' }
      if (llm) {
        let ids = []
        try {
          ids = (typeof llm.listProviders === 'function' ? llm.listProviders() : [])
            .map((p) => p.id || p.provider)
            .filter(Boolean)
        } catch (e) {
          perProvider.push({ id: '(listProviders 失败)', models: 0, error: String(e && e.message).slice(0, 120) })
        }
        for (const id of ids) {
          let n = 0
          let first = ''
          let err = ''
          try {
            const ms = (await llm.listModels(id)) || []
            n = ms.length
            first = ms[0]?.id || ''
          } catch (e) {
            err = String((e && e.message) || e).slice(0, 100)
          }
          perProvider.push({ id, models: n, first, error: err })
          if (n > 0 && !selected.provider) selected = { provider: id, model: first }
        }
      }

      const kit = await loadLlmKit()
      const caps = await pythonCaps()
      const ready = {
        '问 AI（study 面板）': !!llm && !!kit && !!selected.provider,
        '中英翻译': !!llm && !!kit && !!selected.provider,
        '一键生成（讲义→笔记/PPT）': !!llm && !!kit && !!caps.path && !!selected.provider,
        '出练习卷': !!llm && !!kit && !!selected.provider,
        'Word 导出': !!caps.docx,
        'PPT 导出': !!caps.pptx,
        'PDF 抽文本': !!caps.pdf,
      }
      let hint = ''
      if (!llm) hint = '插件没拿到 llm：检查 DSH 日志里有没有 [study-coach] llm service injected。'
      else if (!selected.provider) hint = '所有 provider 都没有模型。DSH 设置→模型里看哪个通道有额度；也可以用 DSH_STUDY_MODEL=provider/model 手动指定。'
      else if (!caps.path) hint = '没找到 Python：设 DSH_STUDY_PYTHON 指向一个装了 pymupdf/python-docx/python-pptx 的解释器。'

      return {
        ok: true,
        badChannels: badChannels(),
        llm: {
          injected: !!llm,
          pinned: process.env.DSH_STUDY_MODEL || '',
          selected,
          perProvider,
        },
        sdk: { resolvable: !!kit },
        python: {
          path: caps.path, source: caps.source, version: caps.version,
          pdf: caps.pdf, docx: caps.docx, pptx: caps.pptx,
        },
        ready,
        hint,
      }
    },
  }))

  /* --------------------------------------------------- study_translate */  // 中英对照是这套资料的硬要求（全英文考卷），所以翻译做成正式工具，
  // 不是让 AI 在对话里手打一遍。翻译结果写回 topics.json，面板和文档立刻能用。
  ctx.tools.register(defineTool({
    name: 'study_translate',
    description:
      'Fill in the missing language of a subject\'s topics: target=en turns the Chinese title into ' +
      'titleEn, target=zh goes the other way. Uses the DSH model service, writes back to topics.json. ' +
      'dryRun=true only reports how many entries are waiting. Bilingual material is required for ' +
      'English-exam courses, so run this after adding topics.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
      target: {
        type: 'string',
        description: "Direction: 'en' (Chinese → English) or 'zh' (English → Chinese). Default en.",
      },
      keys: {
        type: 'array',
        description: 'Only translate these topic keys (optional).',
        items: { type: 'string' },
      },
      force: {
        type: 'boolean',
        description: 'Also retranslate entries that already have the other language (default false).',
      },
      dryRun: { type: 'boolean', description: 'Only report the pending count (default false).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}${v.detail ? '（' + v.detail + '）' : ''}`)
        if (v.dryRun) {
          return txt(`${v.code} 待翻译 ${v.pending} 条（${v.target === 'en' ? '中→英' : '英→中'}）`)
        }
        const lines = [
          `${v.code} ${v.target === 'en' ? '中→英' : '英→中'}`,
          `待翻 ${v.pending} 条 / 模型返回 ${v.translated} 条 / 写回 ${v.updated} 条 / 对不上 ${v.unmatched} 条`,
        ]
        if (v.pairs && v.pairs.length) {
          lines.push('')
          for (const p of v.pairs.slice(0, 20)) lines.push(`  ${p.k}  →  ${p.v}`)
          if (v.pairs.length > 20) lines.push(`  …还有 ${v.pairs.length - 20} 条`)
        }
        if (v.errors && v.errors.length) {
          lines.push('')
          lines.push('有分块失败：' + v.errors.map((e) => e.error).join(', '))
        }
        return txt(lines.join('\n'))
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      const target = args.target === 'zh' ? 'zh' : 'en'
      const pending = pendingTranslations(args.code, {
        target,
        keys: args.keys || [],
        force: !!args.force,
      })
      const items = pending
        .map((t) => ({ key: t.key, src: String(target === 'en' ? t.title : t.titleEn).trim() }))
        .filter((x) => x.src)

      if (args.dryRun) {
        return { ok: true, dryRun: true, code: args.code, target, pending: items.length }
      }
      if (!items.length) {
        return {
          ok: true, code: args.code, target, pending: 0,
          translated: 0, updated: 0, unmatched: 0, pairs: [], errors: [],
          note: '没有需要翻译的条目',
        }
      }

      const { pairs, errors } = await translateTopics(ctx, args.code, { items, target, llm: getLlm() })
      const applied = applyTranslations(args.code, { target, pairs })
      return {
        ok: true,
        code: args.code,
        target,
        pending: items.length,
        translated: pairs.length,
        updated: applied.updated,
        unmatched: applied.missing,
        pairs,
        errors,
      }
    },
  }))

  /* -------------------------------------------------------- study_mark */
  // 原件 / 生成物的来源判定。命名约定会判错（老师真发个「总结.pdf」），所以给个手工纠正的口子。
  ctx.tools.register(defineTool({
    name: 'study_mark',
    description:
      'Set whether a library file counts as DSH-generated or as an original source document. ' +
      'generated=true marks it AI-made, false marks it an original, omit to fall back to the ' +
      'filename heuristic. Needed when the name-based guess is wrong.',
    parameters: {
      code: { type: 'string', description: 'Subject code.' },
      path: { type: 'string', description: 'Absolute path of the file inside the workspace.' },
      generated: {
        type: 'boolean',
        description: 'true = AI generated, false = original source document. Omit to clear the mark.',
      },
      list: {
        type: 'boolean',
        description: 'List the current generated manifest instead of writing (optional).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => {
        if (!v.ok) return txt(`出错：${v.error}`)
        if (v.listed) {
          const lines = [`${v.code} 生成物清单：`]
          const g = Object.keys(v.files || {})
          const u = Object.keys(v.unmarked || {})
          lines.push(`  算生成物 ${g.length} 个`)
          for (const p of g.slice(0, 40)) lines.push('    · ' + p)
          lines.push(`  强制算原件 ${u.length} 个`)
          for (const p of u.slice(0, 40)) lines.push('    · ' + p)
          return txt(lines.join('\n'))
        }
        return txt(`${v.path}\n  → ${v.origin === 'generated' ? 'DSH 生成' : '原件'}（依据：${v.by}）`)
      },
    },
    execute: async (args) => {
      if (!args.code) return { ok: false, error: 'code 必填' }
      if (args.list) {
        const m = readGenerated(args.code)
        return {
          ok: true, listed: true, code: args.code,
          files: m.files, unmarked: m.unmarked,
        }
      }
      if (!args.path) return { ok: false, error: 'path 必填' }
      const flag = args.generated === undefined ? null : !!args.generated
      setGeneratedFlag(args.code, { filePath: args.path, generated: flag })
      const src = resolveOrigin(args.code, args.path)
      return { ok: true, path: args.path, origin: src.origin, by: src.by }
    },
  }))
}




