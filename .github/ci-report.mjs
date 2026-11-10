// CI 用：测试失败时把「哪一条断言挂了」变成 GitHub annotation。
// 公开仓库的 job log 要登录才能下，但 annotation 可以匿名读 —— 所以失败原因走这条路。
import fs from 'node:fs'
const file = process.argv[2]
let text = ''
try {
  text = fs.readFileSync(file, 'utf8')
} catch {
  process.exit(0)
}
const lines = text.split(/\r?\n/)
const bad = lines.filter(
  (l) => l.includes('\u274c') || /^\s*(Error|SyntaxError|ReferenceError|TypeError|RangeError)\b/.test(l),
)
for (const h of lines.slice(0, 12)) {
  if (!h.trim()) continue
  console.log('::notice::' + h.trim().slice(0, 300))
}
for (const b of bad.slice(0, 30)) {
  console.log('::error::' + b.trim().slice(0, 300))
}
console.log('::notice::total lines ' + lines.length + ' / failing lines ' + bad.length)
