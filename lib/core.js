/**
 * dsh-study-coach / core.js
 *
 * 全部数据是本地纯文本，不联网、不调模型 —— 逻辑确定，结果可复现。
 *
 * 目录布局
 *   <DSH_HOME>/study/subjects.json        科目清单
 *   <DSH_HOME>/study/<CODE>/topics.json   知识点（带 mastery / due）
 *   <DSH_HOME>/study/<CODE>/cards.json    题卡（一问一答，挂到 topic）
 *   <DSH_HOME>/study/<CODE>/attempts.jsonl 答题流水（只追加）
 *
 * 掌握度与间隔
 *   mastery 0..1，答对 +0.15、答错 -0.25
 *   下次复习间隔按 mastery 取 [1,2,4,7,15,30] 天
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/* ------------------------------------------------------------------ paths */

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function studyRoot() {
  return path.join(dshHome(), 'study')
}

export function subjectDir(code) {
  return path.join(studyRoot(), String(code).toUpperCase())
}

/* ------------------------------------------------ 试卷配图
 * 有些题必须看着图做（"下图是一个加权图…"、"根据真值表…"）。
 * 模型出不了图，所以留给主人自己挂：哪张卷子的哪一题、配哪张图。
 * 存在 <科目>/paper-images.json，键是 "<卷子文件名>::A3"。 */
export function paperImagesPath(code) {
  return path.join(subjectDir(code), 'paper-images.json')
}

export function readPaperImages(code) {
  const j = readJson(paperImagesPath(code), null)
  return (j && typeof j === 'object') ? j : {}
}

export function setPaperImage(code, paperName, no, imgPath) {
  const all = readPaperImages(code)
  const key = String(paperName) + '::' + String(no)
  if (imgPath) all[key] = String(imgPath)
  else delete all[key]
  writeJson(paperImagesPath(code), all)
  return all
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(p, data) {
  ensureDir(path.dirname(p))
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, p)
}

/**
 * 本地时区的 YYYY-MM-DD。
 *
 * 以前这里是 `new Date().toISOString().slice(0,10)` —— 那是 UTC 日期。
 * 在香港（UTC+8）凌晨 0 点到 8 点，UTC 还停在前一天，于是「今天该复习什么」
 * 算的是昨天：熬夜复习的人正好踩中，题不出来、考试倒计时还多一天。
 */
export function today() {
  return dayOf(Date.now())
}

/** 把任意时间戳转成本地日期字符串（文件列表里的修改日期也用这个）。 */
export function dayOf(ms) {
  const d = new Date(Number(ms) || 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(iso, n) {
  // 日期字符串按 UTC 零点算，只做整日加减，跟本地时区无关
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime()
  const db = new Date(b + 'T00:00:00Z').getTime()
  return Math.round((db - da) / 86400000)
}

/* --------------------------------------------------------------- subjects */

export function listSubjects() {
  const p = path.join(studyRoot(), 'subjects.json')
  const data = readJson(p, { subjects: [] })
  if (!Array.isArray(data.subjects)) data.subjects = []
  return data.subjects
}

export function upsertSubject({ code, name, root, examDate, note }) {
  const p = path.join(studyRoot(), 'subjects.json')
  const data = readJson(p, { subjects: [] })
  if (!Array.isArray(data.subjects)) data.subjects = []
  const codeU = String(code).toUpperCase()
  const i = data.subjects.findIndex((s) => String(s.code).toUpperCase() === codeU)
  const prev = i >= 0 ? data.subjects[i] : {}
  const rec = {
    code: codeU,
    name: name ?? prev.name ?? codeU,
    root: root ?? prev.root ?? '',
    examDate: examDate ?? prev.examDate ?? '',
    note: note ?? prev.note ?? '',
    addedAt: prev.addedAt ?? new Date().toISOString(),
  }
  if (i >= 0) data.subjects[i] = rec
  else data.subjects.push(rec)
  writeJson(p, data)
  return rec
}

export function getSubject(code) {
  const codeU = String(code).toUpperCase()
  return listSubjects().find((s) => String(s.code).toUpperCase() === codeU) || null
}

/** 自动发现：扫 workspaceRoot 下形如 COMP2011 / COMP2012 的目录 */
export function discoverSubjects(workspaceRoot) {
  const found = []
  let entries = []
  try {
    entries = fs.readdirSync(workspaceRoot, { withFileTypes: true })
  } catch {
    return found
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (!/^[A-Z]{2,4}\d{4}$/i.test(e.name)) continue
    found.push({
      code: e.name.toUpperCase(),
      root: path.join(workspaceRoot, e.name),
      fileCount: countFiles(path.join(workspaceRoot, e.name)),
    })
  }
  return found
}

function countFiles(dir) {
  let n = 0
  const walk = (d) => {
    let list = []
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const x of list) {
      if (x.isDirectory()) walk(path.join(d, x.name))
      else n++
    }
  }
  walk(dir)
  return n
}

/* ----------------------------------------------------------------- topics */

export function readTopics(code) {
  const p = path.join(subjectDir(code), 'topics.json')
  const data = readJson(p, { topics: [] })
  if (!Array.isArray(data.topics)) data.topics = []
  return data
}

export function writeTopics(code, data) {
  writeJson(path.join(subjectDir(code), 'topics.json'), data)
}

/** topics: [{lecture, title, titleEn?, key?}] */
export function addTopics(code, topics) {
  const data = readTopics(code)
  const byKey = new Map(data.topics.map((t) => [t.key, t]))
  let added = 0
  for (const t of topics) {
    const key = t.key || slug(`${t.lecture || ''}-${t.title}`)
    if (byKey.has(key)) continue
    const rec = {
      key,
      lecture: t.lecture ?? '',
      title: t.title ?? '',
      titleEn: t.titleEn ?? '',
      mastery: 0,
      seen: 0,
      right: 0,
      wrong: 0,
      due: today(),
      lastSeen: null,
    }
    data.topics.push(rec)
    byKey.set(key, rec)
    added++
  }
  writeTopics(code, data)
  return { added, total: data.topics.length }
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'topic'
}

/* ------------------------------------------------------------------ cards */

export function readCards(code) {
  const p = path.join(subjectDir(code), 'cards.json')
  const data = readJson(p, { cards: [] })
  if (!Array.isArray(data.cards)) data.cards = []
  return data
}

/**
 * 更新一张题卡（只改 patch 里的字段）。
 * 用途：把生成的「选择题形态」缓存进卡片，下次做题不用再问模型。
 */
export function updateCard(code, cardId, patch) {
  const data = readCards(code)
  const card = data.cards.find((c) => c.id === cardId)
  if (!card) return { ok: false, reason: 'card-not-found' }
  Object.assign(card, patch)
  writeJson(path.join(subjectDir(code), 'cards.json'), data)
  return { ok: true, card }
}

/**
 * 每张卡最近一次作答结果 —— 用来在题目列表打 ✅ / ✗。
 * 数据源是 attempts.jsonl（按时间追加），取每个 topicKey 的最后一条。
 * @returns { [topicKey]: { correct: boolean, at: string } }
 */
export function lastAttemptByTopic(code) {
  const p = path.join(subjectDir(code), 'attempts.jsonl')
  const out = {}
  let raw = ''
  try {
    raw = fs.readFileSync(p, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let a
    try {
      a = JSON.parse(line)
    } catch {
      continue
    }
    if (!a || !a.topicKey) continue
    out[a.topicKey] = { correct: !!a.correct, at: a.at || a.time || '' }
  }
  return out
}

export function addCards(code, cards) {
  const data = readCards(code)
  const have = new Set(data.cards.map((c) => c.id))
  let added = 0
  for (const c of cards) {
    const id = c.id || `${slug(c.topicKey || 'card')}-${data.cards.length + 1}`
    if (have.has(id)) continue
    data.cards.push({
      id,
      topicKey: c.topicKey ?? '',
      question: c.question ?? '',
      answer: c.answer ?? '',
      marks: c.marks ?? 0,
      source: c.source ?? '',
    })
    have.add(id)
    added++
  }
  writeJson(path.join(subjectDir(code), 'cards.json'), data)
  return { added, total: data.cards.length }
}

/* ------------------------------------------------------------------- plan */

const INTERVALS = [1, 2, 4, 7, 15, 30]

export function intervalFor(mastery) {
  const m = Number(mastery) || 0
  if (m < 0.4) return INTERVALS[0]
  if (m < 0.6) return INTERVALS[1]
  if (m < 0.75) return INTERVALS[2]
  if (m < 0.9) return INTERVALS[3]
  if (m < 0.97) return INTERVALS[4]
  return INTERVALS[5]
}

export function buildPlan(code, { days, perDay } = {}) {
  const subj = getSubject(code)
  const data = readTopics(code)
  const t = today()

  const dueAll = data.topics
    .filter((x) => !x.due || x.due <= t)
    .filter((x) => (x.mastery ?? 0) < 0.97)

  // 学过但到期的 → 复习（最弱的先来，不然会忘）
  const reviewAll = dueAll
    .filter((x) => (x.seen ?? 0) > 0)
    .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))

  // 从没碰过的 → 新学（按章节顺序，别乱跳）
  const freshAll = dueAll
    .filter((x) => (x.seen ?? 0) === 0)
    .sort((a, b) =>
      String(a.lecture).localeCompare(String(b.lecture), 'en', { numeric: true }),
    )

  const upcoming = data.topics
    .filter((x) => x.due && x.due > t)
    .sort((a, b) => (a.due < b.due ? -1 : 1))

  const cap = Math.max(1, Number(perDay) || 8)
  // 复习优先占额度（到期就该看），剩下的给新学
  const reviewList = reviewAll.slice(0, cap)
  const freshList = freshAll.slice(0, Math.max(0, cap - reviewList.length))
  const todayList = [...reviewList, ...freshList]

  let daysLeft = null
  if (subj?.examDate) daysLeft = daysBetween(t, subj.examDate)

  const avg = data.topics.length
    ? data.topics.reduce((s, x) => s + (x.mastery ?? 0), 0) / data.topics.length
    : 0

  // 按剩余天数算每天至少要做几个才来得及
  const remaining = data.topics.filter((x) => (x.mastery ?? 0) < 0.97).length
  const perDayNeeded =
    daysLeft && daysLeft > 0 ? Math.ceil(remaining / daysLeft) : null

  return {
    code: String(code).toUpperCase(),
    name: subj?.name ?? code,
    today: t,
    examDate: subj?.examDate ?? '',
    daysLeft,
    totalTopics: data.topics.length,
    avgMastery: Number(avg.toFixed(3)),
    dueCount: dueAll.length,
    reviewCount: reviewAll.length,
    freshCount: freshAll.length,
    todayList,
    reviewList,
    freshList,
    perDayNeeded,
    remaining,
    upcoming: upcoming.slice(0, 10),
    estimatedMinutes: todayList.length * 4,
  }
}

/* ------------------------------------------------------------------ drill */

export function pickQuestions(code, { count, topicKeys } = {}) {
  const cards = readCards(code).cards
  if (!cards.length) return { cards: [], reason: 'no-cards' }
  let pool = cards
  if (Array.isArray(topicKeys) && topicKeys.length) {
    const set = new Set(topicKeys)
    pool = cards.filter((c) => set.has(c.topicKey))
  }
  if (!pool.length) return { cards: [], reason: 'no-cards-for-topic' }

  // 优先抽「到期 / 掌握度低」的知识点对应的卡
  const topics = readTopics(code).topics
  const weight = new Map(topics.map((t) => [t.key, 1 - (t.mastery ?? 0)]))
  const shuffled = pool
    .map((c) => ({ c, w: (weight.get(c.topicKey) ?? 0.5) + Math.random() * 0.4 }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.c)

  const n = Math.max(1, Number(count) || 5)
  return { cards: shuffled.slice(0, n), reason: 'ok' }
}

/* ------------------------------------------------------------------ check */

export function recordAttempt(code, { cardId, topicKey, correct }) {
  const t = today()
  const data = readTopics(code)
  const codeU = String(code).toUpperCase()

  const key = topicKey || (readCards(code).cards.find((c) => c.id === cardId)?.topicKey ?? '')
  const topic = data.topics.find((x) => x.key === key)

  if (!topic) {
    return { ok: false, reason: 'topic-not-found', topicKey: key }
  }

  const prevM = Number(topic.mastery) || 0
  const delta = correct ? 0.15 : -0.25
  const m = Math.max(0, Math.min(1, Number((prevM + delta).toFixed(3))))

  topic.mastery = m
  topic.seen = (topic.seen ?? 0) + 1
  if (correct) topic.right = (topic.right ?? 0) + 1
  else topic.wrong = (topic.wrong ?? 0) + 1
  topic.lastSeen = new Date().toISOString()
  topic.due = addDays(t, intervalFor(m))

  writeTopics(code, data)

  const logPath = path.join(subjectDir(code), 'attempts.jsonl')
  ensureDir(path.dirname(logPath))
  fs.appendFileSync(
    logPath,
    JSON.stringify({
      at: new Date().toISOString(),
      cardId: cardId ?? '',
      topicKey: key,
      correct: !!correct,
      masteryBefore: prevM,
      masteryAfter: m,
      nextDue: topic.due,
    }) + '\n',
    'utf8',
  )

  return {
    ok: true,
    code: codeU,
    topicKey: key,
    title: topic.title,
    masteryBefore: prevM,
    masteryAfter: m,
    correct: !!correct,
    nextDue: topic.due,
    intervalDays: intervalFor(m),
  }
}

/* ------------------------------------------------------------------ stats */

export function stats(code) {
  const data = readTopics(code)
  const t = today()
  const ts = data.topics

  const buckets = [
    ['未开始', (x) => (x.seen ?? 0) === 0],
    ['薄弱 <40%', (x) => (x.seen ?? 0) > 0 && (x.mastery ?? 0) < 0.4],
    ['一般 40-70%', (x) => (x.mastery ?? 0) >= 0.4 && (x.mastery ?? 0) < 0.7],
    ['较好 70-90%', (x) => (x.mastery ?? 0) >= 0.7 && (x.mastery ?? 0) < 0.9],
    ['稳固 ≥90%', (x) => (x.mastery ?? 0) >= 0.9],
  ]

  const byBucket = buckets.map(([name, f]) => ({ name, count: ts.filter(f).length }))

  const byLecture = {}
  for (const x of ts) {
    const l = x.lecture || '?'
    byLecture[l] = byLecture[l] || { total: 0, mastered: 0, sum: 0 }
    byLecture[l].total++
    byLecture[l].sum += x.mastery ?? 0
    if ((x.mastery ?? 0) >= 0.9) byLecture[l].mastered++
  }
  const lectureRows = Object.entries(byLecture)
    .map(([lecture, v]) => ({
      lecture,
      total: v.total,
      mastered: v.mastered,
      avg: Number((v.sum / v.total).toFixed(2)),
    }))
    .sort((a, b) => String(a.lecture).localeCompare(String(b.lecture), 'en', { numeric: true }))

  const dueNow = ts.filter((x) => !x.due || x.due <= t).length
  const weak = ts
    .filter((x) => (x.seen ?? 0) > 0 && (x.mastery ?? 0) < 0.5)
    .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))
    .slice(0, 8)

  return {
    code: String(code).toUpperCase(),
    totalTopics: ts.length,
    studied: ts.filter((x) => (x.seen ?? 0) > 0).length,
    dueNow,
    avgMastery: ts.length
      ? Number((ts.reduce((s, x) => s + (x.mastery ?? 0), 0) / ts.length).toFixed(3))
      : 0,
    byBucket,
    lectureRows,
    weak,
  }
}

/* ------------------------------------------------- generated manifest */
/**
 * 「这个文件是不是 DSH 生成的」—— 命名约定只是兜底，真正的判据是清单。
 *
 * 清单在 <DSH_HOME>/study/<CODE>/generated.json：
 *   {
 *     "files":    { "<绝对路径>": { "at": "2026-11-10", "by": "dsh" } },  ← 强制算生成物
 *     "unmarked": { "<绝对路径>": { "at": "...", "by": "user" } }         ← 强制算原件
 *   }
 *
 * 为什么要清单：靠命名总有一天会判错（比如老师真发了个「总结.pdf」）。
 * 清单可以手工标，也能由生成管线写；命名规则退化成「没标过时猜一把」。
 */

/** 生成物的命名特征。客户端导入分区时也用这一份（服务端下发）。 */
export const GENERATED_RE =
  /完整笔记|复习笔记|考前复习|冲刺|速查|知识点清单|中英对照|总结|提纲|思维导图|错题本|逐题精讲|答案卡|精讲|刷题/i

export function isGeneratedName(name) {
  return GENERATED_RE.test(String(name || ''))
}

/** Windows 路径大小写不敏感，统一正斜杠 + 小写当 key */
export function manifestKey(filePath) {
  return path.normalize(String(filePath || '')).replace(/\\/g, '/').toLowerCase()
}

export function generatedManifestPath(code) {
  return path.join(subjectDir(code), 'generated.json')
}

export function readGenerated(code) {
  const j = readJson(generatedManifestPath(code), null)
  return {
    files: (j && j.files) || {},
    unmarked: (j && j.unmarked) || {},
  }
}

export function writeGenerated(code, data) {
  writeJson(generatedManifestPath(code), {
    files: data.files || {},
    unmarked: data.unmarked || {},
  })
  return data
}

/**
 * 手工标记一个文件：
 *   generated=true  → 写进 files，并从 unmarked 里删掉
 *   generated=false → 写进 unmarked，并从 files 里删掉
 *   generated=null  → 两个表里都删掉，回到「按命名猜」
 */
export function setGeneratedFlag(code, { filePath, generated }) {
  const key = manifestKey(filePath)
  if (!key) throw new Error('filePath 必填')
  const data = readGenerated(code)
  delete data.files[key]
  delete data.unmarked[key]
  if (generated === true) {
    data.files[key] = { at: today(), by: 'user' }
  } else if (generated === false) {
    data.unmarked[key] = { at: today(), by: 'user' }
  }
  writeGenerated(code, data)
  return data
}

/**
 * 判定一个文件的来源。
 * 返回 { origin: 'generated'|'source', by: 'manifest'|'manual'|'name'|'default' }
 */
export function resolveOrigin(code, filePath, name) {
  const key = manifestKey(filePath)
  const data = readGenerated(code)
  if (key && data.files[key]) return { origin: 'generated', by: 'manifest' }
  if (key && data.unmarked[key]) return { origin: 'source', by: 'manual' }
  if (isGeneratedName(name ?? path.basename(String(filePath || '')))) {
    return { origin: 'generated', by: 'name' }
  }
  return { origin: 'source', by: 'default' }
}

/**
 * 扫描目录，把「按命名判定为生成物」的文件写进清单。
 * 一次性给历史文件补票用；重复跑幂等，不覆盖手工标记。
 * 返回 { added, kept, scanned }
 */
export function backfillGenerated(code, dirs = []) {
  const data = readGenerated(code)
  let added = 0
  let kept = 0
  let scanned = 0
  for (const dir of dirs) {
    let ents = []
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~$')) continue
      scanned++
      const key = manifestKey(path.join(dir, e.name))
      if (data.files[key] || data.unmarked[key]) {
        kept++
        continue
      }
      if (!isGeneratedName(e.name)) continue
      data.files[key] = { at: today(), by: 'backfill' }
      added++
    }
  }
  writeGenerated(code, data)
  return { added, kept, scanned }
}

/* --------------------------------------------------- translation helpers */
/**
 * 把模型返回的东西解析成 [{ k, v }]。
 *
 * 模型很爱包 ```json、很爱加解释、偶尔漏一个引号，所以不直接 JSON.parse：
 * 先扒出最外层 [] 或 {}，再逐条兜底用正则抠 key: value。
 * 单测里专门喂了几种脏格式。
 */
export function parsePairs(raw) {
  const text = String(raw || '').trim()
  if (!text) return []

  const out = []
  const push = (k, v) => {
    const kk = String(k ?? '').trim()
    const vv = String(v ?? '').trim()
    if (!kk || !vv || kk === vv) return
    if (out.some((x) => x.k === kk)) return
    out.push({ k: kk, v: vv })
  }

  // 1) 先试着当 JSON 处理（允许外面裹 ``` 和一句废话）
  const fenced = text.replace(/```(?:json|JSON)?/g, '').trim()
  const arrStart = fenced.indexOf('[')
  const arrEnd = fenced.lastIndexOf(']')
  const objStart = fenced.indexOf('{')
  const objEnd = fenced.lastIndexOf('}')
  const candidates = []
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(fenced.slice(arrStart, arrEnd + 1))
  if (objStart !== -1 && objEnd > objStart) candidates.push(fenced.slice(objStart, objEnd + 1))

  for (const c of candidates) {
    try {
      const j = JSON.parse(c.replace(/,\s*([\]}])/g, '$1'))
      if (Array.isArray(j)) {
        for (const item of j) {
          if (Array.isArray(item) && item.length >= 2) push(item[0], item[1])
          else if (item && typeof item === 'object') {
            const k = item.k ?? item.key ?? item.zh ?? item.cn ?? item.src
            const v = item.v ?? item.value ?? item.en ?? item.english ?? item.dst
            if (k != null && v != null) push(k, v)
            else {
              const keys = Object.keys(item)
              if (keys.length === 1) push(keys[0], item[keys[0]])
            }
          }
        }
        if (out.length) return out
      } else if (j && typeof j === 'object') {
        for (const [k, v] of Object.entries(j)) {
          if (typeof v === 'string') push(k, v)
        }
        if (out.length) return out
      }
    } catch {}
  }

  // 2) 兜底：逐行抠 "a": "b" / a = b / a | b / a → b
  const lineRe =
    /^\s*[-*\d.)\s]*["'「『]?(.+?)["'」』]?\s*(?::|=|\||→|->)\s*["'「『]?(.+?)["'」』]?\s*[,;]?\s*$/
  for (const line of fenced.split(/\r?\n/)) {
    const m = lineRe.exec(line)
    if (m) push(m[1], m[2])
  }
  return out
}

/**
 * 挑出「还缺另一种语言」的条目，给翻译任务用。
 *   target='en' → 有 title 没 titleEn 的知识点
 *   target='zh' → 有 titleEn 没 title 的（少见，但生成的种子数据可能只有英文）
 */
export function pendingTranslations(code, { target = 'en', keys = [], force = false } = {}) {
  const topics = readTopics(code).topics
  const want = new Set((keys || []).map(String))
  return topics.filter((t) => {
    if (want.size && !want.has(String(t.key))) return false
    const zh = String(t.title || '').trim()
    const en = String(t.titleEn || '').trim()
    if (target === 'en') return force ? !!zh : !!zh && !en
    return force ? !!en : !!en && !zh
  })
}

/**
 * 把翻译结果写回 topics。
 * pairs: [{ k, v }]，k 是原文（title 或 titleEn），v 是译文。
 * 返回 { updated, missing }
 */
export function applyTranslations(code, { target = 'en', pairs = [] } = {}) {
  const data = readTopics(code)
  const map = new Map()
  for (const p of pairs) map.set(String(p.k).trim(), String(p.v).trim())
  let updated = 0
  for (const t of data.topics) {
    if (target === 'en') {
      const src = String(t.title || '').trim()
      const hit = map.get(src)
      if (hit && hit !== t.titleEn) {
        t.titleEn = hit
        updated++
      }
    } else {
      const src = String(t.titleEn || '').trim()
      const hit = map.get(src)
      if (hit && hit !== t.title) {
        t.title = hit
        updated++
      }
    }
  }
  if (updated) writeTopics(code, data)
  return { updated, missing: pairs.length - updated }
}
