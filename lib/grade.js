/**
 * dsh-study-coach / grade.js
 *
 * 交卷批改：把学生写的答案对着练习卷的参考答案交给模型，逐题判分 + 讲错在哪。
 *
 * 为什么不自己判：数学/离散数学的答案有无数种写法（等价公式、不同化简路径），
 * 规则判分必然冤枉人。模型能看懂「这个答案等价但写法不同」，也能解释错在哪一步。
 *
 * 数据来源：出卷时落的那份 .json（sections[].questions[] 带 stem / marks / answer），
 * 学生答案由面板收集后一起传进来。
 *
 * 关键取舍：
 *  - **分批**：一份卷十几题一次批完容易漏题，按 6 题一组
 *  - **不要总分以外的评价**：只要「这题几分、错在哪、怎么改」，不要客套
 *  - **分数上限按题目 marks**，模型给超了要夹回来
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WORKSPACE } from './routes.js'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * 找练习卷的数据源（.json）。
 *
 * 优先新位置 `.build/papers/`（中间格式不进资料库），
 * 也扫老的 `3_练习题/*.json` —— 老用户之前生成的卷子还在那儿，不能让它失效。
 */
export function listPapers(code) {
  const root = path.join(WORKSPACE, String(code).toUpperCase())
  const dirs = [
    path.join(dshHome(), 'study', String(code).toUpperCase(), '.build', 'papers'),
    ...['3_练习题', '3_練習題', '练习题', 'practice'].map((d) => path.join(root, d)),
  ]
  const out = []
  const seen = new Set()
  for (const dir of dirs) {
    let ents = []
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.json')) continue
      const full = path.join(dir, e.name)
      if (seen.has(e.name)) continue
      try {
        const j = JSON.parse(fs.readFileSync(full, 'utf8'))
        if (!j || !Array.isArray(j.sections)) continue
        const questions = j.sections.reduce((a, s) => a + (s.questions || []).length, 0)
        const marks = j.sections.reduce(
          (a, s) => a + (s.questions || []).reduce((b, q) => b + (Number(q.marks) || 0), 0), 0,
        )
        seen.add(e.name)
        out.push({
          name: e.name,
          path: full,
          dir,
          legacy: dir.startsWith(root),
          questions,
          marks,
          hasAnswerDoc: fs.existsSync(path.join(root, '3_练习题', e.name.replace(/\.json$/i, '_答案.docx'))),
          title: (j.meta && j.meta.moduleCode) || String(code).toUpperCase(),
        })
      } catch {}
    }
  }
  return out.sort((a, b) => String(b.name).localeCompare(String(a.name)))
}

/** 把 json 摊平成题目列表：A1 / A2 … 带分值、参考答案 */
export function flattenPaper(paper) {
  const items = []
  for (const sec of paper.sections || []) {
    const prefix = sec.prefix || sec.id || 'Q'
    ;(sec.questions || []).forEach((q, i) => {
      const parts = Array.isArray(q.parts) ? q.parts : []
      const marks = Number(q.marks)
        || parts.reduce((a, p) => a + (Number(p.marks) || 0), 0)
        || 1
      // 表格和配图以前直接丢掉了 —— 真值表、邻接表、概率分布表全靠它，
      // 没有表那些题根本没法做（"根据下表…" 下面啥也没有）。
      const table = Array.isArray(q.table) && q.table.length
        ? q.table.map((row) => (Array.isArray(row) ? row.map((c) => String(c)) : [String(row)]))
        : null
      // figure 是「题目自带的那张图」的结构化描述（顶点 + 边 + 权重），
      // 前端照着画，所以学生看到的图和数据一定对得上。
      const figure = (q.figure && typeof q.figure === 'object'
        && Array.isArray(q.figure.nodes) && Array.isArray(q.figure.edges))
        ? q.figure
        : null
      items.push({
        no: `${prefix}${i + 1}`,
        section: sec.name || '',
        stem: String(q.stem || ''),
        parts: parts.map((p) => ({ label: String(p.label || ''), text: String(p.text || ''), marks: Number(p.marks) || 0 })),
        table,
        figure,
        image: String(q.image || ''),
        marks,
        answer: String(q.answer || ''),
      })
    })
  }
  return items
}

const GRADE_PROMPT = `你是香港的大专院校 的批改老师。学生刚做完一份练习卷，你要逐题批改。

只输出 JSON，不要解释、不要代码块：
{
  "items": [
    {
      "no": "A1",
      "score": 3,
      "full": 5,
      "verdict": "correct",
      "why": "对在哪 / 错在哪，一两句话，中文",
      "explain": "如果错了或只拿到部分分：正确做法是什么，分步骤讲清楚；全对就写空字符串"
    }
  ],
  "summary": "整份卷子两三句话：整体水平、最集中错的考点、下一步练什么"
}

批改要求：
1. **先看等价性再看写法**：算出来一样、化简路径不同、公式写法不同（比如 P(A∩B)/P(B) 和 P(A|B)）都算对。
2. score 只能是 0 到 full 之间的整数；部分正确给部分分，别搞一刀切。
3. verdict 取 correct / partial / wrong 之一。
4. 学生**没作答**的题：score 0、verdict wrong、why 写「未作答」。
5. explain 要能让这个学生自己看懂：点出是哪一步错了、正确的那一步怎么写。
6. 数学符号用普通文本（^ 表示幂），不要 LaTeX。
7. 不要客套话，不要复述题目。`

function parseJson(raw) {
  const t = String(raw || '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a === -1 || b <= a) return null
  try {
    return JSON.parse(t.slice(a, b + 1).replace(/,\s*([\]}])/g, '$1'))
  } catch {}
  return null
}

/**
 * 批改一份卷子。
 * @param ctx     需要 ctx.__runModel({system,user,maxTokens})
 * @param items   flattenPaper() 的结果
 * @param answers { [no]: 学生的答案文本 }
 */
export async function gradePaper(ctx, { items, answers }) {
  const BATCH = 6
  const graded = []
  const errors = []

  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH)
    const user = [
      '=== 题目与参考答案 ===',
      ...slice.map((it) => {
        const parts = it.parts.length
          ? '\n' + it.parts.map((p) => `  ${p.label} ${p.text}（${p.marks} 分）`).join('\n')
          : ''
        return `【${it.no}】(${it.marks} 分) ${it.stem}${parts}\n参考答案：${it.answer || '（无）'}`
      }),
      '',
      '=== 学生的作答 ===',
      ...slice.map((it) => {
        const a = String(answers[it.no] || '').trim()
        return `【${it.no}】${a || '（未作答）'}`
      }),
    ].join('\n')

    const r = await ctx.__runModel({ system: GRADE_PROMPT, user, maxTokens: 3000 })
    if (!r.ok) {
      errors.push({ from: slice[0].no, error: r.error, detail: r.detail })
      continue
    }
    const j = parseJson(r.answer)
    if (!j || !Array.isArray(j.items)) {
      errors.push({ from: slice[0].no, error: 'bad-json' })
      continue
    }
    for (const it of slice) {
      const got = j.items.find((x) => String(x.no).trim() === it.no) || {}
      let score = Number(got.score)
      if (!Number.isFinite(score)) score = 0
      // 模型偶尔给超分，夹回来
      score = Math.max(0, Math.min(it.marks, Math.round(score)))
      graded.push({
        no: it.no,
        section: it.section,
        stem: it.stem,
        marks: it.marks,
        score,
        verdict: ['correct', 'partial', 'wrong'].includes(got.verdict)
          ? got.verdict
          : (score >= it.marks ? 'correct' : score > 0 ? 'partial' : 'wrong'),
        why: String(got.why || '').slice(0, 600),
        explain: String(got.explain || '').slice(0, 1200),
        reference: it.answer,
        yours: String(answers[it.no] || ''),
      })
    }
    // 顺手带上模型的总结（取最后一批的）
    if (j.summary) errors.summary = String(j.summary).slice(0, 600)
  }

  const total = graded.reduce((a, x) => a + x.score, 0)
  const full = graded.reduce((a, x) => a + x.marks, 0)
  return {
    ok: graded.length > 0,
    items: graded,
    total,
    full,
    percent: full ? Math.round((total / full) * 100) : 0,
    summary: errors.summary || '',
    errors: errors.filter((e) => e && e.error),
  }
}
