/**
 * dsh-study-coach / modelprefs.js
 *
 * 「用哪个模型」记在文件里，插件的一切 AI 功能（问 / 翻译 / 一键生成 / 出卷）都听它。
 *
 * 为什么需要：
 *   DSH 里有十几个 provider，掉线的那些 listModels 照样返回模型名，但一调就空。
 *   插件自己按顺序猜通道，等于每次开盲盒 —— 用户明明在对话里用得好好的模型，
 *   插件却在旁边撞一个 403 的账号。
 *
 * 所以：
 *   1. 文件里存着用户选过的 provider/model，最优先用
 *   2. 没选过就退回「遍历 + 冷却名单」
 *   3. 面板上随时能改，改完立刻生效，不用重启
 *
 * 存在 $DSH_HOME/study/model.json：
 *   { "provider": "deepseek-account", "model": "deepseek-flash", "at": "2026-11-10T..." }
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function modelPrefPath() {
  return path.join(dshHome(), 'study', 'model.json')
}

export function readModelPref() {
  try {
    const j = JSON.parse(fs.readFileSync(modelPrefPath(), 'utf8'))
    if (j && j.provider && j.model) {
      return {
        provider: j.provider,
        model: j.model,
        effort: typeof j.effort === 'string' ? j.effort : '',
        at: j.at || '',
      }
    }
  } catch {}
  return null
}

export function writeModelPref({ provider, model, effort }) {
  const p = modelPrefPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const body = provider && model
    ? { provider, model, effort: effort || '', at: new Date().toISOString() }
    : { provider: '', model: '', effort: effort || '', at: new Date().toISOString() }
  fs.writeFileSync(p, JSON.stringify(body, null, 2) + '\n', 'utf8')
  return body
}

export function clearModelPref() {
  try {
    fs.rmSync(modelPrefPath(), { force: true })
  } catch {}
  return { provider: '', model: '' }
}
