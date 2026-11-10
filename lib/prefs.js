/**
 * dsh-study-coach / prefs.js
 *
 * 生成偏好：影响「模型怎么写」和「排版怎么排」，不影响「写到哪」。
 *
 * 为什么要单独一层：
 *   同一个知识点，有人要一句话记住，有人要图 + 例题 + 逐步推导。
 *   以前这些全靠 prompt 里一句泛泛的「写成能复习的样子」，结果每次都差不多。
 *   现在把选择权交出来，选项直接翻译成 prompt 里的硬要求。
 *
 * 存 $DSH_HOME/study/prefs.json（全局，不分科目 —— 这是个人习惯，不是科目属性）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function prefsPath() {
  return path.join(dshHome(), 'study', 'prefs.json')
}

/** 全部可选项（面板照着这份渲染，加选项只改这里） */
export const PREFS_SCHEMA = [
  {
    // 放第一位：考卷全英文，中英对照是最常被点名的一项
    key: 'bilingual',
    label: '★ 中英对照',
    hint: '考点是英文卷 —— 建议至少「只并列术语」，重要概念用「中英并排」',
    type: 'choice',
    options: [
      { id: 'term', label: '只并列术语', desc: '中文讲解 + 英文术语（最小负担）' },
      { id: 'both', label: '中英并排', desc: '每条都中英各写一遍，适合考前对英文卷' },
    ],
  },
  {
    key: 'diagram',
    label: '图示',
    hint: '多给表格 / 对照 / ASCII 示意图，而不是一段段文字',
    type: 'choice',
    options: [
      { id: 'few', label: '少', desc: '只在必要处作图' },
      { id: 'some', label: '适中', desc: '概念间关系用表格或示意图' },
      { id: 'lots', label: '多', desc: '尽量都画出来：流程、结构、对比' },
    ],
  },
  {
    key: 'examples',
    label: '例题',
    hint: '每个知识点配几道例题（含解题步骤）',
    type: 'choice',
    options: [
      { id: '1', label: '1 道' },
      { id: '2', label: '2 道' },
      { id: '3', label: '3 道' },
    ],
  },
  {
    key: 'verbosity',
    label: '详略',
    hint: '同一份笔记写多细',
    type: 'choice',
    options: [
      { id: 'brief', label: '精简', desc: '只留结论和关键步骤' },
      { id: 'normal', label: '适中' },
      { id: 'detailed', label: '详细', desc: '推导过程写全，适合第一次学' },
    ],
  },
  {
    key: 'formulas',
    label: '公式',
    hint: '公式怎么写',
    type: 'choice',
    options: [
      { id: 'plain', label: '普通文本', desc: 'a^2 + b^2，哪里都能显示' },
      { id: 'steps', label: '分步推导', desc: '把每一步变形都写出来' },
    ],
  },
]

const VALID = Object.fromEntries(
  PREFS_SCHEMA.map((p) => [p.key, new Set(p.options.map((o) => o.id))]),
)

export const DEFAULT_PREFS = {
  diagram: 'some',
  examples: '1',
  verbosity: 'normal',
  bilingual: 'term',
  formulas: 'plain',
}

export function readPrefs() {
  let raw = {}
  try {
    raw = JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) || {}
  } catch {}
  const out = { ...DEFAULT_PREFS }
  for (const [k, allowed] of Object.entries(VALID)) {
    if (typeof raw[k] === 'string' && allowed.has(raw[k])) out[k] = raw[k]
  }
  return out
}

export function writePrefs(patch) {
  const cur = readPrefs()
  const next = { ...cur }
  for (const [k, allowed] of Object.entries(VALID)) {
    if (patch && typeof patch[k] === 'string' && allowed.has(patch[k])) next[k] = patch[k]
  }
  const p = prefsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/**
 * 把偏好翻译成 prompt 里的一段硬要求。
 * 这是整个模块的核心 —— 选项要真的改变模型输出，不能只是个装饰。
 */
export function prefsToPrompt(prefs) {
  const p = { ...DEFAULT_PREFS, ...(prefs || {}) }
  const L = []

  // 图示
  if (p.diagram === 'lots') {
    L.push('- **图示优先**：能用表格、对照表、ASCII 示意图讲清楚的，就别写成大段文字。')
    L.push('  可以画：流程图（→ 箭头）、结构树（├─ └─）、对比矩阵（| | |）、坐标系简图、状态转换。')
    L.push('  每个知识点至少配一个可视化的东西（表格或示意图），纯文字的知识点不要超过 20%。')
  } else if (p.diagram === 'some') {
    L.push('- 概念之间有关系时，用表格或 ASCII 示意图表达；单纯的定义用文字。')
  } else {
    L.push('- 图能省则省，用文字和公式说清楚就行。')
  }

  // 例题
  const n = Number(p.examples) || 1
  L.push(`- 每个知识点配 **${n} 道例题**，例题要带解题步骤（不是只给答案）。`)

  // 详略
  if (p.verbosity === 'detailed') {
    L.push('- **详细模式**：推导过程一步不跳，说明为什么这一步成立；适合第一次学。')
  } else if (p.verbosity === 'brief') {
    L.push('- **精简模式**：只写结论、关键步骤和易错点，不要铺垫。')
  } else {
    L.push('- 详略适中：关键步骤写全，常识性内容一句带过。')
  }

  // 中英
  if (p.bilingual === 'both') {
    L.push('- **中英并排**：每个知识点、每个要点都写中文 + 英文两遍（英文用标准术语）。')
  } else {
    L.push('- 中文讲解，专业术语后面用括号附英文原词，例如「最小生成树 (Minimum Spanning Tree)」。')
  }

  // 公式
  if (p.formulas === 'steps') {
    L.push('- 公式要给**分步推导**：从已知到结论，每一步变形式都写出来。')
  } else {
    L.push('- 公式用普通文本写（^ 表示幂、* 表示乘），不要 LaTeX。')
  }

  return L.join('\n')
}
