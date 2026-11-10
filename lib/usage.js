/**
 * dsh-study-coach / usage.js
 *
 * 记这个插件自己发起的模型调用：次数、字符数、估算 token、耗时、按功能/模型分。
 *
 * 为什么只统计本插件：
 *   DSH 生态里已经有全局计费插件（usage-billing），但它统计的是整个会话。
 *   这里要回答的是「学习资源库这几个按钮花掉多少」—— 翻译一次、出卷一次，
 *   各自跑了多少次模型。两个口径不冲突，混在一起反而谁都算不清。
 *
 * 费用怎么算：
 *   大多数免费通道 0 成本，官方 API 有单价但每家不同、还会变。
 *   所以默认只报**用量**（次数 / 字符 / 估算 token），费用要用户自己填单价，
 *   填了才算 —— 不编一个看起来精确的假数字。
 *
 * 存 $DSH_HOME/study/usage.jsonl，只追加，一天几十行，不需要数据库。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function usagePath() {
  return path.join(dshHome(), 'study', 'usage.jsonl')
}

/** 粗估 token：中日韩字符约 1 字 ≈ 1 token，拉丁约 4 字符 ≈ 1 token */
export function estimateTokens(text) {
  const s = String(text || '')
  if (!s) return 0
  let cjk = 0
  let latin = 0
  for (const ch of s) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk++
    else latin++
  }
  return Math.round(cjk + latin / 4)
}

export function record({
  feature = 'unknown',
  code = '',
  provider = '',
  model = '',
  promptChars = 0,
  outputChars = 0,
  ms = 0,
  ok = true,
  error = '',
}) {
  const row = {
    at: new Date().toISOString(),
    feature,
    code: String(code || '').toUpperCase(),
    provider,
    model,
    inTok: estimateTokens(' '.repeat(0)) + Math.round(promptChars / 3.2),
    outTok: Math.round(outputChars / 3.2),
    chars: promptChars + outputChars,
    ms,
    ok: !!ok,
    ...(error ? { error: String(error).slice(0, 120) } : {}),
  }
  row.tokens = row.inTok + row.outTok
  try {
    const p = usagePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8')
  } catch {}
  return row
}

function readAll() {
  const rows = []
  let raw = ''
  try {
    raw = fs.readFileSync(usagePath(), 'utf8')
  } catch {
    return rows
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {}
  }
  return rows
}

/**
 * 汇总。
 * @param {object} opts { days=30, pricePerMTok=0 }  价格单位：每百万 token 的钱（用户自填）
 */
export function summarize({ days = 30, pricePerMTok = 0 } = {}) {
  const since = Date.now() - days * 86400000
  const rows = readAll().filter((r) => {
    const t = Date.parse(r.at)
    return Number.isFinite(t) && t >= since
  })

  const byFeature = {}
  const byModel = {}
  const byDay = {}
  let calls = 0
  let fails = 0
  let tokens = 0
  let chars = 0
  let ms = 0

  for (const r of rows) {
    calls++
    if (r.ok === false) fails++
    tokens += Number(r.tokens) || 0
    chars += Number(r.chars) || 0
    ms += Number(r.ms) || 0

    const f = r.feature || 'unknown'
    byFeature[f] = byFeature[f] || { calls: 0, tokens: 0, chars: 0, fails: 0 }
    byFeature[f].calls++
    byFeature[f].tokens += Number(r.tokens) || 0
    byFeature[f].chars += Number(r.chars) || 0
    if (r.ok === false) byFeature[f].fails++

    const m = (r.provider ? r.provider + '/' : '') + (r.model || '?')
    byModel[m] = byModel[m] || { calls: 0, tokens: 0 }
    byModel[m].calls++
    byModel[m].tokens += Number(r.tokens) || 0

    const day = String(r.at).slice(0, 10)
    byDay[day] = byDay[day] || { calls: 0, tokens: 0 }
    byDay[day].calls++
    byDay[day].tokens += Number(r.tokens) || 0
  }

  const price = Number(pricePerMTok) || 0
  return {
    ok: true,
    days,
    calls,
    fails,
    tokens,
    chars,
    avgMs: calls ? Math.round(ms / calls) : 0,
    // 只有用户填了单价才给钱数，否则 null（不编假数字）
    cost: price > 0 ? Number(((tokens / 1e6) * price).toFixed(4)) : null,
    pricePerMTok: price,
    byFeature,
    byModel,
    byDay: Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14),
    totalRows: readAll().length,
  }
}
