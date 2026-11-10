#!/usr/bin/env node
/**
 * install.mjs —— 把 dsh-study-coach 装进你的某个 DSH profile。
 *
 *   node install.mjs                    # 只有一个 profile 就直接装它
 *   node install.mjs --profile desktop  # 指定 profile
 *   node install.mjs --dry-run          # 只打印会改什么，不动文件
 *
 * 它做三件事（每件都幂等，重复跑不会坏）：
 *   1. 在 profile 的 package.json 里加 dependencies["dsh-study-coach"] = "link:<本目录>"
 *   2. 把 "dsh-study-coach" 加进 dsh.profile.bundles
 *   3. 在 profile/node_modules 里建一个指向本目录的链接（Windows 用 junction，不需要管理员）
 *
 * 改之前会备份 package.json。不重启 DSH、不碰 cordis.patch.yml。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = 'dsh-study-coach'

const argv = process.argv.slice(2)
const dry = argv.includes('--dry-run')
const pi = argv.indexOf('--profile')
const wantProfile = pi >= 0 ? argv[pi + 1] : ''

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profilesDir = path.join(dshHome, 'profiles')

function die(msg) {
  console.error('\n❌ ' + msg + '\n')
  process.exit(1)
}

if (!fs.existsSync(profilesDir)) {
  die(
    `找不到 DSH 的 profiles 目录：${profilesDir}\n` +
      '   先让 DSH 正常启动一次，或者设 DSH_HOME 指向你的 .dsh 目录。',
  )
}

const profiles = fs
  .readdirSync(profilesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((n) => fs.existsSync(path.join(profilesDir, n, 'package.json')))

if (!profiles.length) die(`${profilesDir} 下面没有带 package.json 的 profile。`)

let profile = wantProfile
if (!profile) {
  if (profiles.length === 1) profile = profiles[0]
  else die(`有 ${profiles.length} 个 profile：${profiles.join(', ')}\n   用 --profile <名字> 指定一个。`)
} else if (!profiles.includes(profile)) {
  die(`profile "${profile}" 不存在。可选：${profiles.join(', ')}`)
}

const profileDir = path.join(profilesDir, profile)
const pkgPath = path.join(profileDir, 'package.json')
const modulesDir = path.join(profileDir, 'node_modules')
const linkPath = path.join(modulesDir, PKG)

console.log('dsh-study-coach 安装器')
console.log('='.repeat(46))
console.log('DSH_HOME   ', dshHome)
console.log('profile    ', profile)
console.log('插件目录   ', HERE)
console.log('目标链接   ', linkPath)
if (dry) console.log('\n[dry-run] 只看不改\n')

/* ------------------------------------------------------------ package.json */
let pkg
try {
  // Windows 上用记事本 / PS 5.1 存过的 JSON 常带 BOM，JSON.parse 会直接炸
  const raw = fs.readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, '')
  pkg = JSON.parse(raw)
} catch (e) {
  die(`profile 的 package.json 读不了：${e.message}`)
}

let changed = false
pkg.dependencies = pkg.dependencies || {}
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []

const wantDep = 'link:' + HERE.replace(/\\/g, '/')
const hasDep = !!pkg.dependencies[PKG]
const hasBundle = pkg.dsh.profile.bundles.includes(PKG)

if (hasDep) {
  console.log(`\n· dependencies 里已有（${pkg.dependencies[PKG]}）`)
} else {
  pkg.dependencies[PKG] = wantDep
  changed = true
  console.log(`\n· dependencies 加一行：${PKG} = ${wantDep}`)
}

if (hasBundle) {
  console.log('· bundles 里已有')
} else {
  pkg.dsh.profile.bundles.push(PKG)
  changed = true
  console.log(`· bundles 末尾加一项（现在 ${pkg.dsh.profile.bundles.length} 项）`)
}

if (changed && !dry) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const bak = `${pkgPath}.bak-install-${stamp}`
  fs.copyFileSync(pkgPath, bak)
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log('· 已写入，备份：' + path.basename(bak))
} else if (!changed) {
  console.log('· package.json 不用改')
}

/* ---------------------------------------------------------------- 建链接 */
let linkState = 'missing'
try {
  const st = fs.lstatSync(linkPath)
  if (st.isSymbolicLink() || st.isDirectory()) {
    let real = ''
    try {
      real = fs.realpathSync(linkPath)
    } catch {}
    linkState = path.resolve(real) === path.resolve(HERE) ? 'ok' : 'different'
  }
} catch {}

if (linkState === 'ok') {
  console.log('· node_modules 里已经链好了')
} else if (linkState === 'different') {
  console.log('· node_modules 里已有一个不同的 dsh-study-coach —— 没动它')
  console.log('  想换成这一份：先删掉 ' + linkPath + ' 再跑一次')
} else if (dry) {
  console.log('· 会建链接 node_modules/' + PKG)
} else {
  try {
    fs.mkdirSync(modulesDir, { recursive: true })
    // Windows 用 junction：不需要管理员权限，跨盘也能用
    fs.symlinkSync(HERE, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    console.log('· 已建链接 node_modules/' + PKG)
  } catch (e) {
    console.log('· 建链接失败：' + e.message)
    console.log('  手动来：')
    if (process.platform === 'win32') {
      console.log(`  cmd /c mklink /J "${linkPath}" "${HERE}"`)
    } else {
      console.log(`  ln -s "${HERE}" "${linkPath}"`)
    }
    process.exitCode = 1
  }
}

/* ------------------------------------------------------------------ 收尾 */
console.log('\n' + '='.repeat(46))
if (dry) {
  console.log('dry-run 结束，什么都没改。去掉 --dry-run 再跑一次。')
} else {
  console.log('装好了。**重启 DSH**，侧边栏会出现「📚 学习资源库」。')
  console.log('\n第一次用先自检一遍，它会告诉你这台机器缺什么：')
  console.log('  node doctor.mjs')
  console.log('\n注意：不要再把 dsh-study-coach 写进 profile 的 cordis.patch.yml ——')
  console.log('包自带 patch 层，写两次会报 duplicate loader entry id。')
}
