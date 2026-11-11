/**
 * dsh-study-coach / client.js
 *
 * 学习资源库面板 —— 纯 React，跑在 DSH 自己里面。
 *
 * 设计要点（这个插件是要发 GitHub 的，所以每一条都写清楚）：
 *
 * 1) 颜色全部走 CSS 变量，前缀 --sc-，注入一次 <style>。
 *    默认跟随系统（prefers-color-scheme），也支持手动浅色/深色，
 *    存在 localStorage 的 sc-theme 里。不硬编码任何颜色。
 * 2) 不用 window.prompt —— Electron 里行为不一致。「新科目」是内联表单。
 * 3) 分区不写死：从 /config 读，服务端决定 label 和目录，客户端只渲染。
 * 4) children 一律用 react.createElement 传，避免 jsx(type,props,key) 的坑。
 * 5) 请求走相对路径 api/study-coach/...（宿主有 <base href="./">），
 *    404 自动回退根绝对路径。
 */
window.__ModuleLoader__.load({
  id: 'dsh-study-coach',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    const PANEL_ID = 'study-coach-library'
    const PANEL_ORDER = 55
    const API = 'api/study-coach'
    const THEME_KEY = 'sc-theme'

/**
 * 打赏码的两个槽位。
 * 香港一张、内地一张 —— 香港学生用 AlipayHK / PayMe / FPS，内地来的同学用微信。
 * 图在 assets/ 下，换码只换文件，不动代码；缺哪张面板就把那一栏藏掉。
 */
const PAY_SLOTS = [
  { id: 'hk', label: '🇭🇰 香港', file: 'payme-hk.png', hint: 'AlipayHK / PayMe / FPS' },
  { id: 'cn', label: '🇨🇳 内地', file: 'payme.png', hint: '微信支付' },
]

    /* ============================================================ theme */
    const CSS = `
:root{
  --sc-bg:#F5F7FA; --sc-card:#FFFFFF; --sc-soft:#EFF3F8; --sc-line:#E4E9F0;
  --sc-ink:#1E2A3D; --sc-mute:#7B879A; --sc-nav:#1F3864;
  --sc-teal:#2E9E8F; --sc-teal-soft:#EAF4F2; --sc-amber:#B8860B; --sc-red:#C0392B;
  --sc-red-soft:#FDECEA; --sc-shadow:0 6px 20px rgba(31,56,100,.07);
}
@media (prefers-color-scheme: dark){
  :root{
    --sc-bg:#11141B; --sc-card:#1A1F29; --sc-soft:#232A36; --sc-line:#2C3442;
    --sc-ink:#E4E9F2; --sc-mute:#8B97AA; --sc-nav:#9FC0F5;
    --sc-teal:#43C4B0; --sc-teal-soft:#17332F; --sc-amber:#D9A441; --sc-red:#EF6B63;
    --sc-red-soft:#3A1E1C; --sc-shadow:0 6px 22px rgba(0,0,0,.42);
  }
}
html[data-sc-theme="light"]{
  --sc-bg:#F5F7FA; --sc-card:#FFFFFF; --sc-soft:#EFF3F8; --sc-line:#E4E9F0;
  --sc-ink:#1E2A3D; --sc-mute:#7B879A; --sc-nav:#1F3864;
  --sc-teal:#2E9E8F; --sc-teal-soft:#EAF4F2; --sc-amber:#B8860B; --sc-red:#C0392B;
  --sc-red-soft:#FDECEA; --sc-shadow:0 6px 20px rgba(31,56,100,.07);
}
html[data-sc-theme="dark"]{
  --sc-bg:#11141B; --sc-card:#1A1F29; --sc-soft:#232A36; --sc-line:#2C3442;
  --sc-ink:#E4E9F2; --sc-mute:#8B97AA; --sc-nav:#9FC0F5;
  --sc-teal:#43C4B0; --sc-teal-soft:#17332F; --sc-amber:#D9A441; --sc-red:#EF6B63;
  --sc-red-soft:#3A1E1C; --sc-shadow:0 6px 22px rgba(0,0,0,.42);
}
.sc-root{ color:var(--sc-ink); }
.sc-root *{ box-sizing:border-box; }
.sc-btn{ font:inherit;font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;
  border:1px solid var(--sc-line);background:var(--sc-card);color:var(--sc-ink);
  transition:background .14s,border-color .14s; white-space:nowrap; }
.sc-btn:hover{ background:var(--sc-soft); }
.sc-btn.pri{ background:var(--sc-teal);border-color:transparent;color:#fff;font-weight:650; }
.sc-btn.pri:hover{ filter:brightness(1.06); }
.sc-btn.danger{ background:var(--sc-red-soft);color:var(--sc-red);border-color:transparent; }
.sc-input{ font:inherit;font-size:12.5px;padding:7px 10px;border-radius:8px;
  border:1px solid var(--sc-line);background:var(--sc-card);color:var(--sc-ink);width:100%; }
.sc-input:focus{ outline:none;border-color:var(--sc-teal); }
.sc-scroll::-webkit-scrollbar{ width:8px;height:8px; }
.sc-scroll::-webkit-scrollbar-thumb{ background:var(--sc-line);border-radius:9px; }
.sc-doc{ font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.75;
  white-space:pre-wrap;word-break:break-word; }
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      const id = 'dsh-study-coach/style'
      if (document.querySelector('style[data-plugin-css="' + id + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-study-coach'
      tag.dataset.pluginCss = id
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function readTheme() {
      try {
        return localStorage.getItem(THEME_KEY) || 'auto'
      } catch {
        return 'auto'
      }
    }

    function applyTheme(mode) {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (mode === 'auto') delete root.dataset.scTheme
      else root.dataset.scTheme = mode
      try {
        localStorage.setItem(THEME_KEY, mode)
      } catch {}
    }

    /* ------------------------------------------------------------ icon */
    const PATHS = {
      book: [
        'M8 3.2C6.6 2 4.5 2 3 2v10.5c1.5 0 3.6 0 5 1.3 1.4-1.3 3.5-1.3 5-1.3V2c-1.5 0-3.6 0-5 1.2z',
        'M8 3.2v10.6',
      ],
      pen: ['M11.2 2.6l2.2 2.2L6 12.2l-3 .8.8-3z'],
      file: ['M4 2h5l3 3v9H4z', 'M9 2v3.2h3'],
      clip: ['M10.5 5.5l-4.6 4.6a1.7 1.7 0 002.4 2.4l4.8-4.8a3.3 3.3 0 00-4.7-4.7L3.2 8.2'],
    }

    function StudyIcon({ size }) {
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.3',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        PATHS.book.map((d, i) => h('path', { key: i, d })),
      )
    }

    function SecIcon({ name, size = 14 }) {
      const list = PATHS[name] || PATHS.clip
      return h(
        'svg',
        {
          viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
          stroke: 'currentColor', strokeWidth: '1.3',
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
          style: { flex: 'none' },
        },
        list.map((d, i) => h('path', { key: i, d })),
      )
    }

    /* ------------------------------------------------------------- api */
    async function req(path, opts) {
      const rel = `${API}/${path}`
      let r
      try {
        r = await fetch(rel, opts)
        if (r.status === 404) {
          const r2 = await fetch('/' + rel, opts)
          if (r2.ok) r = r2
        }
      } catch {
        r = await fetch('/' + rel, opts)
      }
      // 出错时把服务端写在 body 里的原因带出来。
      // 以前只抛「HTTP 503」，面板上就四个字，查不出是没模型还是没 python。
      if (!r.ok) {
        let why = ''
        try {
          const j = await r.json()
          const parts = [j.error, j.detail].filter(Boolean)
          why = parts.join('：')
          if (!why && j.message) why = String(j.message)
        } catch {
          try {
            const t = await r.text()
            why = String(t || '').slice(0, 200)
          } catch {}
        }
        throw new Error(why ? why : 'HTTP ' + r.status)
      }
      return r.json()
    }

    const api = {
      get: (p) => req(p),
      post: (p, body) =>
        req(p, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
        }),
      upload: (form) => req('upload', { method: 'POST', body: form }),
    }

    const pct = (m) => Math.round((Number(m) || 0) * 100)
    const colorOf = (m) =>
      m >= 0.9 ? 'var(--sc-teal)'
        : m >= 0.7 ? '#4E9BD6'
        : m >= 0.4 ? 'var(--sc-amber)'
        : 'var(--sc-red)'

    const FILE_ICON = {
      pdf: '📕', pptx: '📊', ppt: '📊', docx: '📄', doc: '📄',
      xlsx: '📈', xls: '📈', jpg: '🖼', jpeg: '🖼', png: '🖼', webp: '🖼',
      zip: '🗜', rar: '🗜', '7z': '🗜', txt: '📃', md: '📃', mp4: '🎬',
    }

    /**
     * 从科目里挑出「笔记文档」。
     * 抽成纯函数是因为要在两处用：组件顶部（算 effect 依赖）和渲染体里。
     * 两处各写一遍必然走样。
     */
    function pickNoteDocs(subject) {
      if (!subject) return []
      const out = []
      for (const [secKey, box] of Object.entries(subject.sections || {})) {
        for (const f of (box.files || [])) {
          if (!['md', 'docx', 'pdf', 'html', 'txt'].includes(f.ext)) continue
          const byName = /笔记|note|手册|总结|提纲|速记|精讲|cheatsheet|summary/i.test(f.name)
          if (byName || f.origin === 'generated') out.push({ ...f, sectionKey: secKey, isNote: byName })
        }
      }
      return out.sort((x, y) => {
        if (x.isNote !== y.isNote) return x.isNote ? -1 : 1
        // 同一天生成的「自动笔记」「总结」「速记卡」mtime 一模一样，
        // 只按日期排会随机开在「总结」上 —— 笔记页第一眼该是正文那份笔记。
        const rank = (f) => (/自动笔记|完整笔记|复习笔记|笔记/.test(f.name) ? 0
          : /手册|精讲/.test(f.name) ? 1
            : /总结|提纲|速记|摘要/.test(f.name) ? 2 : 3)
        const ra = rank(x)
        const rb = rank(y)
        if (ra !== rb) return ra - rb
        return String(y.mtime).localeCompare(String(x.mtime))
      })
    }

    /**
     * 把这些函数放到模块作用域，是因为组件里任何 `react.useXxx` 都必须在
     * **顶层、且在提前 return 之前**。写在下面（渲染流程里）= hooks 数量会随
     * 分支变化，React 抛 #310（rendered more hooks than during the previous render），
     * 整个面板直接黑屏。曾经真踩过。
     */
    const NOTE_EXTS = ['md', 'docx', 'pdf', 'html', 'txt']

    /* ============================================ markdown 渲染（笔记页用） */
    // 为什么自己写：面板里没有 markdown 依赖，而笔记是 .md 生成的。
    // 目标不是完整 CommonMark，是「读起来像一份笔记」—— 标题层级、表格、列表、加粗、代码块。
    // 用 <pre> 原样显示太难看（主人原话：想要的不是那个）。
    const MD_INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g

    function mdInline(text, base) {
      const out = []
      let pos = 0
      let i = 0
      let m
      MD_INLINE.lastIndex = 0
      while ((m = MD_INLINE.exec(text)) !== null) {
        if (m.index > pos) out.push(text.slice(pos, m.index))
        const t = m[0]
        const key = base + '-' + (i++)
        if (t.startsWith('**')) {
          out.push(h('b', { key, style: { color: 'var(--sc-ink)' } }, t.slice(2, -2)))
        } else if (t.startsWith('`')) {
          out.push(h('code', {
            key,
            style: {
              background: 'var(--sc-soft)', borderRadius: 4, padding: '0 4px',
              fontFamily: 'Consolas, ui-monospace, monospace', fontSize: '0.94em',
              color: 'var(--sc-red)',
            },
          }, t.slice(1, -1)))
        } else {
          out.push(h('i', { key }, t.slice(1, -1)))
        }
        pos = m.index + t.length
      }
      if (pos < text.length) out.push(text.slice(pos))
      return out
    }

    // 标题尺寸用 em（相对外层字号），这样面板上换字号时整篇跟着缩放。
    // 用 px 写死的话，用户把字号调到 18 也只有正文变、标题不动，很难看。
    const MD_HEAD = {
      1: { fontSize: '1.45em', marginTop: '1.1em', marginBottom: '0.55em', borderBottom: '2px solid var(--sc-teal)', paddingBottom: 6 },
      2: { fontSize: '1.22em', marginTop: '1em', marginBottom: '0.45em', borderBottom: '1px solid var(--sc-line)', paddingBottom: 4 },
      3: { fontSize: '1.06em', marginTop: '0.85em', marginBottom: '0.35em' },
      4: { fontSize: '1em', marginTop: '0.7em', marginBottom: '0.3em', color: 'var(--sc-mute)' },
    }

    function renderMarkdown(src) {
      const lines = String(src || '').replace(/\r\n/g, '\n').split('\n')
      const out = []
      let i = 0
      let k = 0
      const key = () => 'md' + (k++)

      while (i < lines.length) {
        const raw = lines[i]
        const line = raw.trim()

        if (!line) { i++; continue }

        // ``` 代码块
        if (line.startsWith('```')) {
          const buf = []
          i++
          while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++ }
          i++
          out.push(h('pre', {
            key: key(),
            style: {
              background: 'var(--sc-soft)', borderRadius: 8, padding: '10px 12px',
              overflow: 'auto', fontSize: '0.92em', lineHeight: 1.7, margin: '8px 0',
              fontFamily: 'Consolas, ui-monospace, monospace',
            },
          }, buf.join('\n')))
          continue
        }

        // | 表格 |
        if (line.startsWith('|') && line.split('|').length >= 3) {
          const rows = []
          while (i < lines.length && lines[i].trim().startsWith('|')) {
            const l = lines[i].trim()
            if (!/^\|?[\s:|-]{3,}\|?$/.test(l)) {
              rows.push(l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim()))
            }
            i++
          }
          if (rows.length) {
            const head = rows[0]
            const body = rows.slice(1)
            const ths = head.map((c, ci) =>
              h('th', {
                key: 'th' + ci,
                style: {
                  border: '1px solid var(--sc-line)', background: 'var(--sc-soft)',
                  padding: '6px 9px', textAlign: 'left', fontWeight: 700,
                  whiteSpace: 'nowrap',
                },
              }, mdInline(c, 'th' + ci)))
            const trs = body.map((row, ri) =>
              h('tr', { key: 'tr' + ri }, row.map((c, ci) =>
                h('td', {
                  key: 'td' + ci,
                  style: {
                    border: '1px solid var(--sc-line)', padding: '6px 9px',
                    verticalAlign: 'top', lineHeight: 1.6,
                  },
                }, mdInline(c, 'td' + ri + '-' + ci)))))
            out.push(h('div', { key: key(), style: { overflowX: 'auto', margin: '9px 0' } },
              h('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: '0.92em' } },
                h('thead', null, h('tr', null, ths)),
                h('tbody', null, trs))))
          }
          continue
        }

        // 标题
        const hm = /^(#{1,4})\s+(.*)$/.exec(line)
        if (hm) {
          const lv = hm[1].length
          out.push(h('div', {
            key: key(),
            style: {
              fontWeight: 750, color: 'var(--sc-nav)', lineHeight: 1.45,
              ...MD_HEAD[lv],
            },
          }, mdInline(hm[2], 'h' + k)))
          i++
          continue
        }

        // 分隔线
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
          out.push(h('hr', { key: key(), style: { border: 'none', borderTop: '1px solid var(--sc-line)', margin: '14px 0' } }))
          i++
          continue
        }

        // 引用
        if (line.startsWith('>')) {
          const buf = []
          while (i < lines.length && lines[i].trim().startsWith('>')) {
            buf.push(lines[i].trim().replace(/^>\s?/, ''))
            i++
          }
          out.push(h('div', {
            key: key(),
            style: {
              borderLeft: '3px solid var(--sc-line)', paddingLeft: 10, fontSize: '0.94em',
              color: 'var(--sc-mute)', fontSize: '0.94em', lineHeight: 1.75, margin: '8px 0',
            },
          }, buf.map((b, bi) => h('div', { key: bi }, mdInline(b, 'q' + bi)))))
          continue
        }

        // 列表（支持两空格缩进的子级）
        if (/^\s*([-*+]|\d+[.)])\s+/.test(raw)) {
          const items = []
          const ordered = /^\s*\d+[.)]\s+/.test(raw)
          while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
            const li = lines[i]
            const indent = (li.match(/^\s*/) || [''])[0].length
            const text = li.replace(/^\s*([-*+]|\d+[.)])\s+/, '')
            items.push(h('div', {
              key: 'li' + items.length,
              style: {
                display: 'flex', gap: 7, marginBottom: 4,
                paddingLeft: indent >= 2 ? 18 : 0, lineHeight: 1.75,
              },
            },
              h('span', { style: { color: 'var(--sc-teal)', flex: 'none', fontWeight: 700 } },
                ordered ? `${items.length}.` : '•'),
              h('div', { style: { flex: 1, minWidth: 0 } }, mdInline(text, 'li' + items.length))))
            i++
          }
          out.push(h('div', { key: key(), style: { margin: '0.4em 0' } }, items))
          continue
        }

        // 普通段落（连续行合并）
        const para = [line]
        i++
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^(#{1,4}\s|\||>|```|-{3,}|\s*([-*+]|\d+[.)])\s+)/.test(lines[i].trim())
        ) {
          para.push(lines[i].trim())
          i++
        }
        out.push(h('div', {
          key: key(),
          style: { fontSize: '1em', lineHeight: 1.85, margin: '0.45em 0', color: 'var(--sc-ink)' },
        }, mdInline(para.join(' '), 'p' + k)))
      }
      return out
    }

    /* =============================================================== UI */
    function StudyLibraryPanel() {
      const [config, setConfig] = react.useState(null)
      const [tree, setTree] = react.useState(null)
      const [state, setState] = react.useState(null)
      const [cur, setCur] = react.useState('')
      const [tab, setTab] = react.useState('files')
      const [sect, setSect] = react.useState('lecture')
      const [hot, setHot] = react.useState(false)
      const [busy, setBusy] = react.useState('')
      const [toast, setToast] = react.useState(null)
      const [modal, setModal] = react.useState(null)
      const [showAns, setShowAns] = react.useState(false)
      const [err, setErr] = react.useState(null)
      const [adding, setAdding] = react.useState(false)
      const [importing, setImporting] = react.useState(null)
      const [support, setSupport] = react.useState(false)
      const [payTab, setPayTab] = react.useState('hk')
      const [backup, setBackup] = react.useState(false)
      const [backupBusy, setBackupBusy] = react.useState(false)
      const backupInput = react.useRef(null)
      const [form, setForm] = react.useState({ code: '', name: '', examDate: '' })
      const [theme, setTheme] = react.useState(readTheme())
      const [doc, setDoc] = react.useState(null)
      const [sched, setSched] = react.useState(null)
      const [dayForm, setDayForm] = react.useState(null)
      const [ask, setAsk] = react.useState(false)
      const [askQ, setAskQ] = react.useState('')
      const [askLog, setAskLog] = react.useState([])
      const [askBusy, setAskBusy] = react.useState(false)
      const [trans, setTrans] = react.useState(false)
      const [transTarget, setTransTarget] = react.useState('en')
      const [transForce, setTransForce] = react.useState(false)
      const [transBusy, setTransBusy] = react.useState(false)
      const [transLog, setTransLog] = react.useState([])
      const [transPending, setTransPending] = react.useState(null)
      // 「整份文件」模式：翻译的是下载下来的讲义/试卷本身，不是知识点标题
      const [transMode, setTransMode] = react.useState('topics') // 'topics' | 'file'
      const [transFile, setTransFile] = react.useState('')
      const [transPreview, setTransPreview] = react.useState(null)
      const [transFileBusy, setTransFileBusy] = react.useState(false)
      const [transFileErr, setTransFileErr] = react.useState('')
      const [transSaved, setTransSaved] = react.useState('')
      const [gen, setGen] = react.useState(false)
      const [genSources, setGenSources] = react.useState(null)
      const [genPick, setGenPick] = react.useState({})
      const [genWant, setGenWant] = react.useState({
        note: true, summary: true, cheatsheet: false, docx: true, pptx: true, pdf: true,
        topics: false,
      })
      const [genJob, setGenJob] = react.useState(null)
      const [genBusy, setGenBusy] = react.useState(false)
      const [paper, setPaper] = react.useState(false)
      const [paperInfo, setPaperInfo] = react.useState(null)
      const [paperTpl, setPaperTpl] = react.useState('')
      const [paperFrom, setPaperFrom] = react.useState('')
      const [paperTo, setPaperTo] = react.useState('')
      const [paperAnswers, setPaperAnswers] = react.useState(true)
      const [paperPdf, setPaperPdf] = react.useState(true)
      const [paperBusy, setPaperBusy] = react.useState(false)
      const [paperJob, setPaperJob] = react.useState(null)
      const [calMonth, setCalMonth] = react.useState(() => {
        const d = new Date()
        return { y: d.getFullYear(), m: d.getMonth() }
      })
      const [models, setModels] = react.useState(null)
      const [modelOpen, setModelOpen] = react.useState(false)
      const [preview, setPreview] = react.useState(null)
      const [openLec, setOpenLec] = react.useState({})
      const [noteTab, setNoteTab] = react.useState('note')
      const [notePath, setNotePath] = react.useState('')
      const [noteDoc, setNoteDoc] = react.useState(null)
      // 笔记清单由服务端算（含「为什么算笔记」），null = 还没加载
      const [noteList, setNoteList] = react.useState(null)
      const [noteCands, setNoteCands] = react.useState([])
      const [noteAdding, setNoteAdding] = react.useState(false)
      // 生成偏好（图示 / 例题 / 详略 / 中英 / 公式）
      const [prefs, setPrefs] = react.useState(null)
      const [prefsSchema, setPrefsSchema] = react.useState([])
      const [noteFont, setNoteFont] = react.useState(() => {
        try { return localStorage.getItem('sc-note-font') || 'auto' } catch { return 'auto' }
      })
      const [noteSize, setNoteSize] = react.useState(() => {
        try {
          // 上限 84px：放到很大时是当放大镜用（看公式细节、演示给同学看）
          const v = Number(localStorage.getItem('sc-note-size'))
          return Number.isFinite(v) && v > 0 ? Math.min(84, Math.max(9, v)) : 13
        } catch { return 13 }
      })
      const [grade, setGrade] = react.useState(false)
      const [gradePapers, setGradePapers] = react.useState(null)
      const [gradePaper, setGradePaper] = react.useState('')
      const [gradeItems, setGradeItems] = react.useState([])
      const [gradeAns, setGradeAns] = react.useState({})
      const [gradeResult, setGradeResult] = react.useState(null)
      const [gradeBusy, setGradeBusy] = react.useState(false)

      /* ---- 试卷页（独立分区：逐题 + 手写作答） ----
         试卷以前只在「批改」抽屉里露脸，而且和笔记挤在一起、七道题一屏竖着排。
         现在单独一页：一屏一题，左边只有笔，中间题目，下面留白随便画。 */
      const [papersDocs, setPapersDocs] = react.useState(null)   // null = 还没拉过
      const [curPaperPath, setCurPaperPath] = react.useState('')
      const [paperItems, setPaperItems] = react.useState([])     // flattenPaper 的结构：no/section/stem/parts/marks/answer
      const [pi, setPi] = react.useState(0)                      // 当前第几题（0 起）
      const [inkColor, setInkColor] = react.useState('#1f6feb')
      const [inkW, setInkW] = react.useState(2.6)
      const [inkErase, setInkErase] = react.useState(false)
      const [inkVersion, setInkVersion] = react.useState(0)      // 加一 = 请求重绘（撤销/清空/换卷）
      const [inkTick, setInkTick] = react.useState(0)            // 抬笔时 +1，只为了让「画了几题」跟着动
      const [inkReady, setInkReady] = react.useState(false)      // canvas 挂上了没
      const [paperAnsOpen, setPaperAnsOpen] = react.useState(false)  // 试卷页：这题答案展开没
      const [boardBig, setBoardBig] = react.useState(false)          // 只看画板（题干收起来）
      const [paperImgs, setPaperImgs] = react.useState({})           // { A3: "C:/.../fig1.png" } 当前卷的配图
      const [paperLib, setPaperLib] = react.useState([])             // 科目里能当配图的图片
      const [imgPickFor, setImgPickFor] = react.useState(null)       // 正在给哪一题挑图（null = 抽屉关着）
      const [imgBusy, setImgBusy] = react.useState(false)
      // 笔迹不进 state：每一笔都 setState 会把整页重渲染几十次，画起来一顿一顿的。
      const inkStore = react.useRef({})       // { [题号]: [{ color, w, erase, pts:[[x,y],...] }] }
      const inkCanvas = react.useRef(null)
      const inkDrawing = react.useRef(null)   // 正在画的那一笔

      const [usageInfo, setUsageInfo] = react.useState(null)
      // 资料页默认不列 .md：生成的笔记不再出 md，剩下的只是历史文件/中间格式。
      // 文件没删，开关一开还能看到。
      const [showMd, setShowMd] = react.useState(false)
      // 做题（选择题形态）
      const [quiz, setQuiz] = react.useState(null)
      const [quizLoading, setQuizLoading] = react.useState(false)
      const [quizError, setQuizError] = react.useState(null)
      const [quizPick, setQuizPick] = react.useState(null)
      const depth = react.useRef(0)
      const folderInput = react.useRef(null)

      const say = (text, kind) => {
        setToast({ text, kind })
        clearTimeout(say._t)
        say._t = setTimeout(() => setToast(null), 2600)
      }

      react.useEffect(() => {
        ensureStyle()
        applyTheme(readTheme())
      }, [])

      react.useEffect(() => {
        applyTheme(theme)
      }, [theme])

      const loadAll = async () => {
        try {
          const [cfg, t] = await Promise.all([api.get('config'), api.get('tree')])
          setConfig(cfg)
          setTree(t)
          setErr(null)
          // 模型清单顺手拉一份：顶栏那个选择器要用
          api.get('models').then((m) => { if (m && m.ok) setModels(m) }).catch(() => {})
          api.get('usage?days=30').then((u) => { if (u && u.ok) setUsageInfo(u) }).catch(() => {})
          api.get('prefs').then((p) => {
            if (p && p.ok) { setPrefs(p.prefs); setPrefsSchema(p.schema || []) }
          }).catch(() => {})
          const subs = t.subjects || []
          if (!cur && subs.length) setCur(subs[0].code)
          return t
        } catch (e) {
          setErr(e.message || String(e))
          return null
        }
      }

      const loadState = async (code) => {
        if (!code) return
        try {
          setState(await api.get('state?code=' + encodeURIComponent(code)))
        } catch {}
      }

      const loadSched = async (code) => {
        if (!code) return
        try {
          setSched(await api.get('schedule?code=' + encodeURIComponent(code)))
        } catch (e) {
          setSched({ ok: false, events: [], types: [], error: e.message })
        }
      }

      react.useEffect(() => {
        loadAll()
      }, [])
      react.useEffect(() => {
        if (cur) { loadState(cur); loadSched(cur) }
      }, [cur])

      /* ---- 笔记清单（可手动增删） ---- */
      react.useEffect(() => {
        if (!cur) return
        let alive = true
        api.get('notes?code=' + encodeURIComponent(cur))
          .then((r) => {
            if (!alive) return
            if (r && r.ok) {
              setNoteList(r.list || [])
              setNoteCands(r.candidates || [])
            } else {
              setNoteList([])
            }
          })
          .catch(() => { if (alive) setNoteList([]) })
        return () => { alive = false }
      }, [cur, tree])

      /** 手动加 / 移除 / 恢复自动判定 */
      const setNoteFlag = async (path, action) => {
        try {
          const r = await api.post('notes', { code: cur, path, action })
          if (!r.ok) throw new Error(r.error || '改不动')
          setNoteList(r.list || [])
          setNoteCands(r.candidates || [])
          say(action === 'add' ? '已加入笔记' : action === 'remove' ? '已从笔记移除（文件没删）' : '已恢复自动判定', 'ok')
        } catch (e) {
          say('改不动：' + e.message, 'err')
        }
      }

      /* ---- 笔记自动加载（必须放在这里：组件顶部、提前 return 之前） ---- */
      // 依赖只有「当前笔记路径 + 科目」，不依赖 noteDoc —— 否则 setNoteDoc 会再触发自己，
      // 变成死循环。
      const noteSubjForEffect = ((tree && tree.subjects) || []).find((s) => s.code === cur) || null
      const noteDocsForEffect = pickNoteDocs(noteSubjForEffect)
      const curNoteForEffect = noteDocsForEffect.find((f) => f.path === notePath)
        || noteDocsForEffect[0]
        || null
      const curNoteKey = curNoteForEffect ? curNoteForEffect.path : ''

      react.useEffect(() => {
        if (!curNoteKey) return
        let alive = true
        const hit = noteDocsForEffect.find((f) => f.path === curNoteKey)
        setNoteDoc({ loading: true, name: hit ? hit.name : '', path: curNoteKey, ext: hit ? hit.ext : '' })
        ;(async () => {
          try {
            const r = await api.get(
              'preview?code=' + encodeURIComponent(cur) + '&path=' + encodeURIComponent(curNoteKey),
            )
            if (!alive) return
            if (!r.ok) throw new Error(r.error || '读不出来')
            setNoteDoc({ ...r, loading: false })
          } catch (e) {
            if (!alive) return
            setNoteDoc({
              loading: false, name: hit ? hit.name : '', path: curNoteKey,
              ext: hit ? hit.ext : '', error: e.message,
            })
          }
        })()
        return () => { alive = false }
      }, [curNoteKey, cur])

      const refresh = async () => {
        await loadAll()
        await loadState(cur)
        await loadSched(cur)
      }

      /* ============================================ 试卷页：读卷子 / 画笔 */

      /** 读一份卷子的题目（服务端 flattenPaper 摊平过，一题一条） */
      const openPaperItems = async (p, opts = {}) => {
        if (!p) { setPaperItems([]); return }
        try {
          const r = await api.get(
            'papers?code=' + encodeURIComponent(cur) + '&paper=' + encodeURIComponent(p),
          )
          if (!r || !r.ok || !r.detail) throw new Error((r && r.error) || '读不出这份卷子')
          const items = r.detail.items || []
          setPaperItems(items)
          setPi(0)
          setPaperAnsOpen(false)
          if (opts.keepInk !== true) setInkVersion((v) => v + 1)
        } catch (e) {
          say('读不出这份卷子：' + e.message, 'err')
          setPaperItems([])
        }
        // 配图单独拉：有些题必须看着图做，图不一定存在，拉不到就当没有
        try {
          const r2 = await api.get(
            'paper-images?code=' + encodeURIComponent(cur) + '&paper=' + encodeURIComponent(p),
          )
          if (r2 && r2.ok) {
            setPaperImgs(r2.images || {})
            setPaperLib(r2.library || [])
          }
        } catch {}
      }

      /** 给某一题挂图 / 摘图（path 空 = 摘掉） */
      const setImageFor = async (no, imgPath) => {
        if (!curPaperPath || !no) return
        setImgBusy(true)
        try {
          const r = await api.post('paper-images', {
            code: cur, paper: curPaperPath, no, path: imgPath || '',
          })
          if (!r || !r.ok) throw new Error((r && r.error) || '存不进去')
          setPaperImgs(r.images || {})
          say(imgPath ? '配图挂上了' : '配图摘掉了', 'ok')
          if (imgPath) setImgPickFor(null)
        } catch (e) {
          say('配图没存成：' + e.message, 'err')
        } finally {
          setImgBusy(false)
        }
      }

      /** 图片走 raw 路由：preview 是返回 JSON 的，当 <img src> 用不了 */
      const paperImgUrl = (p) => API + '/raw?path=' + encodeURIComponent(p)

      /** 切到试卷页 / 换科目时拉一次列表 */
      react.useEffect(() => {
        if (tab !== 'papers') return
        let alive = true
        ;(async () => {
          try {
            const r = await api.get('papers?code=' + encodeURIComponent(cur))
            if (!alive) return
            const list = (r && r.ok && Array.isArray(r.papers)) ? r.papers : []
            setPapersDocs(list)
            if (!list.length) { setPaperItems([]); setCurPaperPath(''); return }
            const keep = list.find((p) => p.path === curPaperPath)
            const pick = keep || list[0]
            setCurPaperPath(pick.path)
            await openPaperItems(pick.path)
          } catch {
            if (alive) { setPapersDocs([]); setPaperItems([]) }
          }
        })()
        return () => { alive = false }
      }, [tab, cur])

      /** 笔迹的存放键。
       *  不能只用题号 A1/A2 —— 每份卷子的题号都长一个样，换卷子会串到一起。
       *  前面带上卷子路径，按卷隔离。 */
      const inkKeyOf = (it) => (curPaperPath || '') + '::' + (it && it.no ? it.no : '')

      /** 一笔画到 canvas 上（重绘和增量都用它，保证两条路长得一样） */
      const drawStroke = (ctx, s) => {
        if (!ctx || !s || !s.pts || !s.pts.length) return
        ctx.save()
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
        ctx.strokeStyle = s.color || '#1f6feb'
        ctx.lineWidth = s.w || 2.6
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (s.pts.length === 1) {
          // 单点也要画出来（点一下就一个圆点）
          ctx.beginPath()
          ctx.arc(s.pts[0][0], s.pts[0][1], Math.max(0.5, (s.w || 2.6) / 2), 0, Math.PI * 2)
          ctx.fillStyle = s.color || '#1f6feb'
          ctx.fill()
        } else {
          ctx.beginPath()
          ctx.moveTo(s.pts[0][0], s.pts[0][1])
          for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1])
          ctx.stroke()
        }
        ctx.restore()
      }

      /** 把整张纸按当前题目的笔迹重画一遍（切题 / 撤销 / 清空 / 换尺寸都走这里） */
      const repaintInk = () => {
        const cv = inkCanvas.current
        if (!cv) return
        const box = cv.parentElement
        if (!box) return
        const dpr = window.devicePixelRatio || 1
        const w = Math.max(240, box.clientWidth)
        const h = Math.max(240, box.clientHeight)
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
        cv.style.width = w + 'px'
        cv.style.height = h + 'px'
        const ctx = cv.getContext('2d')
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        const item = paperItems[pi]
        if (!item) return
        for (const s of (inkStore.current[inkKeyOf(item)] || [])) drawStroke(ctx, s)
      }
      // 先让 canvas 挂上去，再谈画 —— 否则首次进试卷页 repaintInk 拿到 null 就白跑一次
      react.useEffect(() => {
        setInkReady(tab === 'papers')
      }, [tab])

      // 这个 effect 里不能读 pi/paperItems 之外的东西，否则每画一笔都会重排
      react.useEffect(() => {
        if (tab !== 'papers') return
        if (!inkReady) return
        repaintInk()
        // 画板会变（点「大板」、窗口变宽、下面答案展开挤走高度）。
        // 尺寸一变位图就被重置，笔迹会消失 —— 所以盯住它，一变就重画。
        // window resize 只管窗口，管不了「只是这块板变高了」，所以用 ResizeObserver。
        const cv = inkCanvas.current
        const box = cv && cv.parentElement
        if (!box || typeof ResizeObserver === 'undefined') {
          let t0 = 0
          const onResize = () => { clearTimeout(t0); t0 = setTimeout(() => repaintInk(), 180) }
          window.addEventListener('resize', onResize)
          return () => { window.removeEventListener('resize', onResize); clearTimeout(t0) }
        }
        let t = 0
        let lastW = 0
        let lastH = 0
        const ro = new ResizeObserver(() => {
          const w = box.clientWidth
          const h = box.clientHeight
          if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return
          lastW = w
          lastH = h
          clearTimeout(t)
          t = setTimeout(() => repaintInk(), 90)
        })
        lastW = box.clientWidth
        lastH = box.clientHeight
        ro.observe(box)
        return () => { ro.disconnect(); clearTimeout(t) }
      }, [tab, pi, paperItems, inkVersion, curPaperPath, inkReady, boardBig, paperAnsOpen])

      /** 指针位置 → 画布坐标（画布是按 dpr 放大的，事件坐标是 CSS 像素，正好对得上 CSS 尺寸） */
      const inkPoint = (e, cv) => {
        const r = cv.getBoundingClientRect()
        return [e.clientX - r.left, e.clientY - r.top]
      }

      const inkDown = (e) => {
        const cv = inkCanvas.current
        const item = paperItems[pi]
        if (!cv || !item) return
        if (e.pointerType === 'mouse' && e.button !== 0) return
        e.preventDefault()
        try { cv.setPointerCapture(e.pointerId) } catch {}
        const [x, y] = inkPoint(e, cv)
        const store = inkStore.current
        const key = inkKeyOf(item)
        if (!store[key]) store[key] = []
        const s = {
          color: inkErase ? 'rgba(0,0,0,1)' : inkColor,
          w: inkErase ? Math.max(10, inkW * 5) : inkW,
          erase: !!inkErase,
          pts: [[x, y]],
        }
        store[key].push(s)
        inkDrawing.current = s
        drawStroke(cv.getContext('2d'), s)
      }

      const inkMove = (e) => {
        const s = inkDrawing.current
        const cv = inkCanvas.current
        if (!s || !cv) return
        e.preventDefault()
        const [x, y] = inkPoint(e, cv)
        const prev = s.pts[s.pts.length - 1]
        // 挪不到 1px 就别记点，不然一条线里塞几千个点，重绘越来越慢
        if (prev && Math.abs(x - prev[0]) < 0.7 && Math.abs(y - prev[1]) < 0.7) return
        s.pts.push([x, y])
        const ctx = cv.getContext('2d')
        // 只画新增这一段，不整张重绘 —— 整张重绘在低端机上会拖笔
        ctx.save()
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.w
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(prev[0], prev[1])
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.restore()
      }

      const inkUp = (e) => {
        const cv = inkCanvas.current
        if (cv) { try { cv.releasePointerCapture(e.pointerId) } catch {} }
        if (inkDrawing.current) setInkTick((v) => v + 1)   // 只为刷新「画了 N 题」
        inkDrawing.current = null
      }

      const inkUndo = () => {
        const item = paperItems[pi]
        if (!item) return
        const list = inkStore.current[inkKeyOf(item)] || []
        if (!list.length) return
        list.pop()
        setInkVersion((v) => v + 1)
      }

      const inkClear = () => {
        const item = paperItems[pi]
        if (!item) return
        inkStore.current[inkKeyOf(item)] = []
        setInkVersion((v) => v + 1)
      }

      /* ------------------------------------------------ 日程 */
      const addEvent = async (payload) => {
        try {
          const r = await api.post('schedule', { code: cur, ...payload })
          if (!r.ok) throw new Error(r.error || '保存失败')
          setSched({ ...(sched || {}), events: r.events })
          say('已加入日程', 'ok')
          setDayForm(null)
        } catch (e) {
          say('保存失败：' + e.message, 'err')
        }
      }

      const delEvent = async (id) => {
        try {
          const r = await api.post('schedule/delete', { code: cur, id })
          if (!r.ok) throw new Error(r.error || '删除失败')
          setSched({ ...(sched || {}), events: r.events })
          say('已删除', 'ok')
        } catch (e) {
          say('删除失败：' + e.message, 'err')
        }
      }

      /* ------------------------------------------------ 问 AI */
      const sendAsk = async () => {
        const q = askQ.trim()
        if (!q || askBusy) return
        setAskQ('')
        setAskLog((l) => [...l, { role: 'me', text: q }])
        setAskBusy(true)
        try {
          const r = await api.post('ask', {
            code: cur,
            name: curSubj ? curSubj.name : '',
            question: q,
          })
          if (r.ok) setAskLog((l) => [...l, { role: 'ai', text: r.answer, model: r.model }])
          else setAskLog((l) => [...l, {
            role: 'err',
            text: r.error === 'no-llm'
              ? '这个 DSH 没有暴露模型服务，面板里问不了。把问题发到对话里我一样能答。'
              : '调用失败（' + r.error + '）：' + (r.detail || ''),
          }])
        } catch (e) {
          setAskLog((l) => [...l, { role: 'err', text: '请求失败：' + e.message }])
        } finally {
          setAskBusy(false)
        }
      }

      /* ------------------------------------------------ 中英对照翻译 */
      // 备课习惯：讲义中文、考卷英文。知识点两种标题都要有，
      // 所以这里只干一件事 —— 把缺的那一边补齐，写回 topics.json。
      const checkPending = async (target) => {
        setTransPending(null)
        try {
          const r = await api.post('translate', { code: cur, target, dryRun: true })
          if (r.ok) setTransPending(r.pending)
        } catch {}
      }

      const openTrans = () => {
        setTrans(true)
        setTransLog([])
        checkPending(transTarget)
      }

      const runTranslate = async () => {
        if (!cur || transBusy) return
        setTransBusy(true)
        const dir = transTarget === 'en' ? '中 → 英' : '英 → 中'
        setTransLog((l) => [...l, { role: 'info', text: `开始 ${dir}${transForce ? '（全部重译）' : ''}…` }])
        try {
          const r = await api.post('translate', {
            code: cur, target: transTarget, force: transForce,
          })
          if (!r.ok) {
            setTransLog((l) => [...l, {
              role: 'err',
              text: r.error === 'no-llm'
                ? '这个 DSH 没暴露模型服务，翻不了。把内容发到对话里我一样能翻。'
                : '失败（' + (r.error || '?') + '）：' + (r.detail || ''),
            }])
            return
          }
          if (!r.pending) {
            setTransLog((l) => [...l, { role: 'info', text: '没有需要翻译的条目。' }])
            return
          }
          setTransLog((l) => [...l, {
            role: 'info',
            text: `待翻 ${r.pending} 条 · 模型返回 ${r.translated} 条 · 写回 ${r.updated} 条 · 用时 ${(r.ms / 1000).toFixed(1)}s`,
          }])
          for (const p of (r.pairs || []).slice(0, 20)) {
            setTransLog((l) => [...l, { role: 'pair', text: p.k + '  →  ' + p.v }])
          }
          if (r.pairs && r.pairs.length > 20) {
            setTransLog((l) => [...l, { role: 'info', text: `…还有 ${r.pairs.length - 20} 条` }])
          }
          if (r.errors && r.errors.length) {
            setTransLog((l) => [...l, {
              role: 'err', text: '部分分块失败：' + r.errors.map((e) => e.error).join(', '),
            }])
          }
          await loadState(cur)
          checkPending(transTarget)
          say('翻译写回 ' + r.updated + ' 条', 'ok')
        } catch (e) {
          setTransLog((l) => [...l, { role: 'err', text: '请求失败：' + e.message }])
        } finally {
          setTransBusy(false)
        }
      }

      /* ------------------------------------------------ 整份文件翻译 */
      // 和上面的「知识点标题」不一样：这里翻的是讲义/试卷本身。
      // 流程：选文件 → translate/file（抽文本 + 分段 + 分批送模型）→ 一段原文一段译文 → 满意再存成 md。
      const EXTRACTABLE = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'csv']

      // 惰性求值：这个函数在组件体靠前的位置，curSubj / config 要到后面才算得出来
      const transFilesOf = () => {
        const subj = (subs || []).find((s) => s.code === cur) || null
        if (!subj || !subj.sections) return []
        const secLabels = (config && config.sections) || []
        const out = []
        for (const [key, box] of Object.entries(subj.sections)) {
          const label = secLabels.find((s) => s.key === key)?.label || key
          for (const f of (box && box.files) || []) {
            if (!EXTRACTABLE.includes(String(f.ext || '').toLowerCase())) continue
            out.push({ path: f.path, name: f.name, ext: f.ext, label: `${label} · ${f.name}` })
          }
        }
        return out
      }

      const runFileTranslate = async (force) => {
        if (!cur || !transFile || transFileBusy) return
        setTransFileBusy(true)
        setTransFileErr('')
        setTransSaved('')
        setTransPreview(null)
        try {
          const r = await api.post('translate/file', {
            code: cur, path: transFile, target: transTarget, force: !!force,
          })
          if (!r.ok) {
            setTransFileErr(
              r.error === 'no-llm'
                ? '这个 DSH 没暴露模型服务，翻不了。把文件发到对话里我一样能翻。'
                : (r.detail || r.error || '翻译失败'),
            )
            return
          }
          setTransPreview(r)
          const miss = (r.errors || []).length
          say(
            r.cached
              ? '走缓存，没花 token'
              : `翻好 ${r.segments.length} 段${miss ? `（${miss} 批失败）` : ''}`,
            miss ? 'err' : 'ok',
          )
        } catch (e) {
          setTransFileErr('请求失败：' + e.message)
        } finally {
          setTransFileBusy(false)
        }
      }

      const saveFileTranslate = async () => {
        if (!transPreview || !transPreview.ok || !cur) return
        try {
          const r = await api.post('translate/file/save', {
            code: cur,
            path: transPreview.path,
            target: transPreview.target,
            segments: transPreview.segments,
          })
          if (!r.ok) { setTransFileErr(r.error || '保存失败'); return }
          setTransSaved(r.path)
          say('存成 ' + r.name, 'ok')
        } catch (e) {
          setTransFileErr('保存失败：' + e.message)
        }
      }

      /* ------------------------------------------------ 来源标记 */
      // 「这个是老师发的还是 AI 生成的」判错过一次（讲义被生成物占满），
      // 所以给每个文件一个可以手动纠正的开关。
      const toggleMark = async (f) => {
        const next = f.origin !== 'generated'
        try {
          const r = await api.post('mark', { code: cur, path: f.path, generated: next })
          if (!r.ok) throw new Error(r.error || '标记失败')
          await loadAll()
          say(next ? '已标为 DSH 生成' : '已标为原件', 'ok')
        } catch (e) {
          say('标记失败：' + e.message, 'err')
        }
      }

      const backfillMarks = async () => {
        try {
          const r = await api.post('generated/backfill', { code: cur })
          if (!r.ok) throw new Error(r.error || '失败')
          await loadAll()
          say(`补记 ${r.added} 个生成物（原有标记 ${r.kept} 个）`, 'ok')
        } catch (e) {
          say('补记失败：' + e.message, 'err')
        }
      }

      /* ------------------------------------------------ 交卷批改 */
      // 做完整份卷子 → 在这里逐题填答案 → 交上去让模型判分 + 讲错在哪。
      // 练习题源 = 出卷时落的 .json（里面每题都带参考答案）。
      const openGrade = async () => {
        setGrade(true)
        setGradeResult(null)
        setGradePapers(null)
        try {
          const r = await api.get('papers?code=' + encodeURIComponent(cur))
          if (r.ok) {
            setGradePapers(r.papers || [])
            const first = (r.papers || [])[0]
            if (first && !gradePaper) {
              setGradePaper(first.path)
              loadGradePaper(first.path)
            }
          } else {
            setGradePapers([])
          }
        } catch (e) {
          setGradePapers([])
          say('读不到练习卷：' + e.message, 'err')
        }
      }

      const loadGradePaper = async (p) => {
        if (!p) return
        setGradeItems([])
        setGradeAns({})
        setGradeResult(null)
        try {
          const r = await api.get(
            'papers?code=' + encodeURIComponent(cur) + '&paper=' + encodeURIComponent(p),
          )
          if (r.ok && r.detail) setGradeItems(r.detail.items || [])
        } catch (e) {
          say('读不到题目：' + e.message, 'err')
        }
      }

      const submitGrade = async () => {
        if (gradeBusy || !gradePaper) return
        const filled = Object.values(gradeAns).filter((v) => String(v || '').trim()).length
        if (!filled) {
          say('先写点答案再交', 'err')
          return
        }
        setGradeBusy(true)
        setGradeResult(null)
        try {
          const r = await api.post('grade', { code: cur, paper: gradePaper, answers: gradeAns })
          if (!r.ok) throw new Error(r.error || '批改失败')
          setGradeResult(r)
          say(`批改完成：${r.total} / ${r.full}（${r.percent}%）`, 'ok')
        } catch (e) {
          say('批改失败：' + e.message, 'err')
        } finally {
          setGradeBusy(false)
        }
      }

      /* ------------------------------------------------ 用量（计费） */
      // 只统计「本插件发起的调用」（问 / 翻译 / 生成 / 出卷 / 批改）。
      // 费用要自己填单价才算 —— 大多数通道免费，编一个假价格没意义。
      const loadUsage = async () => {
        try {
          const u = await api.get('usage?days=30')
          if (u && u.ok) setUsageInfo(u)
        } catch {}
      }

      const showUsage = () => {
        if (!usageInfo) return
        const u = usageInfo
        const fe = Object.entries(u.byFeature)
          .sort((a, b) => b[1].tokens - a[1].tokens)
          .map(([k, v]) => `| ${k} | ${v.calls} | ${v.tokens} | ${v.fails || 0} |`)
        const mo = Object.entries(u.byModel)
          .sort((a, b) => b[1].tokens - a[1].tokens)
          .slice(0, 8)
          .map(([k, v]) => `| ${k} | ${v.calls} | ${v.tokens} |`)
        const md = [
          `# 学习资源库 · 近 ${u.days} 天用量`,
          '',
          `- 调用 **${u.calls}** 次（失败 ${u.fails} 次）`,
          `- 估算 **${u.tokens}** tokens（${u.chars} 字符）`,
          `- 平均每次 ${u.avgMs} ms`,
          u.cost != null ? `- 按你填的单价（${u.pricePerMTok}/百万 token）约 **${u.cost}**` : '- 费用：没填单价，只统计用量',
          '',
          '> 只算这个插件发起的调用，不含你在对话里的用量。',
          '',
          '## 按功能',
          '',
          '| 功能 | 次数 | tokens | 失败 |',
          '| --- | --- | --- | --- |',
          ...fe,
          '',
          '## 按模型',
          '',
          '| 模型 | 次数 | tokens |',
          '| --- | --- | --- |',
          ...mo,
        ].join('\n')
        setDoc({ ok: true, kind: 'usage', markdown: md, filename: 'usage.md', locale: 'zh' })
      }

      /** 改一个偏好，立刻存 + 立刻回显 */
      const setPref = async (key, value) => {
        setPrefs((p) => ({ ...(p || {}), [key]: value }))
        try {
          const r = await api.post('prefs', { [key]: value })
          if (r && r.ok) setPrefs(r.prefs)
        } catch (e) {
          say('保存偏好失败：' + e.message, 'err')
        }
      }

      /* ------------------------------------------------ 模型选择 */
      // 插件自己猜通道会撞上掉线的 provider（deepseek-official / deepseek-account 都空回）。
      // 所以把选择权交出来：选过的存进 model.json，所有 AI 功能立刻改用这个。
      const pickModel = async (provider, model, effort) => {
        try {
          if (!provider && effort === undefined) {
            const r = await api.post('models', { reset: true })
            if (!r.ok) throw new Error(r.error || '失败')
            say('已改回自动选通道', 'ok')
          } else {
            const body = {}
            if (provider) {
              body.provider = provider
              body.model = model
            }
            if (effort !== undefined) body.effort = effort
            const r = await api.post('models', body)
            if (!r.ok) throw new Error(r.error || '失败')
            say(effort !== undefined && !provider ? '推理等级：' + (effort || '自动') : '模型：' + model, 'ok')
          }
          const m = await api.get('models')
          if (m && m.ok) setModels(m)
          setModelOpen(false)
        } catch (e) {
          say('保存失败：' + e.message, 'err')
        }
      }

      /* ------------------------------------------------ 面板内预览 */
      // Electron 里 `<a target="_blank">` 打不开新窗口，点了像没反应 —— 这就是
      // 「文件打不开」的真相。所以预览全在面板里做：
      //   PDF / 图片 → iframe 直接内嵌（浏览器自己会渲染）
      //   docx / pptx → 服务端抽成纯文本给面板显示（Electron 没有 Office 渲染器）
      // 想用 Word 看，右上角「另存」下载。
      const openPreview = async (f) => {
        if (!f || !f.path) return
        setPreview({ loading: true, name: f.name || String(f.path).split(/[\\/]/).pop(), path: f.path, ext: (f.ext || '') })
        try {
          const r = await api.get(
            'preview?code=' + encodeURIComponent(cur) + '&path=' + encodeURIComponent(f.path),
          )
          if (!r.ok) throw new Error(r.error || '预览失败')
          setPreview({ ...r, loading: false })
        } catch (e) {
          setPreview({ loading: false, error: e.message, name: f.name, path: f.path, ext: f.ext || '' })
        }
      }

      const fileUrl = (p) => API + '/file?path=' + encodeURIComponent(p) + '&t=' + Date.now()

      /** 另存到本机（Electron 里 <a download> 是有效的，比 target=_blank 靠谱） */
      const downloadFile = (f) => {
        if (!f || !f.path) return
        const a = document.createElement('a')
        a.href = fileUrl(f.path)
        a.download = f.name || 'download'
        a.click()
      }

      /** 把绝对路径裁成「相对工作区」的形式，面板上好看也好认 */
      const relPath = (p) => {
        const ws = (config && config.workspace) || ''
        const s = String(p || '')
        if (!ws) return s
        const i = s.toLowerCase().indexOf(ws.toLowerCase())
        if (i !== 0) return s
        return s.slice(ws.length).replace(/^[\\/]/, '')
      }

      /* ------------------------------------------------ 一键生成流水线 */
      // 讲义进来 → 抽文本 → 提炼知识点/题卡 → 出笔记/总结/速记/Word/PPT。
      // 面板这侧只做两件事：开跑、轮询；脏活都在服务端。
      const openGen = async () => {
        setGen(true)
        setGenJob(null)
        setGenSources(null)
        try {
          const r = await api.get('sources?code=' + encodeURIComponent(cur))
          if (r.ok) {
            setGenSources(r)
            const pick = {}
            for (const f of r.files || []) pick[f.path] = true
            setGenPick(pick)
          } else {
            setGenSources({ ok: false, error: r.error, files: [] })
          }
        } catch (e) {
          setGenSources({ ok: false, error: e.message, files: [] })
        }
      }

      // 通用轮询：一键生成和出卷共用同一条 job 接口，只是结果落到各自的 state
      const pollJobFor = async (jobId, setJ, setB, onDone) => {
        let last = null
        for (let i = 0; i < 1200; i++) {
          await new Promise((r) => setTimeout(r, 1200))
          try {
            const r = await api.get('pipeline/status?id=' + encodeURIComponent(jobId))
            if (!r.ok) {
              setJ((j) => (j ? { ...j, state: 'failed', step: r.error } : j))
              break
            }
            setJ(r.job)
            last = r.job
            if (r.job.state !== 'running') break
          } catch {
            // 单次轮询失败不结束，网络抖一下很正常
          }
        }
        setB(false)
        try {
          await refresh()
        } catch {}
        // 跑完了却一个文件都没有 —— 以前只在抽屉里静静显示「文件 0 个」，
        // 切到笔记页当然什么都没有。这里必须主动喊一声。
        if (last && last.state !== 'running') {
          const n = (last.out && Array.isArray(last.out.files)) ? last.out.files.length : 0
          if (!n) say('这次一个文件都没产出，原因在下面日志的最后几行', 'err')
          else say('生成完成：' + n + ' 个文件，已放进资料库', 'ok')
        }
        try { if (typeof onDone === 'function') onDone() } catch {}
      }

      // 一键生成跑完自动切到「笔记」页 —— 产出的就是笔记，停在资料页看不到成果
      const pollJob = (jobId) => pollJobFor(jobId, setGenJob, setGenBusy, () => setTab('notes'))

      const startGen = async () => {
        if (genBusy) return
        const files = Object.keys(genPick).filter((p) => genPick[p])
        if (!files.length) {
          say('先勾至少一份讲义', 'err')
          return
        }
        setGenBusy(true)
        setGenJob({ state: 'running', step: '正在启动…', progress: { done: 0, total: files.length }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
        try {
          const r = await api.post('pipeline/start', { code: cur, files, want: genWant, prefs })
          if (!r.ok) throw new Error(r.error || '启动失败')
          say('流水线已启动', 'ok')
          pollJob(r.jobId)
        } catch (e) {
          setGenBusy(false)
          setGenJob({ state: 'failed', step: '启动失败：' + e.message, progress: { done: 0, total: 0 }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
        }
      }

      /* ------------------------------------------------ 出练习卷（照真卷版式） */
      // 主人手里有校内真卷，自己发明的版式跟考场对不上。所以这里分两步：
      //   ① 拿真卷解析版式（Section 结构 / 题数 / 分值 / 出题口吻样本）
      //   ② 选章节范围，按那个骨架填题
      const openPaper = async () => {
        setPaper(true)
        setPaperJob(null)
        setPaperInfo(null)
        try {
          const r = await api.get('paper/scope?code=' + encodeURIComponent(cur))
          if (r.ok) {
            setPaperInfo(r)
            if (!paperTpl && r.templates && r.templates.length) {
              // 默认选一份看起来像真卷的（优先名字里带 exam / paper 的）
              const liked = r.templates.find((f) => /exam|paper|test|真/i.test(f.name)) || r.templates[0]
              setPaperTpl(liked.path)
            }
            // 默认范围：从最小章到最大章
            const nums = (r.options || []).map((o) => o.num).filter((n) => n != null)
            if (nums.length && paperFrom === '' && paperTo === '') {
              setPaperFrom(String(Math.min(...nums)))
              setPaperTo(String(Math.max(...nums)))
            }
          } else {
            setPaperInfo({ ok: false, error: r.error, templates: [], options: [] })
          }
        } catch (e) {
          setPaperInfo({ ok: false, error: e.message, templates: [], options: [] })
        }
      }

      const analyzePaper = async () => {
        if (paperBusy || !paperTpl) return
        setPaperBusy(true)
        setPaperJob({ state: 'running', step: '正在解析真卷版式…（十几秒）', progress: { done: 0, total: 1 }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
        try {
          const r = await api.post('paper/analyze', { code: cur, file: paperTpl })
          if (!r.ok) throw new Error((r.error || '失败') + (r.detail ? '：' + r.detail : ''))
          setPaperInfo((info) => ({
            ...(info || {}),
            ok: true,
            current: {
              sourceName: r.template.sourceName,
              analyzedAt: r.template.analyzedAt,
              sections: r.template.sections.map((s) => ({ name: s.name, questionCount: s.questionCount, marks: s.marks })),
            },
          }))
          setPaperJob({
            state: 'done', step: '版式解析完成', progress: { done: 1, total: 1 },
            logs: r.template.sections.map((s) => ({
              text: `${s.name}：${s.questionCount} 题${s.marksPerQuestion ? ' · 每题 ' + s.marksPerQuestion + ' 分' : ''}`,
              kind: 'info',
            })),
            out: { topics: 0, cards: 0, files: [] }, errors: [],
          })
        } catch (e) {
          setPaperBusy(false)
          setPaperJob({ state: 'failed', step: '解析失败：' + e.message, progress: { done: 0, total: 0 }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
          return
        } finally {
          setPaperBusy(false)
        }
      }

      const startPaper = async () => {
        if (paperBusy) return
        setPaperBusy(true)
        setPaperJob({ state: 'running', step: '正在出题…', progress: { done: 0, total: 1 }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
        try {
          const r = await api.post('paper/generate', {
            code: cur,
            from: paperFrom === '' ? null : Number(paperFrom),
            to: paperTo === '' ? null : Number(paperTo),
            answers: paperAnswers,
            pdf: paperPdf,
          })
          if (!r.ok) throw new Error(r.error || '启动失败')
          pollJobFor(r.jobId, setPaperJob, setPaperBusy)
        } catch (e) {
          setPaperBusy(false)
          setPaperJob({ state: 'failed', step: '启动失败：' + e.message, progress: { done: 0, total: 0 }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
        }
      }

      const renderOnly = async () => {        if (genBusy) return
        setGenBusy(true)
        setGenJob({ state: 'running', step: '正在重排文档…', progress: { done: 0, total: 1 }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
        try {
          const r = await api.post('pipeline/render', { code: cur, kinds: ['docx', 'pptx'] })
          if (!r.ok) throw new Error(r.error || '失败')
          setGenJob({
            state: 'done',
            step: '重排完成',
            progress: { done: 1, total: 1 },
            logs: (r.files || []).map((f) => ({ text: f.kind + ' → ' + f.name, kind: 'info' })),
            out: { topics: 0, cards: 0, files: r.files || [] },
            errors: [],
          })
          await refresh()
        } catch (e) {
          setGenJob({ state: 'failed', step: '失败：' + e.message, progress: { done: 0, total: 0 }, logs: [], out: { topics: 0, cards: 0, files: [] }, errors: [] })
        } finally {
          setGenBusy(false)
        }
      }

      /* ------------------------------------------------ 文件夹导入 */
      // 分区规则：先看目录层级（最准），再看文件名关键词。
      // 顺序很重要 —— 越具体的放前面，否则「真题答案卡」会被「答案」抢走。
      // 分区规则。顺序 = 优先级，从上往下第一个命中的赢。
      //
      // 关键一条：**讲义只留给老师发的原件**（Moodle 下载的 Lec / Chapter / 课件）。
      // 自己整理出来的笔记、速查、冲刺包、真题答案卡，统一进「参考」——
      // 否则讲义分区会被生成物淹没，原件反而找不到了。
      // 生成物的命名特征由服务端下发（/config 的 generatedPatterns），
      // 两边不再各写一份正则；拿不到就退回这条兜底，保证面板照样能用。
      const GENERATED_RE = (() => {
        const src = config && config.generatedPatterns
        if (!src) return /完整笔记|复习笔记|考前复习|冲刺|速查|知识点清单|中英对照|总结|提纲|思维导图|错题本|逐题精讲|答案卡|精讲|刷题/i
        try {
          return new RegExp(src, (config && config.generatedFlags) || 'i')
        } catch {
          return /完整笔记|复习笔记|考前复习|冲刺|速查|知识点清单|中英对照|总结|提纲|思维导图|错题本|逐题精讲|答案卡|精讲|刷题/i
        }
      })()

      const SEC_RULES = [
        {
          // 0. 自制资料 —— 优先级最高，因为这类名字里常混着 Ch1、章节号等词
          key: 'reference',
          dirs: null,
          name: GENERATED_RE,
        },
        {
          // 1. 试卷：真题、模拟卷、Practice Paper、答案
          key: 'exam',
          dirs: /(^|\/)(试卷|考題|考题|真题|past.?papers?|exams?|tests?)(\/|$)/i,
          name: /真题|试题|考卷|考題|模拟卷|模擬卷|past.?paper|practice.?paper|mock|exam|midterm|final|quiz|\btest\b|答案卡|題庫|题库/i,
        },
        {
          // 2. 作业：Tutorial、Lab、Assignment
          key: 'homework',
          dirs: /(^|\/)(tutorial|tutorials|作业|作業|homework|assignments?|labs?|exercise|exercises)(\/|$)/i,
          name: /\blab\b|作业|作業|homework|assignment|exercise|tutorial|实验|實驗|练习|練習|上机|上機/i,
        },
        {
          // 3. 讲义：只认音频/课件特征 —— lecture / lec N / chapter / 课件 / slides
          key: 'lecture',
          dirs: /(^|\/)(讲义|講義|lectures?|slides?|课件|課件)(\/|$)/i,
          name: /^lec\s*\d|lecture|\blec\s*\d|^chapter|\bchapter\s*\d|\bch\s*\d|\bweek\s*\d|\bunit\s*\d|\blect\d|课件|課件|slides?\b/i,
        },
        {
          // 4. 剩下明确是工具/参考的
          key: 'reference',
          dirs: /(^|\/)(参考|參考|reference|others?|misc|其他)(\/|$)/i,
          name: /参考|參考|reference|cheat|卡片|工具|清单|清單|readme|syllabus|大纲|大綱|时间表|時間表/i,
        },
      ]

      const guessSection = (relPath, fileName) => {
        const rel = String(relPath || '')
        const nm = String(fileName || rel)
        for (const r of SEC_RULES) {
          if (r.dirs && r.dirs.test(rel)) return { key: r.key, why: 'dir' }
        }
        for (const r of SEC_RULES) {
          if (r.name.test(nm)) return { key: r.key, why: 'name' }
        }
        return { key: 'reference', why: 'none' }
      }

      const openFolderPicker = () => {
        const el = folderInput.current
        if (!el) return
        el.value = ''
        el.click()
      }

      const onFolderPicked = (e) => {
        const list = [].slice.call(e.target.files || [])
        if (!list.length) return
        const rel0 = list[0].webkitRelativePath || list[0].name
        const top = rel0.split('/')[0] || 'SUBJECT'
        const m = top.match(/[A-Za-z]{2,4}\d{3,4}/)

        const groups = {}
        let unsure = 0
        for (const f of list) {
          const rel = f.webkitRelativePath || f.name
          const g = guessSection(rel, f.name)
          if (g.why === 'none') unsure++
          ;(groups[g.key] = groups[g.key] || []).push({ file: f, rel, name: f.name, size: f.size })
        }
        setImporting({
          folderName: top,
          code: m ? m[0].toUpperCase() : top.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
          name: top,
          examDate: '',
          groups,
          total: list.length,
          unsure,
          open: {},
        })
      }

      const doImport = async () => {
        if (!importing) return
        const code = String(importing.code || '').trim().toUpperCase()
        if (!code) return say('科目代码不能空', 'err')
        setBusy('正在导入…')
        try {
          const s = await api.post('subject', {
            code, name: importing.name || code, examDate: importing.examDate || '',
          })
          if (!s.ok) throw new Error(s.error || '建科目失败')

          let done = 0
          const failed = []
          for (const [sec, items] of Object.entries(importing.groups)) {
            if (!items.length) continue
            for (let i = 0; i < items.length; i += 20) {
              const batch = items.slice(i, i + 20)
              const fd = new FormData()
              fd.append('code', code)
              fd.append('section', sec)
              for (const it of batch) fd.append('files', it.file, it.name)
              try {
                const r = await api.upload(fd)
                if (r.ok) done += r.saved.length
                else failed.push(sec + ': ' + (r.error || '失败'))
              } catch (err) {
                failed.push(sec + ': ' + err.message)
              }
              setBusy('正在导入… ' + done + '/' + importing.total)
            }
          }
          setImporting(null)
          setCur(code)
          await loadAll()
          say(
            '导入完成：' + done + ' 个文件' + (failed.length ? '，' + failed.length + ' 批失败' : ''),
            failed.length ? 'err' : 'ok',
          )
        } catch (e) {
          say('导入失败：' + e.message, 'err')
        } finally {
          setBusy('')
        }
      }

      /* ------------------------------------------------ 上传 */
      const doUpload = async (files) => {
        if (!cur || !files || !files.length) return
        setBusy(`正在收 ${files.length} 个文件…`)
        try {
          const fd = new FormData()
          fd.append('code', cur)
          fd.append('section', sect)
          for (const f of files) fd.append('files', f, f.name)
          const r = await api.upload(fd)
          if (!r.ok) throw new Error(r.error || '上传失败')
          say(`已收进「${secLabel(sect)}」：${r.saved.length} 个`, 'ok')
          await refresh()
        } catch (e) {
          say('上传失败：' + e.message, 'err')
        } finally {
          setBusy('')
        }
      }

      const dragProps = {
        onDragEnter: (e) => {
          e.preventDefault(); e.stopPropagation()
          depth.current++; setHot(true)
        },
        onDragOver: (e) => {
          e.preventDefault(); e.stopPropagation(); setHot(true)
        },
        onDragLeave: (e) => {
          e.preventDefault(); e.stopPropagation()
          depth.current--
          if (depth.current <= 0) { depth.current = 0; setHot(false) }
        },
        onDrop: (e) => {
          e.preventDefault(); e.stopPropagation()
          depth.current = 0; setHot(false)
          const f = e.dataTransfer && e.dataTransfer.files
          if (f && f.length) doUpload([].slice.call(f))
        },
      }

      /* ------------------------------------------------ 科目 */
      const createSubject = async () => {
        const code = form.code.trim().toUpperCase()
        if (!code) return say('科目代码不能空', 'err')
        try {
          const r = await api.post('subject', {
            code, name: form.name.trim() || code, examDate: form.examDate.trim(),
          })
          if (!r.ok) throw new Error(r.error || '失败')
          setAdding(false)
          setForm({ code: '', name: '', examDate: '' })
          setCur(code)
          say('已新建 ' + code, 'ok')
          await loadAll()
        } catch (e) {
          say('新建失败：' + e.message, 'err')
        }
      }

      const del = async (p) => {
        if (!window.confirm('从资料库删掉这个文件？')) return
        try {
          const r = await api.post('delete', { path: p })
          if (!r.ok) throw new Error(r.error || '删除失败')
          say('已删除', 'ok')
          await refresh()
        } catch (e) {
          say('删除失败：' + e.message, 'err')
        }
      }

      /* ------------------------------------------------ 多选 / 批量操作 */
      // 一次性整理几十个文件时，一个一个点 × 太慢。所以：
      //   卡片左上角复选框 → 选中底部浮出操作条 → 批量删 / 批量标来源
      // 删除走后端 {paths:[...]}，后端只删文件、拒绝目录，并且逐条报错不整批失败。
      const [sel, setSel] = react.useState({})
      const selCount = Object.keys(sel).filter((k) => sel[k]).length
      const selPaths = Object.keys(sel).filter((k) => sel[k])
      const toggleSel = (p) => setSel((s) => ({ ...s, [p]: !s[p] }))
      const clearSel = () => setSel({})

      // secFiles 在下面才算出来，所以这里只能是函数（调用时求值），不能是常量
      const allPathsNow = () => {
        const out = []
        for (const f of secFiles) if (f && f.path) out.push(f.path)
        return out
      }
      const selectAll = () => {
        const next = {}
        for (const p of allPathsNow()) next[p] = true
        setSel(next)
      }

      const batchDelete = async () => {
        if (!selPaths.length) return
        const names = selPaths.map((p) => String(p).split(/[\\/]/).pop())
        const preview = names.slice(0, 5).join('、') + (names.length > 5 ? ` 等 ${names.length} 个` : '')
        if (!window.confirm(`删掉这 ${selPaths.length} 个文件？\n\n${preview}\n\n删了就没了，没有回收站。`)) return
        setBusy('正在删除 ' + selPaths.length + ' 个…')
        try {
          const r = await api.post('delete', { paths: selPaths })
          if (!r.ok) throw new Error(r.error || '删除失败')
          say(`已删除 ${r.deleted} 个${r.skipped && r.skipped.length ? `，跳过 ${r.skipped.length} 个` : ''}`, 'ok')
          clearSel()
          await refresh()
        } catch (e) {
          say('批量删除失败：' + e.message, 'err')
        } finally {
          setBusy('')
        }
      }

      const batchMark = async (generated) => {
        if (!selPaths.length) return
        setBusy('正在标记 ' + selPaths.length + ' 个…')
        try {
          let n = 0
          for (const p of selPaths) {
            const r = await api.post('mark', { code: cur, path: p, generated })
            if (r.ok) n++
          }
          say(`已标记 ${n} 个为${generated ? ' DSH 生成' : '原件'}`, 'ok')
          clearSel()
          await refresh()
        } catch (e) {
          say('批量标记失败：' + e.message, 'err')
        } finally {
          setBusy('')
        }
      }

      /* ------------------------------------------------ 多选上传 */
      const uploadInput = react.useRef(null)
      const pickFiles = () => {
        const el = uploadInput.current
        if (!el) return
        el.value = ''
        el.click()
      }
      const onFilesPicked = async (e) => {
        const list = [].slice.call(e.target.files || [])
        if (!list.length || !cur) return
        setBusy(`正在上传 ${list.length} 个文件…`)
        try {
          const form = new FormData()
          form.append('code', cur)
          form.append('section', sect)
          for (const f of list) form.append('files', f, f.name)
          const r = await api.upload(form)
          if (!r.ok) throw new Error(r.error || '上传失败')
          say(`上传 ${r.saved.length} 个到「${secLabel(r.redirectedTo || sect)}」`, 'ok')
          await refresh()
        } catch (err) {
          say('上传失败：' + err.message, 'err')
        } finally {
          setBusy('')
        }
      }

      const judge = async (correct, opts) => {
        if (!modal || !cur) return
        const silent = !!(opts && opts.silent)
        try {
          const r = await api.post('check', { code: cur, cardId: modal.id, correct })
          if (r.ok) {
            say((correct ? '✅ ' : '❌ ') + pct(r.masteryBefore) + '% → ' +
              pct(r.masteryAfter) + '%　下次 ' + r.nextDue, correct ? 'ok' : 'err')
            // 选择题里选完就判分，弹窗不关（还要看解析）；
            // 老路径（自评）还是关掉回列表。
            if (!silent) setModal(null)
            await loadState(cur)
            await loadAll()
          }
        } catch {
          say('记录失败', 'err')
        }
      }

      /**
       * 加载一道题的选择题形态。
       * 已经有缓存（cards.json 里的 mcq）就直接用，没有才让模型改造一次。
       */
      const loadQuiz = async (card) => {
        if (!card) return
        if (card.mcq && card.mcq.options && card.mcq.options.length >= 2) {
          setQuiz(card.mcq)
          setQuizError(null)
          setQuizLoading(false)
          setQuizPick(null)
          return
        }
        setQuizLoading(true)
        setQuizError(null)
        setQuiz(null)
        setQuizPick(null)
        try {
          const r = await api.post('quiz', { code: cur, cardId: card.id })
          if (!r.ok) throw new Error(r.detail || r.error || '生成失败')
          setQuiz(r.mcq)
        } catch (e) {
          setQuizError(e.message)
        } finally {
          setQuizLoading(false)
        }
      }

      /* ------------------------------------------------ 文档 */
      const makeDoc = async (kind, locale) => {
        if (!cur) return
        setBusy(kind === 'summary' ? '正在生成总结…' : '正在生成速记…')
        try {
          const r = await api.post('export', { code: cur, kind, locale, save: false })
          if (!r.ok) throw new Error(r.error || '生成失败')
          setDoc({ ...r, locale })
        } catch (e) {
          say('生成失败：' + e.message, 'err')
        } finally {
          setBusy('')
        }
      }

      const copyDoc = async () => {
        if (!doc) return
        try {
          await navigator.clipboard.writeText(doc.markdown)
          say('已复制到剪贴板', 'ok')
        } catch {
          say('复制失败，请手动选中', 'err')
        }
      }

      const saveDoc = async () => {
        if (!doc) return
        try {
          const r = await api.post('export', {
            code: cur, kind: doc.kind, locale: doc.locale, save: true,
          })
          if (!r.ok) throw new Error(r.error || '保存失败')
          say('已存到「参考」：' + r.filename, 'ok')
          setDoc(null)
          await refresh()
        } catch (e) {
          say('保存失败：' + e.message, 'err')
        }
      }

      const downloadDoc = () => {
        if (!doc) return
        const blob = new Blob([doc.markdown], { type: 'text/markdown;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = doc.filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      }

      const secLabel = (key) => {
        const s = (config && config.sections) || []
        const hit = s.find((x) => x.key === key)
        return hit ? hit.label : key
      }

      /* ------------------------------------------------ 加载 / 报错 */
      if (!tree || !config) {
        const boxErr = {
          padding: '15px 17px', borderRadius: 11, maxWidth: 470,
          background: 'var(--sc-red-soft)', color: 'var(--sc-red)',
          fontSize: 12.5, lineHeight: 1.7, fontFamily: 'Consolas,monospace',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }
        return h('div', {
          className: 'sc-root',
          style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 12, height: '100%', minHeight: 300,
            background: 'var(--sc-bg)', padding: 30,
          },
        },
          h('div', { style: { color: 'var(--sc-mute)', fontSize: 13 } },
            err ? '资源库接口没通' : '正在加载资源库…'),
          err ? h('div', { style: boxErr }, err + '\n\n' + API + '/tree') : null,
          err ? h('button', {
            className: 'sc-btn pri',
            onClick: () => { setErr(null); loadAll() },
          }, '重试') : null,
        )
      }

      const subs = tree.subjects || []
      const curSubj = subs.find((s) => s.code === cur) || null
      const sections = config.sections || []
      const secObj = (curSubj && curSubj.sections && curSubj.sections[sect]) || null
      // .md 默认不列（生成的笔记已经不出 md 了，剩下的属于历史/中间文件）
      const secFiles = ((secObj && secObj.files) || [])
        .filter((f) => showMd || f.ext !== 'md')
      const curSect = sections.find((s) => s.key === sect) || null
      const curState = state && state.current && state.current.code === cur ? state.current : null

      /* ------------------------------------------------ 左栏 */
      const side = h('aside', {
        style: {
          width: 220, flex: '0 0 220px', background: 'var(--sc-card)',
          borderRight: '1px solid var(--sc-line)', display: 'flex',
          flexDirection: 'column', overflow: 'hidden',
        },
      },
        h('div', {
          style: {
            padding: '14px 15px 7px', fontSize: 10.5, letterSpacing: '1.3px',
            color: 'var(--sc-mute)', fontWeight: 700, textTransform: 'uppercase',
          },
        }, '科目 Subjects'),
        h('div', { className: 'sc-scroll', style: { flex: 1, overflow: 'auto', padding: '0 9px 9px' } },
          subs.length
            ? subs.map((s) =>
              h('div', {
                key: s.code,
                onClick: () => setCur(s.code),
                style: {
                  display: 'flex', flexDirection: 'column', gap: 2,
                  padding: '9px 11px', borderRadius: 10, cursor: 'pointer',
                  marginBottom: 4,
                  border: '1px solid ' + (s.code === cur ? 'var(--sc-teal)' : 'transparent'),
                  background: s.code === cur ? 'var(--sc-teal-soft)' : 'transparent',
                },
              },
                h('div', { style: { fontWeight: 750, fontSize: 12.8 } }, s.code),
                h('div', {
                  style: {
                    fontSize: 11, color: 'var(--sc-mute)', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  },
                }, s.name || ''),
                h('div', { style: { fontSize: 10.8, color: 'var(--sc-teal)', fontWeight: 650, marginTop: 2 } },
                  `笔记 ${s.notes} · 题 ${s.cards}`),
              ))
            : h('div', { style: { padding: '16px 9px', fontSize: 11.2, color: 'var(--sc-mute)', lineHeight: 1.85 } },
              h('div', { style: { fontWeight: 700, fontSize: 12.4, color: 'var(--sc-ink)', marginBottom: 7 } },
                '还没有科目'),
              h('div', null, '① 点下面的「+ 新科目」'),
              h('div', null, '② 把课件拖进右边'),
              h('div', null, '③ 点 🪄 一键生成'),
              h('div', { style: { marginTop: 9, color: 'var(--sc-teal)', fontSize: 10.8 } },
                '嫌麻烦就直接「📂 导入文件夹」——它会按文件夹名自动建科目'))),
        adding
          ? h('div', { style: { padding: '0 11px 11px', display: 'flex', flexDirection: 'column', gap: 6 } },
            h('input', {
              className: 'sc-input', placeholder: '代码 例如 COMP2011',
              value: form.code, autoFocus: true,
              onChange: (e) => setForm({ ...form, code: e.target.value }),
              onKeyDown: (e) => { if (e.key === 'Enter') createSubject() },
            }),
            h('input', {
              className: 'sc-input', placeholder: '名字（可空）',
              value: form.name,
              onChange: (e) => setForm({ ...form, name: e.target.value }),
            }),
            h('input', {
              className: 'sc-input', placeholder: '考试日 YYYY-MM-DD（可空）',
              value: form.examDate,
              onChange: (e) => setForm({ ...form, examDate: e.target.value }),
            }),
            h('div', { style: { display: 'flex', gap: 6 } },
              h('button', { className: 'sc-btn pri', style: { flex: 1 }, onClick: createSubject }, '创建'),
              h('button', {
                className: 'sc-btn', style: { flex: 1 },
                onClick: () => { setAdding(false); setForm({ code: '', name: '', examDate: '' }) },
              }, '取消'),
            ))
          : h('div', { style: { margin: '8px 11px 12px', display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', {
              className: 'sc-btn',
              style: { textAlign: 'center', borderStyle: 'dashed' },
              onClick: () => setAdding(true),
            }, '+ 新科目'),
            h('div', {
              className: 'sc-btn',
              title: '选一个文件夹，把里面的资料全部导进来（自动分到讲义/作业/试卷）',
              style: { textAlign: 'center', background: 'var(--sc-teal-soft)', color: 'var(--sc-teal)', borderColor: 'transparent', fontWeight: 650 },
              onClick: openFolderPicker,
            }, '📂 导入文件夹'),
            h('input', {
              ref: folderInput,
              type: 'file',
              multiple: true,
              webkitdirectory: '',
              directory: '',
              style: { display: 'none' },
              onChange: onFolderPicked,
            })),
      )

      /* ------------------------------------------------ 底部工作栏 */
      // 原来是顶栏：按钮一排挤在标题旁边，内容区被压扁。挪到底部，
      // 像工具栏一样常驻，上面留全给资料/笔记。
      const headBar = h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px',
          borderTop: '1px solid var(--sc-line)', background: 'var(--sc-card)',
          flexWrap: 'wrap', flex: 'none',
        },
      },
        h('div', { style: { fontWeight: 700, fontSize: 13.5, marginRight: 4 } },
          curSubj ? curSubj.code : '—'),
        curState && curState.examDate
          ? h('span', { style: { fontSize: 11.5, color: 'var(--sc-mute)' } },
            curState.plan.daysLeft != null ? `距考试 ${curState.plan.daysLeft} 天` : '')
          : null,
        h('div', { style: { flex: 1 } }),
        h('button', {
          className: 'sc-btn',
          title: 'AI 功能（问 / 翻译 / 一键生成 / 出卷）用哪个模型',
          style: { maxWidth: 168, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          onClick: () => setModelOpen((v) => !v),
        }, '🧠 ' + (models && models.current ? models.current.model : '自动')),
        h('button', { className: 'sc-btn', onClick: () => setAsk(true) }, '💬 问'),
        h('button', {
          className: 'sc-btn pri',
          title: '做完卷子交上来，让模型逐题批改并讲错在哪',
          onClick: openGrade,
        }, '📝 批改'),
        h('button', {
          className: 'sc-btn',
          title: '讲义 → 笔记 / 总结 / 速记 / Word / PPT，一条流水线跑完',
          onClick: openGen,
        }, '🪄 一键生成'),
        h('button', {
          className: 'sc-btn',
          title: '照校内真卷的版式出练习卷（题目按章节范围换）',
          onClick: openPaper,
        }, '📝 出练习卷'),
        h('button', {
          className: 'sc-btn',
          title: '把知识点的中文标题和英文标题互相补齐（中英对照）',
          onClick: openTrans,
        }, '🌐 翻译'),
        h('button', { className: 'sc-btn', onClick: () => makeDoc('summary', 'both') }, '📄 总结'),
        h('button', { className: 'sc-btn', onClick: () => makeDoc('cheatsheet', 'both') }, '⚡ 速记'),
        h('button', {
          className: 'sc-btn',
          title: '备份 / 恢复：换机器、重装前先导一份',
          onClick: () => setBackup(true),
        }, '💾'),
        h('button', {
          className: 'sc-btn',
          title: '全部功能免费；用着顺手可以请作者喝杯奶茶',
          onClick: () => setSupport(true),
        }, '☕'),
        h('button', {
          className: 'sc-btn',
          title: '切换主题：跟随系统 / 浅色 / 深色',
          onClick: () => {
            const next = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto'
            setTheme(next)
            say('主题：' + (next === 'auto' ? '跟随系统' : next === 'light' ? '浅色' : '深色'), 'ok')
          },
        }, theme === 'auto' ? '🌗' : theme === 'light' ? '☀️' : '🌙'),
        // 用量：点一下看明细（只算本插件发起的调用）
        h('div', {
          onClick: usageInfo ? showUsage : loadUsage,
          title: '本插件发起的模型调用（问/翻译/生成/出卷/批改），点开看明细',
          style: {
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
            padding: '4px 9px', borderRadius: 8, fontSize: 10.8,
            background: 'var(--sc-soft)', color: 'var(--sc-mute)',
            border: '1px solid var(--sc-line)', whiteSpace: 'nowrap',
          },
        },
          usageInfo
            ? `📊 ${usageInfo.calls} 次 · ${(usageInfo.tokens / 1000).toFixed(1)}k tok`
            : '📊 用量'),
      )

      /* ------------------------------------------------ 预览层 */
      const previewEl = preview
        ? (() => {
          const isPdf = preview.ext === 'pdf'
          const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(preview.ext)
          let body = null
          if (preview.loading) {
            body = h('div', { style: { padding: 30, textAlign: 'center', color: 'var(--sc-mute)', fontSize: 12.5 } },
              '正在打开…')
          } else if (preview.error) {
            body = h('div', { style: { padding: 26, color: 'var(--sc-red)', fontSize: 12.5, lineHeight: 1.8 } },
              '打开失败：' + preview.error)
          } else if (isPdf) {
            body = h('iframe', {
              src: fileUrl(preview.path),
              title: preview.name,
              style: { width: '100%', height: '100%', border: 'none', background: '#fff' },
            })
          } else if (isImg) {
            body = h('div', { style: { padding: 14, overflow: 'auto', height: '100%', textAlign: 'center' } },
              h('img', {
                src: fileUrl(preview.path),
                alt: preview.name,
                style: { maxWidth: '100%', borderRadius: 8 },
              }))
          } else if (preview.kind === 'text' && preview.text) {
            body = h('div', { style: { height: '100%', overflow: 'auto', padding: '14px 18px' } },
              preview.truncated
                ? h('div', { style: { fontSize: 10.8, color: 'var(--sc-amber)', marginBottom: 8 } },
                  '文件比较长，只显示了前面一部分。')
                : null,
              preview.note
                ? h('div', { style: { fontSize: 10.8, color: 'var(--sc-mute)', marginBottom: 8 } }, preview.note)
                : null,
              h('pre', {
                style: {
                  margin: 0, fontFamily: 'Consolas, "Cascadia Mono", monospace',
                  fontSize: 11.6, lineHeight: 1.75, whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', color: 'var(--sc-ink)',
                },
              }, preview.text))
          } else {
            body = h('div', { style: { padding: 26, color: 'var(--sc-mute)', fontSize: 12.5, lineHeight: 1.9 } },
              preview.note || '这个类型面板里预览不了。',
              h('br'),
              h('br'),
              '点右上角「另存」下载，用对应软件打开。')
          }

          return h('div', {
            style: {
              position: 'absolute', inset: 0, background: 'rgba(10,14,22,.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 70, padding: 18,
            },
            onClick: (e) => { if (e.target === e.currentTarget) setPreview(null) },
          },
            h('div', {
              style: {
                width: 'min(980px,98%)', height: 'min(100%, 92%)',
                background: 'var(--sc-card)', borderRadius: 14,
                border: '1px solid var(--sc-line)', boxShadow: 'var(--sc-shadow)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              },
            },
              h('div', {
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px',
                  borderBottom: '1px solid var(--sc-line)', flexWrap: 'wrap',
                },
              },
                h('span', { style: { fontSize: 14 } },
                  FILE_ICON[(preview.ext || '')] || '📎'),
                h('span', {
                  title: preview.path,
                  style: { fontWeight: 650, fontSize: 12.4, wordBreak: 'break-all', flex: 1, minWidth: 120 },
                }, preview.name),
                preview.sizeText
                  ? h('span', { style: { fontSize: 10.6, color: 'var(--sc-mute)' } }, preview.sizeText)
                  : null,
                isPdf || isImg
                  ? h('span', { style: { fontSize: 10.4, color: 'var(--sc-teal)' } }, '内嵌预览')
                  : preview.kind === 'text'
                    ? h('span', { style: { fontSize: 10.4, color: 'var(--sc-mute)' } },
                      `文本预览${preview.chars ? ' · ' + preview.chars + ' 字' : ''}`)
                    : null,
                h('button', {
                  className: 'sc-btn',
                  title: '用系统默认程序打开（Word / PowerPoint / PDF 阅读器）',
                  style: { padding: '3px 10px', fontSize: 11.4 },
                  onClick: () => openWithSystem(preview),
                }, '🖥 用系统程序打开'),
                h('button', {
                  className: 'sc-btn',
                  title: '下载到本机，用 Word / PowerPoint 打开',
                  style: { padding: '3px 10px', fontSize: 11.4 },
                  onClick: () => {
                    const a = document.createElement('a')
                    a.href = fileUrl(preview.path)
                    a.download = preview.name
                    a.click()
                  },
                }, '另存'),
                h('button', {
                  className: 'sc-btn',
                  style: { padding: '3px 10px', fontSize: 11.4 },
                  onClick: () => setPreview(null),
                }, '关闭')),
              h('div', { style: { flex: 1, minHeight: 0, background: 'var(--sc-bg)' } }, body)))
        })()
        : null

      /* ------------------------------------------------ 批改抽屉 */
      // 拆成三个小块拼，别写成八层嵌套 —— 嵌套一深括号就会错，错了整页黑屏。
      const gradeVerdict = {
        correct: { bg: 'var(--sc-teal-soft)', fg: 'var(--sc-teal)', label: '✅ 对' },
        partial: { bg: '#FFF7E6', fg: 'var(--sc-amber)', label: '◐ 部分' },
        wrong: { bg: 'var(--sc-red-soft)', fg: 'var(--sc-red)', label: '✗ 错' },
      }

      const gradePaperPicker = (() => {
        if (!gradePapers) {
          return h('div', { style: { fontSize: 12, color: 'var(--sc-mute)' } }, '正在找练习卷…')
        }
        if (!gradePapers.length) {
          return h('div', { style: { fontSize: 12, color: 'var(--sc-mute)', lineHeight: 1.9 } },
            '还没有可批改的练习卷。',
            h('br'),
            '先用「📝 出练习卷」出一份，做完再回来交。')
        }
        return h('div', null,
          h('div', { style: { fontSize: 11.4, fontWeight: 700, color: 'var(--sc-mute)', marginBottom: 6 } },
            '① 交哪一份'),
          h('select', {
            value: gradePaper,
            onChange: (e) => { setGradePaper(e.target.value); loadGradePaper(e.target.value) },
            style: {
              width: '100%', fontSize: 11.8, padding: '6px 8px', borderRadius: 7,
              border: '1px solid var(--sc-line)', background: 'var(--sc-card)',
              color: 'var(--sc-ink)', marginBottom: 12,
            },
          }, gradePapers.map((p) => h('option', { key: p.path, value: p.path },
            p.name + '（' + p.questions + ' 题 / ' + p.marks + ' 分）'))))
      })()

      const gradeScoreBar = (res) => h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
          borderRadius: 12, marginBottom: 12,
          background: res.percent >= 60 ? 'var(--sc-teal-soft)' : 'var(--sc-red-soft)',
        },
      },
        h('div', null,
          h('div', {
            style: {
              fontSize: 26, fontWeight: 800, lineHeight: 1.1,
              color: res.percent >= 60 ? 'var(--sc-teal)' : 'var(--sc-red)',
            },
          }, String(res.total)),
          h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)' } }, '/ ' + res.full + ' 分')),
        h('div', { style: { flex: 1 } },
          h('div', { style: { fontSize: 13, fontWeight: 700 } }, res.percent + '%'),
          h('div', { style: { fontSize: 10.8, color: 'var(--sc-mute)' } },
            '做了 ' + res.answered + '/' + res.total_questions + ' 题')),
        res.summary
          ? h('button', {
            className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.2 },
            onClick: () => setModal({ question: '整份总结', answer: res.summary, marks: 0 }),
          }, '看总结')
          : null)

      const gradeItemCard = (it) => {
        const vs = gradeVerdict[it.verdict] || gradeVerdict.wrong
        return h('div', {
          key: it.no,
          style: { border: '1px solid var(--sc-line)', borderRadius: 11, padding: '11px 13px', marginBottom: 9 },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 } },
            h('span', { style: { fontWeight: 800, fontSize: 12.4 } }, it.no),
            h('span', {
              style: {
                fontSize: 10.2, padding: '1px 7px', borderRadius: 6,
                background: vs.bg, color: vs.fg, fontWeight: 700,
              },
            }, vs.label),
            h('span', { style: { fontSize: 10.6, color: 'var(--sc-mute)' } }, it.score + ' / ' + it.marks),
            h('div', { style: { flex: 1 } }),
            h('span', { style: { fontSize: 10.2, color: 'var(--sc-mute)' } }, it.section || '')),
          h('div', {
            style: { fontSize: 11.6, color: 'var(--sc-mute)', lineHeight: 1.6, marginBottom: 5 },
          }, String(it.stem || '').slice(0, 120)),
          it.why ? h('div', { style: { fontSize: 12, color: vs.fg, lineHeight: 1.7 } }, it.why) : null,
          it.explain
            ? h('div', {
              style: {
                fontSize: 11.8, lineHeight: 1.75, marginTop: 6, padding: '8px 10px',
                borderRadius: 8, background: 'var(--sc-soft)', whiteSpace: 'pre-wrap',
              },
            }, it.explain)
            : null)
      }

      const gradeResultView = (res) => h('div', null,
        gradeScoreBar(res),
        res.items.map(gradeItemCard),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
          h('button', {
            className: 'sc-btn', style: { flex: 1, padding: '9px' },
            onClick: () => { setGradeResult(null); setGradeAns({}) },
          }, '重新做一遍'),
          h('button', {
            className: 'sc-btn pri', style: { flex: 1, padding: '9px' },
            onClick: submitGrade, disabled: gradeBusy,
          }, gradeBusy ? '批改中…' : '再交一次')))

      const gradeAnswerForm = (() => {
        const filled = Object.values(gradeAns).filter((v) => String(v || '').trim()).length
        if (!gradeItems.length) {
          return h('div', { style: { fontSize: 12, color: 'var(--sc-mute)' } }, '题目读取中…')
        }
        return h('div', null,
          h('div', { style: { fontSize: 11.4, fontWeight: 700, color: 'var(--sc-mute)', marginBottom: 8 } },
            '② 逐题写答案'),
          gradeItems.map((it) => h('div', { key: it.no, style: { marginBottom: 11 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 } },
              h('span', { style: { fontWeight: 800, fontSize: 12.2 } }, it.no),
              h('span', { style: { fontSize: 10.4, color: 'var(--sc-mute)' } }, it.marks + ' 分'),
              h('div', { style: { flex: 1 } }),
              gradeAns[it.no]
                ? h('span', { style: { fontSize: 10, color: 'var(--sc-teal)' } }, '已写')
                : null),
            h('div', {
              style: {
                fontSize: 11.4, color: 'var(--sc-mute)', lineHeight: 1.6,
                marginBottom: 5, maxHeight: 46, overflow: 'hidden',
              },
            }, String(it.stem || '').slice(0, 140)),
            it.parts && it.parts.length
              ? h('div', { style: { fontSize: 10.8, color: 'var(--sc-mute)', marginBottom: 4 } },
                it.parts.map((p) => p.label + ' ' + p.text).join('　'))
              : null,
            h('textarea', {
              value: gradeAns[it.no] || '',
              placeholder: '把解题过程 / 答案写在这里（可以有公式，不用排版）',
              onChange: (e) => setGradeAns({ ...gradeAns, [it.no]: e.target.value }),
              rows: 3,
              style: {
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                fontSize: 12, lineHeight: 1.6, padding: '7px 9px',
                borderRadius: 8, border: '1px solid var(--sc-line)',
                background: 'var(--sc-bg)', color: 'var(--sc-ink)', fontFamily: 'inherit',
              },
            }))),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' } },
            h('span', { style: { fontSize: 11, color: 'var(--sc-mute)', flex: 1 } },
              '已写 ' + filled + ' / ' + gradeItems.length + ' 题'),
            h('button', {
              className: 'sc-btn', disabled: gradeBusy, style: { padding: '8px 12px' },
              onClick: () => setGradeAns({}),
            }, '清空'),
            h('button', {
              className: 'sc-btn pri', disabled: gradeBusy,
              style: { padding: '8px 18px', fontWeight: 700 },
              onClick: submitGrade,
            }, gradeBusy ? '批改中…（十几秒）' : '提交批改')))
      })()

      const gradeEl = grade
        ? h('div', {
          style: {
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(520px,94%)',
            background: 'var(--sc-card)', borderLeft: '1px solid var(--sc-line)',
            display: 'flex', flexDirection: 'column', zIndex: 52,
            boxShadow: 'var(--sc-shadow)',
          },
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
              borderBottom: '1px solid var(--sc-line)',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 12.8 } },
              '📝 交卷批改' + (curSubj ? ' · ' + curSubj.code : '')),
            h('div', { style: { flex: 1 } }),
            h('button', {
              className: 'sc-btn', style: { padding: '2px 9px', fontSize: 12 },
              onClick: () => setGrade(false),
            }, '×')),
          h('div', {
            className: 'sc-scroll',
            style: { flex: 1, overflow: 'auto', padding: '13px 14px' },
          },
            gradePaperPicker,
            gradeResult ? gradeResultView(gradeResult) : gradeAnswerForm))
        : null

      /* ------------------------------------------------ 模型选择弹层 */
      const modelEl = modelOpen
        ? (() => {
          const gs = (models && models.groups) || []
          const badSet = new Set(((models && models.bad) || []).map((b) => b.id))
          const curP = models && models.current ? models.current.provider : ''
          const curM = models && models.current ? models.current.model : ''
          const usable = gs.filter((g) => g.models.length).length

          return h('div', {
            style: {
              position: 'absolute', top: 54, right: 14, width: 'min(400px,92%)',
              maxHeight: '72%', overflow: 'auto', zIndex: 55,
              background: 'var(--sc-card)', border: '1px solid var(--sc-line)',
              borderRadius: 13, boxShadow: 'var(--sc-shadow)', padding: '12px 13px',
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
              h('div', { style: { fontWeight: 700, fontSize: 12.6 } }, '🧠 AI 功能用哪个模型'),
              h('div', { style: { flex: 1 } }),
              h('button', {
                className: 'sc-btn', style: { padding: '1px 8px', fontSize: 12 },
                onClick: () => setModelOpen(false),
              }, '×')),

            !models
              ? h('div', { style: { fontSize: 11.8, color: 'var(--sc-mute)' } }, '正在读模型清单…')
              : !models.injected
                ? h('div', { style: { fontSize: 11.8, color: 'var(--sc-red)' } },
                  '插件拿不到 llm 服务，先去 DSH 日志看 [study-coach] llm service injected。')
                : h('div', null,
                  h('button', {
                    className: curP ? 'sc-btn' : 'sc-btn pri',
                    style: { width: '100%', padding: '7px', marginBottom: 8, fontSize: 11.8 },
                    onClick: () => pickModel('', ''),
                  }, curP ? '自动选通道（按可用性，掉线的自动跳过）' : '✅ 自动选通道（当前）'),

                  h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', marginBottom: 8, lineHeight: 1.7 } },
                    `共 ${gs.length} 个通道，其中 ${usable} 个有模型。`,
                    models.pinned ? `　环境变量钉死：${models.pinned}` : '',
                    h('br'),
                    '建议直接选你在对话里正在用的那个 —— 那个肯定是活的。'),

                  // 推理等级：reasoning 模型（deepseek-flash 这类）预算小时会把 token
                  // 全烧在思考上，正文空着回来。默认给压到最低，也可以自己调。
                  h('div', { style: { marginBottom: 10 } },
                    h('div', { style: { fontSize: 10.8, fontWeight: 700, marginBottom: 4 } }, '推理等级'),
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                      ((models && models.efforts) || [
                        { id: '', label: '自动' }, { id: 'none', label: 'none' },
                        { id: 'low', label: 'low' }, { id: 'medium', label: 'medium' },
                        { id: 'high', label: 'high' },
                      ]).map((e) => {
                        const curE = (models && models.current && models.current.effort) || ''
                        const on = curE === e.id
                        return h('div', {
                          key: 'eff-' + (e.id || 'auto'),
                          onClick: () => pickModel('', '', e.id),
                          title: e.id ? '把 reasoningEffort 设为 ' + e.id : '由插件自己挑（推荐：压到最低）',
                          style: {
                            padding: '3px 10px', borderRadius: 7, fontSize: 10.8, cursor: 'pointer',
                            background: on ? 'var(--sc-teal)' : 'var(--sc-soft)',
                            color: on ? '#fff' : 'var(--sc-ink)',
                            border: '1px solid ' + (on ? 'var(--sc-teal)' : 'var(--sc-line)'),
                          },
                        }, e.label)
                      })),
                    h('div', { style: { fontSize: 10.2, color: 'var(--sc-mute)', marginTop: 4, lineHeight: 1.7 } },
                      '推理模型思考会吃 token；贪便宜压在 none/low，正文才回得来。')),

                  gs.map((g) => {
                    const dead = badSet.has(g.provider)
                    const empty = !g.models.length
                    return h('div', { key: g.provider, style: { marginBottom: 9 } },
                      h('div', {
                        style: {
                          fontSize: 10.8, fontWeight: 700, marginBottom: 4,
                          color: empty ? 'var(--sc-mute)' : dead ? 'var(--sc-amber)' : 'var(--sc-ink)',
                        },
                      },
                        (empty ? '❌ ' : dead ? '⏸ ' : '✅ ') + g.provider +
                        (empty ? '（0 个模型' + (g.error ? '：' + g.error : '') + '）' : '') +
                        (dead && !empty ? '（刚失败过，冷却中）' : '')),
                      empty
                        ? null
                        : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                          g.models.map((m) =>
                            h('div', {
                              key: m,
                              onClick: () => pickModel(g.provider, m),
                              title: g.provider + '/' + m,
                              style: {
                                padding: '3px 9px', borderRadius: 7, fontSize: 10.8,
                                cursor: 'pointer', maxWidth: '100%',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                background: (curP === g.provider && curM === m) ? 'var(--sc-teal)' : 'var(--sc-soft)',
                                color: (curP === g.provider && curM === m) ? '#fff' : 'var(--sc-ink)',
                                border: '1px solid ' + ((curP === g.provider && curM === m) ? 'var(--sc-teal)' : 'var(--sc-line)'),
                              },
                            }, m))))
                  })))
        })()
        : null

      /* ------------------------------------------------ 标签 */
      const tabs = h('div', {
        style: {
          display: 'flex', gap: 5, padding: '10px 16px 0',
          background: 'var(--sc-card)', borderBottom: '1px solid var(--sc-line)',
          overflowX: 'auto',
        },
      },
        [
          ['files', '📁 资料', null],
          ['notes', '📝 笔记', curState ? curState.stats.totalTopics : 0],
          // 试卷单独一页：读笔记要满屏字，做卷子要一块空白能画，挤一起互相碍事
          ['papers', '📄 试卷', papersDocs && papersDocs.length ? papersDocs.length : null],
          ['cards', '❓ 题目', curState ? curState.cards.length : 0],
          ['sched', '📅 日程', sched && sched.events ? sched.events.length : 0],
        ].map(([k, label, n]) =>
          h('div', {
            key: k,
            onClick: () => setTab(k),
            style: {
              padding: '7px 14px', borderRadius: '9px 9px 0 0', cursor: 'pointer',
              fontSize: 12.6,
              color: tab === k ? 'var(--sc-nav)' : 'var(--sc-mute)',
              fontWeight: tab === k ? 700 : 400,
              background: tab === k ? 'var(--sc-bg)' : 'transparent',
              border: '1px solid ' + (tab === k ? 'var(--sc-line)' : 'transparent'),
              borderBottom: 'none', whiteSpace: 'nowrap',
              position: 'relative', top: tab === k ? 1 : 0,
              display: 'flex', alignItems: 'center', gap: 6,
            },
          },
            label,
            n === null ? null : h('span', {
              style: {
                background: tab === k ? 'var(--sc-teal)' : 'var(--sc-soft)',
                color: tab === k ? '#fff' : 'var(--sc-mute)',
                borderRadius: 6, padding: '0 6px', fontSize: 10.4, fontWeight: 700,
              },
            }, String(n)),
          )),
      )

      /* ------------------------------------------------ 资料 pane */
      const filesPane = h('div', null,
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 13, flexWrap: 'wrap' } },
          sections.map((s) => {
            const box = (curSubj && curSubj.sections && curSubj.sections[s.key]) || {}
            const n = (box.files || []).length
            const on = sect === s.key
            // 没有文件的「其他目录」不占位置，免得空按钮一直挂着
            if (s.dynamic && !n && !on) return null
            return h('div', {
              key: s.key,
              onClick: () => setSect(s.key),
              title: s.dynamic ? '科目下自己建的文件夹（1_复习资料 / 3_练习题 之类）' : '',
              style: {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8, fontSize: 12.2, cursor: 'pointer',
                background: on ? 'var(--sc-teal-soft)' : 'var(--sc-card)',
                color: on ? 'var(--sc-teal)' : 'var(--sc-mute)',
                border: '1px solid ' + (on ? 'var(--sc-teal)' : 'var(--sc-line)'),
                fontWeight: on ? 650 : 400,
              },
            }, h(SecIcon, { name: s.icon }), s.label + (n ? ` ${n}` : ''))
          }),
          // 历史文件补记：把按命名判成生成物的写进清单，以后判定就不再靠猜
          h('div', {
            onClick: pickFiles,
            title: '批量选文件添加到当前分区（也可以直接把文件拖进来）',
            style: {
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 11px', borderRadius: 8, fontSize: 11.4, cursor: 'pointer',
              background: 'var(--sc-teal-soft)', color: 'var(--sc-teal)',
              border: '1px solid var(--sc-teal)', fontWeight: 650,
            },
          }, '➕ 添加文件'),
          h('div', {
            onClick: backfillMarks,
            title: '把这个科目里按命名判成「DSH 生成」的文件写进清单，以后判定不再靠猜',
            style: {
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 11px', borderRadius: 8, fontSize: 11.4, cursor: 'pointer',
              background: 'transparent', color: 'var(--sc-mute)',
              border: '1px dashed var(--sc-line)',
            },
          }, '🔁 补记来源'),
          h('div', {
            onClick: () => setShowMd((v) => !v),
            title: showMd ? '隐藏 .md 文件（文件不会被删）' : '显示 .md 文件（历史文件，默认藏起来）',
            style: {
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 11px', borderRadius: 8, fontSize: 11.4, cursor: 'pointer',
              background: showMd ? 'var(--sc-soft)' : 'transparent',
              color: 'var(--sc-mute)',
              border: '1px dashed var(--sc-line)',
            },
          }, showMd ? '👁 .md 已显示' : '👁 .md 已隐藏'),
          h('input', {
            ref: uploadInput,
            type: 'file',
            multiple: true,
            style: { display: 'none' },
            onChange: onFilesPicked,
          }),
        ),
        h('div', { ...dragProps, style: {
          border: '2px dashed ' + (hot ? 'var(--sc-teal)' : 'var(--sc-line)'),
          borderRadius: 14, background: hot ? 'var(--sc-teal-soft)' : 'var(--sc-card)',
          padding: '22px 18px', textAlign: 'center', marginBottom: 15,
          transition: 'background .15s,border-color .15s',
        } },
          h('div', { style: { fontSize: 23 } }, '📥'),
          h('div', { style: { fontWeight: 650, marginTop: 5, fontSize: 13.2 } },
            curSect && curSect.dynamic
              ? '这个分区只用来浏览，拖进来的文件会存进「参考」'
              : `把文件拖到这里，存进「${secLabel(sect)}」`),
          h('div', { style: { fontSize: 11.6, color: 'var(--sc-mute)', marginTop: 3 } },
            curSect && curSect.dynamic
              ? '1_复习资料 / 3_练习题 / 2_图解笔记 这些自建目录已经自动列出来了'
              : 'PDF / PPTX / DOCX / 图片 / 压缩包，可多选'),
          busy ? h('div', { style: { fontSize: 12, color: 'var(--sc-teal)', marginTop: 8 } }, busy) : null,
        ),
        // 选中了东西就浮出批量操作条（固定在内容区下方，不遮文件）
        selCount
          ? h('div', {
            style: {
              position: 'sticky', bottom: 0, zIndex: 20, margin: '12px -2px 0',
              display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
              padding: '9px 12px', borderRadius: 11,
              background: 'var(--sc-nav)', color: '#fff',
              boxShadow: 'var(--sc-shadow)',
            },
          },
            h('span', { style: { fontSize: 12, fontWeight: 700 } }, `已选 ${selCount} 个`),
            h('div', { style: { flex: 1 } }),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              onClick: selectAll,
              title: '把这个分区里的文件全选上',
            }, '全选本区'),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              onClick: () => batchMark(true),
            }, '标为 AI 生成'),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              onClick: () => batchMark(false),
            }, '标为原件'),
            h('button', {
              className: 'sc-btn danger', style: { padding: '4px 10px', fontSize: 11.4, fontWeight: 700 },
              onClick: batchDelete,
            }, `删除 ${selCount} 个`),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              onClick: clearSel,
            }, '取消'))
          : null,
        secFiles.length
          ? (() => {            // 原件和 DSH 生成物分两组，中间一条线隔开
            const srcFiles = secFiles.filter((f) => f.origin !== 'generated')
            const genFiles = secFiles.filter((f) => f.origin === 'generated')
            const card = (f) =>
              h('div', {
                key: f.path,
                onClick: () => openPreview(f),
                title: '点一下在面板里打开',
                style: {
                  position: 'relative', background: sel[f.path] ? 'var(--sc-teal-soft)' : 'var(--sc-card)',
                  border: '1px solid ' + (sel[f.path] ? 'var(--sc-teal)' : 'var(--sc-line)'),
                  borderRadius: 12, padding: '11px 11px 9px', display: 'flex',
                  flexDirection: 'column', gap: 5, minHeight: 100, cursor: 'pointer',
                },
              },
                f.origin === 'generated'
                  ? h('span', {
                    title: 'DSH 生成',
                    style: {
                      position: 'absolute', left: 26, top: 7, fontSize: 9,
                      color: 'var(--sc-teal)', background: 'var(--sc-teal-soft)',
                      borderRadius: 5, padding: '0 4px', fontWeight: 700,
                    },
                  }, 'AI')
                  : null,
                // 多选：左上角复选框，勾上就进批量操作
                h('input', {
                  type: 'checkbox',
                  checked: !!sel[f.path],
                  title: '选中这个文件（可以批量删 / 批量标来源）',
                  onClick: (e) => e.stopPropagation(),
                  onChange: () => toggleSel(f.path),
                  style: { position: 'absolute', left: 6, top: 6, margin: 0, cursor: 'pointer' },
                }),
                h('div', { style: { fontSize: 17 } }, FILE_ICON[f.ext] || '📎'),
                h('div', {
                  title: f.path,
                  style: {
                    fontSize: 12, fontWeight: 600, wordBreak: 'break-word',
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  },
                }, f.rel || f.name),
                // 「其他目录」里的文件带相对路径，补一行只显示文件名，
                // 免得同一份资料在不同文件夹里看着一模一样
                f.rel && f.rel !== f.name
                  ? h('div', {
                    title: f.name,
                    style: {
                      fontSize: 10.2, color: 'var(--sc-mute)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    },
                  }, f.name)
                  : null,
                h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', marginTop: 'auto' } },
                  f.sizeText + ' · ' + f.mtime),
                h('button', {
                  className: 'sc-btn danger',
                  title: '删除',
                  style: { position: 'absolute', top: 7, right: 7, padding: '1px 7px', fontSize: 12 },
                  onClick: (e) => { e.stopPropagation(); del(f.path) },
                }, '×'),
                // 来源开关：判错了可以自己改回来，改完会写进 generated.json
                h('button', {
                  className: 'sc-btn',
                  title: f.origin === 'generated'
                    ? '现在算 DSH 生成（' + (f.originBy || 'name') + '）。点一下标成原件'
                    : '现在算原件（' + (f.originBy || 'default') + '）。点一下标成 DSH 生成',
                  style: {
                    position: 'absolute', bottom: 7, right: 7, padding: '0 6px',
                    fontSize: 10, lineHeight: '16px',
                    color: f.origin === 'generated' ? 'var(--sc-teal)' : 'var(--sc-mute)',
                  },
                  onClick: (e) => { e.stopPropagation(); toggleMark(f) },
                }, '⇄'),
              )

            const rule = (text) =>
              h('div', {
                key: 'rule-' + text,
                style: {
                  gridColumn: '1 / -1', display: 'flex', alignItems: 'center',
                  gap: 10, margin: '10px 0 2px',
                },
              },
                h('div', { style: { flex: 1, height: 1, background: 'var(--sc-line)' } }),
                h('span', {
                  style: {
                    fontSize: 10.4, fontWeight: 700, letterSpacing: '.6px',
                    color: 'var(--sc-mute)', whiteSpace: 'nowrap',
                  },
                }, text),
                h('div', { style: { flex: 1, height: 1, background: 'var(--sc-line)' } }))

            const grid = {
              display: 'grid', gap: 10,
              gridTemplateColumns: 'repeat(auto-fill,minmax(166px,1fr))',
            }
            if (!genFiles.length) return h('div', { style: grid }, srcFiles.map(card))
            if (!srcFiles.length) return h('div', { style: grid }, genFiles.map(card))
            return h('div', { style: grid },
              srcFiles.map(card),
              rule('DSH 生成 ' + genFiles.length),
              genFiles.map(card),
            )
          })()
          : h('div', { style: { color: 'var(--sc-mute)', textAlign: 'center', padding: '30px 12px', fontSize: 12.6 } },
            '这一格还是空的，把文件拖进上面的框'),
      )

      /* ------------------------------------------------ 笔记 pane */
      // 「笔记」这一页到底该显示什么：主人要的是**能读的笔记**，不是知识点列表。
      // 所以默认就是阅读器：自动打开最新那份笔记，把 Markdown 渲染成排版好的正文。
      // 知识点放第二个子标签（做题、掌握度还要用）。
      const topics = curState ? curState.topics : []
      const groups = {}
      for (const t of topics) (groups[t.lecture || '—'] = groups[t.lecture || '—'] || []).push(t)
      const lecKeys = Object.keys(groups).sort((a2, b2) =>
        String(a2).localeCompare(String(b2), 'en', { numeric: true }))

      // 笔记文档列表在组件顶部就算好了（pickNoteDocs），这里直接用 ——
      // 不能再算一遍，更不能在这里写 hooks（见顶部注释：会触发 React #310）。
      // 笔记清单：服务端算的（带「为什么算笔记」）+ 手动增删；
      // 服务端还没回（noteList === null）时先用本地规则兜一下，界面不空着。
      const noteDocs = (noteList && noteList.length)
        ? noteList
        : (noteList === null ? noteDocsForEffect : [])
      const curNote = noteDocs.find((f) => f.path === notePath) || noteDocs[0] || null

      const loadNote = async (f) => {
        if (!f) return
        setNoteDoc({ loading: true, name: f.name, path: f.path, ext: f.ext })
        try {
          const r = await api.get(
            'preview?code=' + encodeURIComponent(cur) + '&path=' + encodeURIComponent(f.path),
          )
          if (!r.ok) throw new Error(r.error || '读不出来')
          setNoteDoc({ ...r, loading: false })
        } catch (e) {
          setNoteDoc({ loading: false, name: f.name, path: f.path, ext: f.ext, error: e.message })
        }
      }

      const isOpen = (lec) => openLec[lec] !== false

      // 阅读器字体 / 字号：存在 localStorage，下次打开还是这个
      const NOTE_FONTS = [
        ['auto', '默认'],
        ['sans', '黑体（屏幕清晰）'],
        ['serif', '宋体 / Times（像纸质）'],
        ['kai', '楷体'],
        ['mono', '等宽（代码/公式）'],
      ]
      const NOTE_FONT_CSS = {
        auto: 'inherit',
        sans: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
        serif: 'Georgia, "Times New Roman", "Songti SC", "SimSun", "Noto Serif CJK SC", serif',
        kai: '"Kaiti SC", "KaiTi", "STKaiti", "楷体", serif',
        mono: 'Consolas, "SF Mono", "DejaVu Sans Mono", ui-monospace, monospace',
      }
      const setNoteFontPref = (v) => {
        setNoteFont(v)
        try { localStorage.setItem('sc-note-font', v) } catch {}
      }
      const setNoteSizePref = (v) => {
        setNoteSize(v)
        try { localStorage.setItem('sc-note-size', String(v)) } catch {}
      }
      /**
       * 用系统默认程序打开原文件（Word / PowerPoint / PDF 阅读器）。
       * 渲染进程不能跳 file://，所以交给服务端 spawn 系统命令去做。
       * reveal=true 是在文件管理器里定位。
       */
      const openWithSystem = async (f, reveal) => {
        if (!f || !f.path) return
        try {
          const r = await api.post('open', { path: f.path, reveal: !!reveal })
          if (!r.ok) throw new Error(r.error || '打不开')
          say(reveal ? '已在文件夹里定位' : '已用系统程序打开', 'ok')
        } catch (e) {
          say('打不开：' + e.message + '（可以用「另存」下载后自己开）', 'err')
        }
      }

      /* ---- 阅读器 ---- */
      const noteReader = !curNote
        ? h('div', {
          style: { color: 'var(--sc-mute)', textAlign: 'center', padding: '46px 16px', lineHeight: 1.9, fontSize: 12.6 },
        },
          '这个科目还没有笔记文档。',
          h('br'),
          h('b', { style: { color: 'var(--sc-nav)' } }, '用「🪄 一键生成」出整份笔记'), '，',
          h('br'),
          '或者把 .md / .docx 拖进「资料」—— 文件名带「笔记 / 手册 / 总结」的会自动出现在这里。')
        : h('div', null,
          // 工具条：选文件 + 另存
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
              padding: '8px 10px', borderRadius: 10, background: 'var(--sc-soft)',
              marginBottom: 10, position: 'sticky', top: 0, zIndex: 5,
            },
          },
            h('select', {
              value: curNote.path,
              onChange: (e) => {
                const f = noteDocs.find((x) => x.path === e.target.value)
                if (f) { setNotePath(f.path); loadNote(f) }
              },
              style: {
                flex: 1, minWidth: 180, fontSize: 11.8, padding: '5px 8px', borderRadius: 7,
                border: '1px solid var(--sc-line)', background: 'var(--sc-card)', color: 'var(--sc-ink)',
              },
            }, noteDocs.map((f) => h('option', { key: f.path, value: f.path }, f.name))),
            noteDoc && noteDoc.chars
              ? h('span', { style: { fontSize: 10.6, color: 'var(--sc-mute)' } }, noteDoc.chars + ' 字')
              : null,
            // 字体 / 字号：手机上默认偏小，能自己调才读得下去
            h('select', {
              value: noteFont,
              title: '阅读字体',
              onChange: (e) => setNoteFontPref(e.target.value),
              style: {
                fontSize: 11, padding: '4px 6px', borderRadius: 7,
                border: '1px solid var(--sc-line)', background: 'var(--sc-card)', color: 'var(--sc-ink)',
              },
            }, NOTE_FONTS.map(([k, label]) => h('option', { key: k, value: k }, label))),
            h('select', {
              value: String(noteSize),
              title: '正文字号',
              onChange: (e) => setNoteSizePref(Number(e.target.value)),
              style: {
                fontSize: 11, padding: '4px 6px', borderRadius: 7,
                border: '1px solid var(--sc-line)', background: 'var(--sc-card)', color: 'var(--sc-ink)',
              },
            }, [11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 84].map((n) =>
              h('option', { key: n, value: String(n) }, n + 'px'))),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              title: '用 Word / PowerPoint / PDF 阅读器打开这份原文件',
              onClick: () => openWithSystem(curNote),
            }, '🖥 打开原文件'),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              title: '在文件夹里定位这份文件',
              onClick: () => openWithSystem(curNote, true),
            }, '📂'),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              title: '重新读一遍',
              onClick: () => { setNoteDoc(null); loadNote(curNote) },
            }, '↻'),
            h('button', {
              className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
              onClick: () => downloadFile(curNote),
            }, '另存')),

          // 这一行解释「它为什么算笔记」，并且允许移除 / 手动添加
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
              fontSize: 10.8, color: 'var(--sc-mute)', marginBottom: 10, paddingLeft: 2,
            },
          },
            h('span', null, '为什么算笔记：', h('b', { style: { color: 'var(--sc-teal)' } }, curNote.reason || '—')),
            h('div', { style: { flex: 1 } }),
            curNote.origin === 'manual'
              ? h('button', {
                className: 'sc-btn', style: { padding: '2px 8px', fontSize: 10.6 },
                title: '恢复成自动判定（不再手动加入）',
                onClick: () => setNoteFlag(curNote.path, 'auto'),
              }, '恢复自动')
              : h('button', {
                className: 'sc-btn', style: { padding: '2px 8px', fontSize: 10.6 },
                title: '从笔记列表移出（文件本身不删）',
                onClick: () => setNoteFlag(curNote.path, 'remove'),
              }, '移出笔记'),
            h('button', {
              className: 'sc-btn', style: { padding: '2px 8px', fontSize: 10.6 },
              title: '把别的文件加进笔记列表',
              onClick: () => setNoteAdding((v) => !v),
            }, noteAdding ? '收起' : '➕ 添加笔记'),
            h('button', {
              className: 'sc-btn danger', style: { padding: '2px 8px', fontSize: 10.6 },
              title: '真的把这个文件从磁盘删掉（没有回收站）',
              onClick: async () => {
                if (!window.confirm('删掉这个文件？\n\n' + curNote.name + '\n\n文件会从磁盘删除，不可恢复。')) return
                try {
                  const r = await api.post('delete', { paths: [curNote.path] })
                  if (!r.ok) throw new Error(r.error || '删除失败')
                  say('已删除', 'ok')
                  setNoteDoc(null)
                  await refresh()
                } catch (e) {
                  say('删除失败：' + e.message, 'err')
                }
              },
            }, '🗑 删除文件')),

          // 候选列表：点一下就加进来
          noteAdding
            ? h('div', {
              style: {
                border: '1px solid var(--sc-line)', borderRadius: 10, padding: '9px 11px',
                marginBottom: 10, background: 'var(--sc-soft)', maxHeight: 240, overflow: 'auto',
              },
            },
              h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', marginBottom: 6 } },
                `下面 ${noteCands.length} 个文件不是笔记（或被你移出去了），点一下加进来：`),
              noteCands.length
                ? noteCands.map((f) => h('div', {
                  key: f.path,
                  onClick: () => setNoteFlag(f.path, 'add'),
                  style: {
                    display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                    padding: '5px 8px', borderRadius: 7, marginBottom: 3,
                    background: 'var(--sc-card)', border: '1px solid var(--sc-line)', fontSize: 11.2,
                  },
                },
                  h('span', null, FILE_ICON[f.ext] || '📎'),
                  h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { wordBreak: 'break-all' } }, f.name),
                    h('div', { style: { fontSize: 9.6, color: 'var(--sc-mute)' } }, f.why || '')),
                  h('span', { style: { fontSize: 10.4, color: 'var(--sc-teal)' } }, '＋')))
                : h('div', { style: { fontSize: 11, color: 'var(--sc-mute)' } }, '没有可添加的文件了。'))
            : null,

          // 正文
          h('div', {
            style: {
              background: 'var(--sc-card)', border: '1px solid var(--sc-line)',
              borderRadius: 12, padding: '18px 22px 26px',
              // 字体 / 字号从这里继承下去：Markdown 里所有尺寸都用 em
              fontFamily: NOTE_FONT_CSS[noteFont] || 'inherit',
              fontSize: noteSize + 'px',
              lineHeight: 1.85,
            },
          },
            !noteDoc || (noteDoc.loading && noteDoc.path !== curNote.path)
              ? h('div', { style: { color: 'var(--sc-mute)', fontSize: 12.4, padding: '20px 0' } },
                '正在读 ' + curNote.name + '…')
              : noteDoc.error
                ? h('div', { style: { color: 'var(--sc-red)', fontSize: 12.4, lineHeight: 1.8 } },
                  '读不出来：' + noteDoc.error,
                  h('br'),
                  h('br'),
                  h('button', {
                    className: 'sc-btn', style: { padding: '4px 10px', fontSize: 11.4 },
                    onClick: () => downloadFile(curNote),
                  }, '下载下来用 Word 打开'))
                : noteDoc.ext === 'pdf'
                  ? h('div', { style: { overflow: 'auto', maxHeight: '72vh' } },
                    h('iframe', {
                      src: fileUrl(curNote.path),
                      title: curNote.name,
                      style: {
                        width: '100%', height: '70vh', border: 'none', borderRadius: 8,
                        // PDF 是整页渲染，改不了里面的字 —— 用 zoom 整体缩放
                        zoom: Math.max(0.5, Math.min(3, noteSize / 13)),
                      },
                    }))
                  : noteDoc.text
                    // 注意：这里**不能**再写 fontSize —— 会盖掉外层容器上的 noteSize，
                    // 表现就是「拖字号没反应」。字号只在外层设一次，靠 em 往下传。
                    ? h('div', { style: { lineHeight: 1.8 } }, renderMarkdown(noteDoc.text))
                    : h('div', { style: { color: 'var(--sc-mute)', fontSize: '0.98em' } },
                      noteDoc.note || '这个文件里没读到文字。')))

      /* ---- 知识点列表（原样，加折叠） ---- */
      const topicsList = topics.length
        ? h('div', null,
          lecKeys.map((lec) => {
            const open = isOpen(lec)
            const avg = groups[lec].reduce((acc, t) => acc + (t.mastery || 0), 0) / groups[lec].length
            return h('div', { key: lec },
              h('div', {
                onClick: () => setOpenLec((st) => ({ ...st, [lec]: !isOpen(lec) })),
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  fontSize: 11.4, fontWeight: 750, color: 'var(--sc-nav)',
                  letterSpacing: '.5px', margin: '12px 0 7px', paddingLeft: 8,
                  borderLeft: '3px solid var(--sc-teal)',
                },
              },
                h('span', { style: { fontSize: 10, color: 'var(--sc-mute)' } }, open ? '▾' : '▸'),
                lec,
                h('span', { style: { color: 'var(--sc-mute)', fontWeight: 400 } }, String(groups[lec].length)),
                h('div', { style: { flex: 1, height: 1, background: 'var(--sc-line)', margin: '0 4px' } }),
                h('span', { style: { fontWeight: 700, color: colorOf(avg) } }, pct(avg) + '%')),
              open
                ? groups[lec].map((t) =>
                  h('div', {
                    key: t.key,
                    style: {
                      background: 'var(--sc-card)', border: '1px solid var(--sc-line)',
                      borderRadius: 11, padding: '11px 14px', display: 'flex',
                      gap: 11, alignItems: 'center', marginBottom: 8,
                    },
                  },
                    h('div', {
                      style: {
                        fontSize: 10.6, fontWeight: 750, color: 'var(--sc-teal)',
                        background: 'var(--sc-teal-soft)', borderRadius: 6,
                        padding: '3px 7px', flex: 'none', minWidth: 46, textAlign: 'center',
                      },
                    }, t.lecture || ''),
                    h('div', { style: { flex: 1, minWidth: 0 } },
                      h('div', { style: { fontWeight: 650, fontSize: 12.6 } }, t.title),
                      t.titleEn
                        ? h('div', { style: { fontSize: 10.8, color: 'var(--sc-mute)', fontStyle: 'italic' } }, t.titleEn)
                        : null,
                      h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', marginTop: 2 } },
                        '对 ' + t.right + ' / 错 ' + t.wrong + ' · 到期 ' + t.due)),
                    h('div', {
                      style: {
                        width: 64, height: 6, borderRadius: 99,
                        background: 'var(--sc-soft)', overflow: 'hidden', flex: 'none',
                      },
                    }, h('i', {
                      style: {
                        display: 'block', height: '100%',
                        width: pct(t.mastery) + '%', background: colorOf(t.mastery),
                      },
                    })),
                    h('div', {
                      style: {
                        width: 34, textAlign: 'right', fontSize: 11.5,
                        fontWeight: 700, color: colorOf(t.mastery), flex: 'none',
                      },
                    }, pct(t.mastery) + '%'),
                  ))
                : null,
            )
          }))
        : h('div', { style: { color: 'var(--sc-mute)', textAlign: 'center', padding: '38px 14px', lineHeight: 1.9, fontSize: 12.6 } },
          '还没有知识点。',
          h('br'),
          h('b', { style: { color: 'var(--sc-nav)' } }, '用「🪄 一键生成」'), ' 从讲义里提炼。')

      /* ---- 组装：子标签切换 ---- */
      const notesPane = h('div', null,
        h('div', {
          style: { display: 'flex', gap: 6, marginBottom: 11 },
        },
          [
            ['note', '📄 笔记', noteDocs.length || null],
            ['topics', '🧩 知识点', topics.length || null],
          ].map(([k, label, n]) =>
            h('div', {
              key: k,
              onClick: () => setNoteTab(k),
              style: {
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '6px 13px', borderRadius: 8, fontSize: 12,
                background: noteTab === k ? 'var(--sc-teal-soft)' : 'var(--sc-card)',
                color: noteTab === k ? 'var(--sc-teal)' : 'var(--sc-mute)',
                border: '1px solid ' + (noteTab === k ? 'var(--sc-teal)' : 'var(--sc-line)'),
                fontWeight: noteTab === k ? 700 : 400,
              },
            },
              label,
              n === null ? null : h('span', {
                style: {
                  background: noteTab === k ? 'var(--sc-teal)' : 'var(--sc-soft)',
                  color: noteTab === k ? '#fff' : 'var(--sc-mute)',
                  borderRadius: 6, padding: '0 6px', fontSize: 10.2, fontWeight: 700,
                },
              }, String(n))))),
        noteTab === 'note' ? noteReader : topicsList)

      /* ------------------------------------------------ 题目 pane */
      const cards = curState ? curState.cards : []
      const cardsPane = cards.length
        ? h('div', null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
            h('div', { style: { fontSize: 11.4, color: 'var(--sc-mute)' } }, `共 ${cards.length} 题`),
            h('div', { style: { flex: 1 } }),
            h('button', {
              className: 'sc-btn',
              title: '导出 CSV：Excel / WPS 双击能开，也能导进 Anki',
              onClick: () => window.open(
                '/api/study-coach/cards.csv?code=' + encodeURIComponent(cur), '_blank'),
            }, '⬇ CSV')),
          cards.map((cd) =>
            h('div', {
              key: cd.id,
              style: {
                background: 'var(--sc-card)', border: '1px solid var(--sc-line)',
                borderRadius: 11, padding: '13px 15px', marginBottom: 9,
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                // 做过的题打勾 / 打叉 —— 一眼看出这张卷子还剩几题没做
                cd.lastResult
                  ? h('span', {
                    title: cd.lastResult.correct ? '上次做对了' : '上次做错了',
                    style: {
                      fontSize: 12, flex: 'none', fontWeight: 800,
                      color: cd.lastResult.correct ? 'var(--sc-teal)' : 'var(--sc-red)',
                    },
                  }, cd.lastResult.correct ? '✅' : '✗')
                  : h('span', {
                    title: '还没做过',
                    style: { fontSize: 12, flex: 'none', color: 'var(--sc-mute)', opacity: 0.5 },
                  }, '○'),
                h('span', {
                  style: {
                    fontSize: 10.6, fontWeight: 700, color: 'var(--sc-amber)',
                    background: 'var(--sc-soft)', borderRadius: 6, padding: '2px 7px',
                  },
                }, cd.marks ? cd.marks + ' 分' : '题目'),
                h('span', { style: { fontSize: 10.6, color: 'var(--sc-mute)', flex: 1 } },
                  cd.topicKey || ''),
                h('button', {
                  className: 'sc-btn pri',
                  onClick: () => {
                  setModal(cd)
                  setShowAns(false)
                  loadQuiz(cd)
                },
                }, cd.lastResult
                  ? (cd.lastResult.correct ? '✅ 再做' : '✗ 再做')
                  : '做题'),
              ),
              h('div', { style: { fontSize: 12.6, lineHeight: 1.65, whiteSpace: 'pre-wrap' } },
                cd.question),
            )))
        : h('div', { style: { color: 'var(--sc-mute)', textAlign: 'center', padding: '38px 14px', lineHeight: 1.9, fontSize: 12.6 } },
          '还没有题目。',
          h('br'),
          h('b', { style: { color: 'var(--sc-nav)' } }, '把试卷拖进「资料」'), '，或让我照着卷子出题。')

      /* ------------------------------------------------ 日程 pane */
      const evs = (sched && sched.events) || []
      const types = (sched && sched.types) || []
      const typeOf = (k) =>
        types.find((x) => x.key === k) || { label: '其他', icon: '•', color: 'mute' }
      const TCOLOR = {
        red: 'var(--sc-red)', amber: 'var(--sc-amber)',
        blue: '#4E9BD6', teal: 'var(--sc-teal)', mute: 'var(--sc-mute)',
      }
      const pad2 = (n) => String(n).padStart(2, '0')
      const isoOf = (y, m, d) => y + '-' + pad2(m + 1) + '-' + pad2(d)
      const nowD = new Date()
      const todayIso = isoOf(nowD.getFullYear(), nowD.getMonth(), nowD.getDate())
      const byDate = {}
      for (const e of evs) (byDate[e.date] = byDate[e.date] || []).push(e)

      const firstDow = new Date(calMonth.y, calMonth.m, 1).getDay()
      const daysInMonth = new Date(calMonth.y, calMonth.m + 1, 0).getDate()
      const cells = []
      for (let i = 0; i < firstDow; i++) cells.push(null)
      for (let d = 1; d <= daysInMonth; d++) cells.push(d)
      while (cells.length % 7 !== 0) cells.push(null)

      const monthShift = (delta) => {
        const m = calMonth.m + delta
        setCalMonth({ y: calMonth.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 })
      }

      const dayCell = (d, idx) => {
        if (d === null) return h('div', { key: 'x' + idx, style: { minHeight: 56 } })
        const iso = isoOf(calMonth.y, calMonth.m, d)
        const list = byDate[iso] || []
        const isToday = iso === todayIso
        return h('div', {
          key: iso,
          onClick: () => setDayForm({ date: iso, type: 'exam', title: '', time: '', note: '' }),
          style: {
            minHeight: 56, padding: '4px 5px', borderRadius: 8, cursor: 'pointer',
            border: '1px solid ' + (isToday ? 'var(--sc-teal)' : 'transparent'),
            background: isToday ? 'var(--sc-teal-soft)' : 'transparent',
            display: 'flex', flexDirection: 'column', gap: 2,
          },
        },
          h('div', {
            style: {
              fontSize: 11.2, fontWeight: isToday ? 750 : 500,
              color: isToday ? 'var(--sc-teal)' : 'var(--sc-ink)',
            },
          }, String(d)),
          list.slice(0, 2).map((e, i) =>
            h('div', {
              key: i,
              style: {
                fontSize: 9.4, color: TCOLOR[typeOf(e.type).color] || 'var(--sc-mute)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontWeight: 600,
              },
            }, typeOf(e.type).icon + ' ' + e.title)),
          list.length > 2
            ? h('div', { style: { fontSize: 8.8, color: 'var(--sc-mute)' } }, '+' + (list.length - 2))
            : null,
        )
      }

      const schedPane = h('div', null,
        h('div', {
          style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11, flexWrap: 'wrap' },
        },
          h('button', { className: 'sc-btn', onClick: () => monthShift(-1) }, '‹'),
          h('div', { style: { fontWeight: 700, fontSize: 13, minWidth: 100, textAlign: 'center' } },
            calMonth.y + ' 年 ' + (calMonth.m + 1) + ' 月'),
          h('button', { className: 'sc-btn', onClick: () => monthShift(1) }, '›'),
          h('button', {
            className: 'sc-btn',
            onClick: () => { const n2 = new Date(); setCalMonth({ y: n2.getFullYear(), m: n2.getMonth() }) },
          }, '今天'),
          h('div', { style: { flex: 1 } }),
          h('button', {
            className: 'sc-btn pri',
            onClick: () => setDayForm({ date: todayIso, type: 'exam', title: '', time: '', note: '' }),
          }, '+ 事件'),
          h('button', {
            className: 'sc-btn',
            title: '下载 .ics，可导入 Google 日历 / Outlook / 手机日历',
            onClick: () => window.open(
              '/api/study-coach/schedule/ics?code=' + encodeURIComponent(cur), '_blank'),
          }, '导出 .ics'),
        ),
        h('div', {
          style: {
            display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2,
            background: 'var(--sc-card)', border: '1px solid var(--sc-line)',
            borderRadius: 12, padding: 7, marginBottom: 15,
          },
        },
          ['日', '一', '二', '三', '四', '五', '六'].map((w) =>
            h('div', {
              key: w,
              style: {
                textAlign: 'center', fontSize: 10.2, color: 'var(--sc-mute)',
                fontWeight: 700, padding: '2px 0 4px',
              },
            }, w)),
          cells.map(dayCell),
        ),
        evs.length
          ? h('div', null,
            h('div', {
              style: {
                fontSize: 11.2, fontWeight: 750, color: 'var(--sc-nav)',
                margin: '0 0 7px', paddingLeft: 8, borderLeft: '3px solid var(--sc-teal)',
              },
            }, '全部日程 ' + evs.length),
            evs.map((e) => {
              const ty = typeOf(e.type)
              const past = e.date < todayIso
              return h('div', {
                key: e.id,
                style: {
                  display: 'flex', alignItems: 'center', gap: 9,
                  background: 'var(--sc-card)', border: '1px solid var(--sc-line)',
                  borderRadius: 10, padding: '8px 11px', marginBottom: 5,
                  opacity: past ? 0.55 : 1,
                },
              },
                h('span', { style: { fontSize: 13 } }, ty.icon),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontSize: 12.2, fontWeight: 650 } }, e.title),
                  h('div', { style: { fontSize: 10.4, color: 'var(--sc-mute)', marginTop: 1 } },
                    e.date + (e.time ? ' ' + e.time : '') + ' · ' + ty.label +
                    (e.note ? ' · ' + e.note : ''))),
                h('button', {
                  className: 'sc-btn danger',
                  style: { padding: '0 7px', fontSize: 12 },
                  onClick: () => delEvent(e.id),
                }, '×'),
              )
            }))
          : h('div', {
            style: { color: 'var(--sc-mute)', textAlign: 'center', padding: '20px 12px', fontSize: 12.2, lineHeight: 1.9 },
          },
            '这个科目还没有日程。',
            h('br'),
            '点日历上任意一天加一条，或点「+ 事件」。'),
      )

      /* ------------------------------------------------ 试卷 pane */
      // 和笔记分开一页。道理很简单：笔记是「读」，试卷是「做」，
      // 读的时候要满屏文字，做的时候要一块能画的空白，两件事挤在一页互相碍事。
      const papersPane = (() => {
        const item = paperItems[pi] || null
        const total = paperItems.length
        const curImg = item ? (paperImgs[item.no] || item.image || '') : ''
        // inkTick 只是个触发器：笔迹不进 state，抬笔时 +1 让这里的计数重算。
        // 只数当前这份卷子的笔迹（键是 "卷子路径::A1"，别的卷子的不算）。
        const inkPrefix = (curPaperPath || '') + '::'
        const doneCount = inkTick >= 0
          ? Object.keys(inkStore.current)
            .filter((k) => k.startsWith(inkPrefix) && (inkStore.current[k] || []).length).length
          : 0

        const picker = !papersDocs
          ? h('div', { style: { fontSize: 12, color: 'var(--sc-mute)' } }, '正在读试卷列表…')
          : papersDocs.length
            ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 } },
              h('select', {
                value: curPaperPath,
                onChange: (e) => { setCurPaperPath(e.target.value); openPaperItems(e.target.value) },
                style: {
                  flex: 1, minWidth: 200, fontSize: 12, padding: '6px 8px', borderRadius: 8,
                  border: '1px solid var(--sc-line)', background: 'var(--sc-card)', color: 'var(--sc-ink)',
                },
              }, papersDocs.map((p) => h('option', { key: p.path, value: p.path },
                (p.title ? p.title + ' · ' : '') + p.name.replace(/\.json$/i, '')))),
              h('span', { style: { fontSize: 11.4, color: 'var(--sc-mute)', whiteSpace: 'nowrap' } },
                total + ' 题 / ' + paperItems.reduce((a, x) => a + (x.marks || 0), 0) + ' 分'),
              h('button', {
                className: 'sc-btn', style: { padding: '5px 10px', fontSize: 11.4 },
                title: '打开批改抽屉（手写卷要自己对着答案看，批改只认打字的答案）',
                onClick: () => { setGradePaper(curPaperPath); setGrade(true); loadGradePaper(curPaperPath) },
              }, '📝 批改'),
            )
            : h('div', {
              style: { color: 'var(--sc-mute)', textAlign: 'center', padding: '44px 16px', fontSize: 12.6, lineHeight: 2 },
            },
              '这个科目还没有练习卷。',
              h('br'),
              h('b', { style: { color: 'var(--sc-nav)' } }, '用顶栏「📄 出卷」按真卷版式生成一份'),
              '，出好的卷子会自动出现在这里。')

        if (!papersDocs || !papersDocs.length) return h('div', null, picker)

        if (!item) {
          return h('div', null, picker,
            h('div', {
              style: { color: 'var(--sc-mute)', textAlign: 'center', padding: '40px 16px', fontSize: 12.4, lineHeight: 2 },
            }, '这份卷子里没有题目。', h('br'), '可能只生成了排版没生成题目 JSON，重新出一次卷即可。'))
        }

        /* ---- 工具条：只有笔 ---- */
        const COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#8250df']
        const toolBtn = (on, label, onClick, title, extra) => h('div', {
          title: title || '',
          onClick,
          style: {
            padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11.6,
            fontWeight: on ? 700 : 400,
            background: on ? 'var(--sc-teal)' : 'var(--sc-soft)',
            color: on ? '#fff' : 'var(--sc-ink)',
            border: '1px solid ' + (on ? 'var(--sc-teal)' : 'var(--sc-line)'),
            userSelect: 'none', ...(extra || {}),
          },
        }, label)

        const toolbar = h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            padding: '7px 9px', borderRadius: 10, background: 'var(--sc-soft)',
            border: '1px solid var(--sc-line)', marginBottom: 10,
          },
        },
          COLORS.map((c) => h('div', {
            key: c, title: '笔色 ' + c,
            onClick: () => { setInkColor(c); setInkErase(false) },
            style: {
              width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer',
              border: (!inkErase && inkColor === c) ? '2px solid var(--sc-ink)' : '2px solid transparent',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)',
            },
          })),
          h('div', { style: { width: 1, height: 20, background: 'var(--sc-line)', margin: '0 2px' } }),
          [1.6, 2.6, 4.2].map((w) => toolBtn(!inkErase && inkW === w, '●', () => { setInkW(w); setInkErase(false) },
            '笔粗 ' + w, { fontSize: 9 + w * 1.6, lineHeight: '16px', padding: '3px 8px' })),
          h('div', { style: { width: 1, height: 20, background: 'var(--sc-line)', margin: '0 2px' } }),
          toolBtn(inkErase, '🧽 橡皮', () => setInkErase((v) => !v), '擦掉画错的地方'),
          toolBtn(false, '↶ 撤销', inkUndo, '撤掉上一笔'),
          toolBtn(false, '🗑 清空', inkClear, '这一题全部擦掉'),
          h('div', { style: { flex: 1 } }),
          toolBtn(boardBig, boardBig ? '⛶ 收起题目' : '⛶ 大板', () => setBoardBig((v) => !v),
            '把题干收成一行，整屏留给画板'),
          h('span', { style: { fontSize: 10.8, color: 'var(--sc-mute)' } }, '按住鼠标写'),
        )

        /* ---- 题目里带的表：真值表 / 邻接表 / 概率分布表 ----
           以前 flattenPaper 直接把 table 丢了，"根据下表…" 下面一片空白。 */
        const tableEl = (item.table && item.table.length)
          ? h('div', { style: { marginTop: 10, overflowX: 'auto' } },
            h('table', { style: { borderCollapse: 'collapse', fontSize: 12.4 } },
              item.table.map((row, ri) => h('tr', { key: ri },
                (Array.isArray(row) ? row : [row]).map((c, ci) => h(ri === 0 ? 'th' : 'td', {
                  key: ci,
                  style: {
                    border: '1px solid var(--sc-line)',
                    padding: '4px 11px',
                    fontWeight: ri === 0 ? 700 : 400,
                    background: ri === 0 ? 'var(--sc-soft)' : 'transparent',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    fontFamily: 'ui-monospace,Consolas,monospace',
                    fontSize: 12.2,
                  },
                }, String(c))),
              )),
            ))
          : null

        /* ---- 这一题的配图（自己挂的，或者卷子里本来就有的） ---- */
        const figEl = curImg
          ? h('div', { style: { marginTop: 10 } },
            h('img', {
              src: paperImgUrl(curImg),
              alt: item.no + ' 的配图',
              style: {
                maxWidth: '100%', maxHeight: '44vh', borderRadius: 8,
                border: '1px solid var(--sc-line)', background: '#fff', display: 'block',
              },
            }),
            h('div', {
              style: { fontSize: 10.4, color: 'var(--sc-mute)', marginTop: 4, wordBreak: 'break-all' },
            }, '配图：' + String(curImg).split(/[\\/]/).pop()))
          : null

        /* ---- 题目 ----
           「大板」开着的时候题目收成一行，把整屏让给画板；
           平时最长也就占 30vh，长题干自己滚，别把画板挤没了。 */
        const questionCard = h('div', {
          style: {
            padding: boardBig ? '7px 12px' : '13px 15px', borderRadius: 12, background: 'var(--sc-card)',
            border: '1px solid var(--sc-line)', marginBottom: 10,
            ...(boardBig ? {} : {
              maxHeight: (curImg || (item.table && item.table.length)) ? '46vh' : '30vh',
              overflowY: 'auto',
            }),
          },
        },
          h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: boardBig ? 0 : 8, flexWrap: 'wrap' },
          },
            h('span', {
              style: {
                fontSize: 13, fontWeight: 700, color: '#fff', background: 'var(--sc-teal)',
                borderRadius: 7, padding: '2px 9px',
              },
            }, item.no),
            h('span', { style: { fontSize: 11.6, color: 'var(--sc-mute)' } },
              item.section + (item.marks ? ' · ' + item.marks + ' 分' : '')),
            boardBig
              ? h('span', {
                style: {
                  fontSize: 11.4, color: 'var(--sc-mute)', flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
                title: item.stem,
              }, item.stem)
              : null,
            h('div', { style: { flex: 1 } }),
            h('button', {
              className: 'sc-btn',
              style: { padding: '2px 9px', fontSize: 10.8, flexShrink: 0 },
              title: '这一题要看着图做？把图挂上来',
              onClick: () => setImgPickFor(imgPickFor === item.no ? null : item.no),
            }, curImg ? '🖼 换图' : '🖼 配图'),
            h('span', { style: { fontSize: 11.4, color: 'var(--sc-mute)' } }, (pi + 1) + ' / ' + total),
          ),
          boardBig
            ? null
            : h('div', {
              style: { fontSize: 13.6, lineHeight: 1.95, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
            }, item.stem),
          boardBig || !(item.parts || []).length
            ? null
            : h('div', { style: { marginTop: 9, paddingLeft: 4 } },
              item.parts.map((p, i) => h('div', {
                key: i,
                style: { fontSize: 13, lineHeight: 1.9, marginBottom: 4, display: 'flex', gap: 7 },
              },
                h('b', { style: { color: 'var(--sc-nav)', flexShrink: 0 } }, p.label),
                h('span', { style: { flex: 1, whiteSpace: 'pre-wrap' } }, p.text),
                p.marks ? h('span', { style: { fontSize: 10.8, color: 'var(--sc-mute)', flexShrink: 0 } }, '(' + p.marks + ')') : null,
              ))),
          tableEl,
          figEl,
        )

        /* ---- 留白做题区（网格底 + 透明画布） ---- */
        // 尺寸给足：正常 68vh（最少 440），「大板」放开到 80vh（最少 560）。
        // 之前 56vh/520 在 1080p 面板里只剩一小条，一道四行的题根本写不开。
        const board = h('div', {
          style: {
            position: 'relative',
            height: boardBig ? 'min(80vh, 900px)' : 'min(68vh, 700px)',
            minHeight: boardBig ? 560 : 440,
            borderRadius: 12, border: '1px solid var(--sc-line)', overflow: 'hidden',
            background: 'var(--sc-card)',
            backgroundImage:
              'linear-gradient(var(--sc-line) 1px, transparent 1px),'
              + 'linear-gradient(90deg, var(--sc-line) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            cursor: inkErase ? 'cell' : 'crosshair',
            touchAction: 'none',
          },
        },
          h('canvas', {
            ref: inkCanvas,
            onPointerDown: inkDown,
            onPointerMove: inkMove,
            onPointerUp: inkUp,
            onPointerCancel: inkUp,
            onPointerLeave: (e) => { if (inkDrawing.current) inkUp(e) },
            // 初始给 100%：repaintInk 跑之前先铺满，别先闪一块 300×150 的白
            style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', touchAction: 'none', display: 'block' },
          }),
          (inkStore.current[inkKeyOf(item)] || []).length
            ? null
            : h('div', {
              style: {
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', pointerEvents: 'none',
                color: 'var(--sc-mute)', fontSize: 12.4, opacity: 0.75,
              },
            }, '在这块空白上写你的答案 —— 鼠标按住就能画'),
        )

        /* ---- 参考答案（默认藏着） ---- */
        const ansBox = paperAnsOpen
          ? h('div', {
            style: {
              marginTop: 10, padding: '11px 13px', borderRadius: 10,
              background: 'var(--sc-teal-soft)', border: '1px solid var(--sc-teal)',
              fontSize: 12.6, lineHeight: 1.95, whiteSpace: 'pre-wrap',
            },
          },
            h('div', { style: { fontWeight: 700, marginBottom: 5, color: 'var(--sc-nav)' } }, '参考答案'),
            item.answer || '（这份卷子这题没留答案）')
          : null

        /* ---- 底部：上一题 / 下一题 ---- */
        const navBtn = (label, onClick, disabled, pri) => h('div', {
          onClick: disabled ? undefined : onClick,
          style: {
            padding: '8px 18px', borderRadius: 9, fontSize: 12.8, fontWeight: 700,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: disabled ? 'var(--sc-soft)' : (pri ? 'var(--sc-teal)' : 'var(--sc-card)'),
            color: disabled ? 'var(--sc-mute)' : (pri ? '#fff' : 'var(--sc-ink)'),
            border: '1px solid ' + (disabled ? 'var(--sc-line)' : (pri ? 'var(--sc-teal)' : 'var(--sc-line)')),
            opacity: disabled ? 0.55 : 1, userSelect: 'none',
          },
        }, label)

        const nav = h('div', {
          style: { display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, flexWrap: 'wrap' },
        },
          navBtn('◀ 上一题', () => { setPi((v) => Math.max(0, v - 1)); setPaperAnsOpen(false) }, pi === 0),
          h('div', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 11.4, color: 'var(--sc-mute)' } },
            '画了 ' + doneCount + ' / ' + total + ' 题'),
          h('div', { style: { flex: 1 } }),
          navBtn(paperAnsOpen ? '藏起答案' : '看答案', () => setPaperAnsOpen((v) => !v), false),
          navBtn(pi >= total - 1 ? '已是最后一题' : '下一题 ▶', () => { setPi((v) => Math.min(total - 1, v + 1)); setPaperAnsOpen(false) }, pi >= total - 1, true),
        )

        /* ---- 配图抽屉：给这一题挑一张图 ---- */
        const imgPickerEl = imgPickFor
          ? h('div', {
            onClick: (e) => { if (e.target === e.currentTarget) setImgPickFor(null) },
            style: {
              position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(8,14,20,.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            },
          },
            h('div', {
              style: {
                width: 'min(600px,94%)', maxHeight: '86%', overflow: 'auto',
                background: 'var(--sc-card)', borderRadius: 14, padding: '16px 16px 13px',
                boxShadow: 'var(--sc-shadow)', border: '1px solid var(--sc-line)',
              },
            },
              h('div', { style: { fontWeight: 700, fontSize: 13.5, marginBottom: 4 } },
                '给 ' + imgPickFor + ' 挂一张配图'),
              h('div', { style: { fontSize: 11.2, color: 'var(--sc-mute)', lineHeight: 1.75, marginBottom: 10 } },
                '有些题得看着图做。从这门课的资料里挑一张（png / jpg / webp / gif / bmp），'
                + '图会一直挂在 ' + imgPickFor + ' 上，翻题再回来还在。'),
              paperImgs[imgPickFor]
                ? h('button', {
                  className: 'sc-btn danger',
                  style: { marginBottom: 11, padding: '4px 12px', fontSize: 11.6 },
                  disabled: imgBusy,
                  onClick: () => setImageFor(imgPickFor, ''),
                }, imgBusy ? '处理中…' : '摘掉现在这张')
                : null,
              !paperLib.length
                ? h('div', {
                  style: {
                    fontSize: 12, color: 'var(--sc-mute)', textAlign: 'center',
                    padding: '26px 10px', lineHeight: 1.9,
                  },
                },
                  '科目目录里没找到图片文件。',
                  h('br'),
                  '把要用的图（截图、讲义里导出的图）放进 ',
                  h('b', { style: { color: 'var(--sc-nav)' } }, 'C:/Workspace/' + cur),
                  ' 下面任意一个子文件夹，再点一次「🖼 配图」就能看到。')
                : h('div', {
                  style: {
                    display: 'grid', gap: 8,
                    gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))',
                  },
                },
                  paperLib.map((f) => h('div', {
                    key: f.path,
                    title: f.rel,
                    onClick: () => { if (!imgBusy) setImageFor(imgPickFor, f.path) },
                    style: {
                      cursor: imgBusy ? 'wait' : 'pointer', border: '1px solid var(--sc-line)',
                      borderRadius: 10, overflow: 'hidden', background: 'var(--sc-soft)',
                    },
                  },
                    h('img', {
                      src: paperImgUrl(f.path),
                      alt: f.name,
                      loading: 'lazy',
                      style: {
                        width: '100%', height: 96, objectFit: 'cover',
                        display: 'block', background: '#fff',
                      },
                    }),
                    h('div', {
                      style: {
                        padding: '5px 7px', fontSize: 10.3, lineHeight: 1.5,
                        wordBreak: 'break-all', color: 'var(--sc-mute)',
                      },
                    }, f.rel)))),
              h('div', {
                style: { display: 'flex', justifyContent: 'flex-end', marginTop: 13 },
              },
                h('button', {
                  className: 'sc-btn', style: { padding: '5px 14px', fontSize: 11.8 },
                  onClick: () => setImgPickFor(null),
                }, '关闭')),
            ))
          : null

        return h('div', null, picker, toolbar, questionCard, board, ansBox, nav, imgPickerEl)
      })()

      const pane = h('div', {
        ...dragProps,
        className: 'sc-scroll',
        style: { flex: 1, overflow: 'auto', padding: '16px 16px 32px' },
      }, tab === 'files' ? filesPane
        : tab === 'notes' ? notesPane
          : tab === 'papers' ? papersPane
            : tab === 'sched' ? schedPane : cardsPane)

      /* ------------------------------------------------ 支持作者 */
      // 收款码走 /api/study-coach/asset?name=payme.png。
      // 换码只换 assets/payme.png 一个文件，不动代码；图不在就把 <img> 藏掉。
      const supportEl = support
        ? h('div', {
          onClick: (e) => { if (e.target === e.currentTarget) setSupport(false) },
          style: {
            position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(8,14,20,.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          },
        },
          h('div', {
            style: {
              width: 'min(340px,92%)', maxHeight: '86%', overflow: 'auto',
              background: 'var(--sc-card)', borderRadius: 14, padding: '18px 18px 13px',
              boxShadow: 'var(--sc-shadow)', border: '1px solid var(--sc-line)',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 5 } }, '☕ 请作者喝杯奶茶'),
            h('div', { style: { fontSize: 11.6, color: 'var(--sc-mute)', lineHeight: 1.75, marginBottom: 11 } },
              '全部功能免费、MIT 开源。觉得好用随手打赏，不给也照样用 —— 不解锁任何东西，功能一模一样。'),
            h('div', { style: { display: 'flex', gap: 6, marginBottom: 11 } },
              PAY_SLOTS.map((s) => {
                const on = payTab === s.id
                return h('div', {
                  key: s.id,
                  onClick: () => setPayTab(s.id),
                  style: {
                    flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 8, cursor: 'pointer',
                    fontSize: 11.6, fontWeight: on ? 700 : 400,
                    background: on ? 'var(--sc-teal)' : 'var(--sc-soft)',
                    color: on ? '#fff' : 'var(--sc-ink)',
                    border: '1px solid ' + (on ? 'var(--sc-teal)' : 'var(--sc-line)'),
                  },
                }, s.label)
              })),
            h('img', {
              src: '/api/study-coach/asset?name=' + ((PAY_SLOTS.find((s) => s.id === payTab) || PAY_SLOTS[0]).file),
              alt: '打赏收款码',
              style: { width: '100%', maxWidth: 250, borderRadius: 10, display: 'block', margin: '0 auto' },
              onError: (e) => { try { e.target.style.display = 'none' } catch {} },
            }),
            h('div', {
              style: { fontSize: 10.4, color: 'var(--sc-mute)', textAlign: 'center', marginTop: 9, lineHeight: 1.7 },
            }, (PAY_SLOTS.find((s) => s.id === payTab) || PAY_SLOTS[0]).hint),
            h('div', { style: { display: 'flex', gap: 7, marginTop: 15 } },
              h('button', {
                className: 'sc-btn', style: { flex: 1 },
                onClick: () => setSupport(false),
              }, '关闭'),
              h('a', {
                href: 'https://github.com/okita1015/dsh-study-coach',
                target: '_blank',
                rel: 'noreferrer',
                className: 'sc-btn pri',
                style: { flex: 1, textAlign: 'center', textDecoration: 'none', padding: '6px 12px' },
              }, '去仓库看看')),
          ))
        : null

      /* ------------------------------------------------ 备份 / 恢复 */
      const onBackupPicked = async (e) => {
        const f = e.target.files && e.target.files[0]
        if (!f) return
        setBackupBusy(true)
        try {
          const text = await f.text()
          const j = JSON.parse(text)
          const r = await api.post('restore', j)
          if (r && r.ok) {
            say(`恢复了 ${r.restored} 个文件，刷新一下就是备份里的状态`, 'ok')
            setBackup(false)
            loadAll()
          } else {
            say('恢复失败：' + ((r && r.error) || '未知原因'), 'err')
          }
        } catch (err) {
          say('恢复失败：' + err.message, 'err')
        } finally {
          setBackupBusy(false)
          try { e.target.value = '' } catch {}
        }
      }

      const backupEl = backup
        ? h('div', {
          onClick: (e) => { if (e.target === e.currentTarget) setBackup(false) },
          style: {
            position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(8,14,20,.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          },
        },
          h('div', {
            style: {
              width: 'min(380px,92%)', maxHeight: '86%', overflow: 'auto',
              background: 'var(--sc-card)', borderRadius: 14, padding: '18px 18px 13px',
              boxShadow: 'var(--sc-shadow)', border: '1px solid var(--sc-line)',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 5 } }, '💾 备份 / 恢复'),
            h('div', { style: { fontSize: 11.4, color: 'var(--sc-mute)', lineHeight: 1.75, marginBottom: 13 } },
              '掌握度、题卡、答题记录、出卷版式、生成物清单都在一个 JSON 里。换机器、重装 DSH 之前先导一份。'),
            h('div', { style: { display: 'flex', gap: 7 } },
              h('button', {
                className: 'sc-btn pri', style: { flex: 1, padding: '9px' },
                onClick: () => window.open('/api/study-coach/backup', '_blank'),
              }, '下载备份'),
              h('button', {
                className: 'sc-btn', style: { flex: 1, padding: '9px' },
                disabled: backupBusy,
                onClick: () => { if (backupInput.current) backupInput.current.click() },
              }, backupBusy ? '恢复中…' : '从备份恢复')),
            h('div', { style: { fontSize: 10.2, color: 'var(--sc-mute)', marginTop: 10, lineHeight: 1.7 } },
              '恢复会覆盖当前进度，覆盖前自动把现场存到 study/.backup-<时间>/，弄错了还能捞回来。'),
            h('div', { style: { display: 'flex', marginTop: 14 } },
              h('button', { className: 'sc-btn', style: { flex: 1 }, onClick: () => setBackup(false) }, '关闭')),
            h('input', {
              ref: backupInput, type: 'file', accept: '.json,application/json',
              style: { display: 'none' }, onChange: onBackupPicked,
            }),
          ))
        : null

      /* ------------------------------------------------ 做题弹窗 */
      const modalEl = modal
        ? (() => {
          // 做题：能点按钮就别让人打字。
          // 数学题在输入框里打公式基本没法用（^ _ ∑ 都得手敲），
          // 所以把题改造成单选题：四个选项，点一下立刻知道对错。
          const q = quiz
          const picked = quizPick
          const correctId = q ? q.answerId : ''
          const answered = !!picked

          const optionStyle = (o) => {
            const isRight = o.id === correctId
            const isPick = o.id === picked
            if (!answered) {
              return {
                display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer',
                padding: '11px 13px', borderRadius: 10, marginBottom: 8, fontSize: 13,
                background: 'var(--sc-bg)', border: '1px solid var(--sc-line)',
                lineHeight: 1.65,
              }
            }
            // 答完之后：正确项永远绿，选错的那项红
            if (isRight) {
              return {
                display: 'flex', gap: 9, alignItems: 'flex-start',
                padding: '11px 13px', borderRadius: 10, marginBottom: 8, fontSize: 13,
                background: 'var(--sc-teal-soft)', border: '2px solid var(--sc-teal)',
                lineHeight: 1.65, fontWeight: 600,
              }
            }
            if (isPick) {
              return {
                display: 'flex', gap: 9, alignItems: 'flex-start',
                padding: '11px 13px', borderRadius: 10, marginBottom: 8, fontSize: 13,
                background: 'var(--sc-red-soft)', border: '2px solid var(--sc-red)',
                lineHeight: 1.65,
              }
            }
            return {
              display: 'flex', gap: 9, alignItems: 'flex-start',
              padding: '11px 13px', borderRadius: 10, marginBottom: 8, fontSize: 13,
              background: 'var(--sc-bg)', border: '1px solid var(--sc-line)',
              lineHeight: 1.65, opacity: 0.55,
            }
          }

          return h('div', {
            style: {
              position: 'absolute', inset: 0, background: 'rgba(10,14,22,.55)',
              display: 'grid', placeItems: 'center', zIndex: 40, padding: 22,
            },
            onClick: (e) => { if (e.target === e.currentTarget) setModal(null) },
          },
            h('div', {
              style: {
                width: 'min(640px,100%)', maxHeight: '84%', overflow: 'auto',
                background: 'var(--sc-card)', borderRadius: 16, padding: '22px 24px',
                border: '1px solid var(--sc-line)', boxShadow: 'var(--sc-shadow)',
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
                h('span', {
                  style: {
                    fontSize: 10.6, fontWeight: 700, color: 'var(--sc-amber)',
                    background: 'var(--sc-soft)', borderRadius: 6, padding: '2px 8px',
                  },
                }, modal.marks ? modal.marks + ' 分' : '题目'),
                h('span', { style: { fontSize: 10.6, color: 'var(--sc-mute)', flex: 1 } },
                  modal.topicKey || ''),
                h('button', { className: 'sc-btn', onClick: () => setModal(null) }, '关闭')),

              // 题干
              h('div', {
                style: { fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', marginBottom: 14 },
              }, q ? q.stem : modal.question),

              // 加载中
              quizLoading
                ? h('div', { style: { fontSize: 12.6, color: 'var(--sc-teal)', padding: '14px 0' } },
                  '正在把这道题改造成选择题…（几秒）')
                : null,

              // 出题失败 —— 退回「看答案 / 自评」的老路，但明说原因
              quizError
                ? h('div', null,
                  h('div', {
                    style: {
                      fontSize: 12, color: 'var(--sc-red)', background: 'var(--sc-red-soft)',
                      padding: '10px 12px', borderRadius: 9, marginBottom: 12, lineHeight: 1.7,
                    },
                  }, '选择题没生成出来：' + quizError + '　可以看答案后自评。'),
                  showAns
                    ? h('div', {
                      style: {
                        background: 'var(--sc-teal-soft)', borderLeft: '4px solid var(--sc-teal)',
                        borderRadius: 9, padding: '12px 14px', fontSize: 12.8,
                        whiteSpace: 'pre-wrap', color: 'var(--sc-ink)', marginBottom: 14,
                      },
                    }, (curState && curState.answers && curState.answers[modal.id]) || '（未录答案）')
                    : null,
                  h('div', { style: { display: 'flex', gap: 9 } },
                    h('button', {
                      className: 'sc-btn', style: { flex: 1, padding: '10px' },
                      onClick: () => setShowAns(true),
                    }, '看答案'),
                    h('button', {
                      className: 'sc-btn', style: { flex: 1, padding: '10px' },
                      onClick: () => { setQuizError(null); loadQuiz(modal) },
                    }, '重试'),
                    h('button', {
                      className: 'sc-btn danger', style: { flex: 1, padding: '10px', fontWeight: 650 },
                      onClick: () => judge(false),
                    }, '不会'),
                    h('button', {
                      className: 'sc-btn pri', style: { flex: 1, padding: '10px' },
                      onClick: () => judge(true),
                    }, '我会了')))
                : null,

              // 选项
              q && !quizLoading && !quizError
                ? h('div', null,
                  q.options.map((o) => h('div', {
                    key: o.id,
                    onClick: () => {
                      if (answered) return
                      setQuizPick(o.id)
                      const right = o.id === correctId
                      // 立刻记成绩：对 +15%，错 -25%，排下次复习
                      judge(right, { silent: true })
                    },
                    style: optionStyle(o),
                  },
                    h('span', {
                      style: {
                        flex: 'none', width: 22, height: 22, borderRadius: 6, fontSize: 11.6,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: answered && o.id === correctId ? 'var(--sc-teal)'
                          : answered && o.id === picked ? 'var(--sc-red)' : 'var(--sc-soft)',
                        color: answered && (o.id === correctId || o.id === picked) ? '#fff' : 'var(--sc-mute)',
                        fontWeight: 700,
                      },
                    }, o.id),
                    h('div', { style: { flex: 1, minWidth: 0, wordBreak: 'break-word' } }, o.text),
                    answered && o.id === correctId
                      ? h('span', { style: { fontSize: 15, flex: 'none' } }, '✅')
                      : answered && o.id === picked
                        ? h('span', { style: { fontSize: 15, flex: 'none' } }, '❌')
                        : null)),

                  // 判定结果
                  answered
                    ? h('div', {
                      style: {
                        marginTop: 6, padding: '12px 14px', borderRadius: 10,
                        background: picked === correctId ? 'var(--sc-teal-soft)' : 'var(--sc-red-soft)',
                        border: '1px solid ' + (picked === correctId ? 'var(--sc-teal)' : 'var(--sc-red)'),
                      },
                    },
                      h('div', {
                        style: {
                          fontSize: 13.4, fontWeight: 800, marginBottom: 6,
                          color: picked === correctId ? 'var(--sc-teal)' : 'var(--sc-red)',
                        },
                      }, picked === correctId ? '✅ 答对了' : '❌ 答错了　正确答案：' + correctId),
                      q.why
                        ? h('div', { style: { fontSize: 12.4, lineHeight: 1.75, marginBottom: 4 } }, q.why)
                        : null,
                      q.trap && picked !== correctId
                        ? h('div', { style: { fontSize: 11.8, color: 'var(--sc-mute)', lineHeight: 1.7 } },
                          '常见坑：' + q.trap)
                        : null,
                      h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
                        h('button', {
                          className: 'sc-btn', style: { padding: '6px 12px', fontSize: 11.6 },
                          onClick: () => { setQuizPick(null); setShowAns(false) },
                        }, '再做一次'),
                        h('button', {
                          className: 'sc-btn pri', style: { padding: '6px 14px', fontSize: 11.6 },
                          onClick: () => { setModal(null); setQuizPick(null) },
                        }, '下一题')))
                    : null)
                : null,

              // 底部：看答案（不答题时的兜底）
              q && !answered && !quizLoading && !quizError
                ? h('div', { style: { display: 'flex', gap: 9, marginTop: 8 } },
                  h('button', {
                    className: 'sc-btn', style: { flex: 1, padding: '8px', fontSize: 11.8 },
                    onClick: () => setShowAns((v) => !v),
                  }, showAns ? '收起答案' : '直接看答案'),
                  showAns
                    ? null
                    : h('span', { style: { fontSize: 10.8, color: 'var(--sc-mute)', alignSelf: 'center' } },
                      '点选项就会判分并记录掌握度'))
                : null,

              showAns && q && !answered
                ? h('div', {
                  style: {
                    marginTop: 10, background: 'var(--sc-teal-soft)',
                    borderLeft: '4px solid var(--sc-teal)', borderRadius: 9,
                    padding: '12px 14px', fontSize: 12.8, whiteSpace: 'pre-wrap',
                    color: 'var(--sc-ink)',
                  },
                }, (curState && curState.answers && curState.answers[modal.id]) || '（未录答案）')
                : null))
        })()
        : null

      /* ------------------------------------------------ 文档弹窗 */
      const docEl = doc
        ? h('div', {
          style: {
            position: 'absolute', inset: 0, background: 'rgba(10,14,22,.55)',
            display: 'grid', placeItems: 'center', zIndex: 45, padding: 22,
          },
          onClick: (e) => { if (e.target === e.currentTarget) setDoc(null) },
        },
          h('div', {
            style: {
              width: 'min(760px,100%)', maxHeight: '86%', display: 'flex',
              flexDirection: 'column', background: 'var(--sc-card)', borderRadius: 16,
              border: '1px solid var(--sc-line)', boxShadow: 'var(--sc-shadow)', overflow: 'hidden',
            },
          },
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px',
                borderBottom: '1px solid var(--sc-line)', flexWrap: 'wrap',
              },
            },
              h('div', { style: { fontWeight: 700, fontSize: 13 } }, doc.filename),
              h('div', { style: { flex: 1 } }),
              h('select', {
                className: 'sc-input',
                style: { width: 'auto', padding: '5px 8px', fontSize: 11.5 },
                value: doc.locale,
                onChange: (e) => makeDoc(doc.kind, e.target.value),
              },
                h('option', { value: 'both' }, '中英对照'),
                h('option', { value: 'zh' }, '纯中文'),
                h('option', { value: 'en' }, 'English only')),
              h('button', { className: 'sc-btn', onClick: copyDoc }, '复制'),
              h('button', { className: 'sc-btn', onClick: downloadDoc }, '下载'),
              h('button', { className: 'sc-btn pri', onClick: saveDoc }, '存进科目'),
              h('button', { className: 'sc-btn', onClick: () => setDoc(null) }, '关闭')),
            h('div', {
              className: 'sc-doc sc-scroll',
              style: { flex: 1, overflow: 'auto', padding: '16px 18px' },
            }, doc.markdown)),
        )
        : null

      /* ------------------------------------------------ 事件表单 */
      const dayFormEl = dayForm
        ? h('div', {
          style: {
            position: 'absolute', inset: 0, background: 'rgba(10,14,22,.5)',
            display: 'grid', placeItems: 'center', zIndex: 46, padding: 22,
          },
          onClick: (e) => { if (e.target === e.currentTarget) setDayForm(null) },
        },
          h('div', {
            style: {
              width: 'min(460px,100%)', background: 'var(--sc-card)',
              borderRadius: 15, padding: '20px 22px',
              border: '1px solid var(--sc-line)', boxShadow: 'var(--sc-shadow)',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 13.5, marginBottom: 13 } },
              '新建日程　' + dayForm.date),
            h('div', { style: { display: 'flex', gap: 5, marginBottom: 11, flexWrap: 'wrap' } },
              (sched && sched.types ? sched.types : []).map((ty) =>
                h('div', {
                  key: ty.key,
                  onClick: () => setDayForm({ ...dayForm, type: ty.key }),
                  style: {
                    padding: '5px 11px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                    background: dayForm.type === ty.key ? 'var(--sc-teal-soft)' : 'var(--sc-soft)',
                    color: dayForm.type === ty.key ? 'var(--sc-teal)' : 'var(--sc-mute)',
                    border: '1px solid ' + (dayForm.type === ty.key ? 'var(--sc-teal)' : 'transparent'),
                    fontWeight: dayForm.type === ty.key ? 650 : 400,
                  },
                }, ty.icon + ' ' + ty.label))),
            h('input', {
              className: 'sc-input', placeholder: '标题，例如 期末考',
              value: dayForm.title, autoFocus: true,
              style: { marginBottom: 8 },
              onChange: (e) => setDayForm({ ...dayForm, title: e.target.value }),
              onKeyDown: (e) => {
                if (e.key === 'Enter') addEvent(dayForm)
              },
            }),
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 8 } },
              h('input', {
                className: 'sc-input', placeholder: '时间 09:30（可空）',
                value: dayForm.time,
                onChange: (e) => setDayForm({ ...dayForm, time: e.target.value }),
              }),
              h('input', {
                className: 'sc-input', placeholder: '备注（可空）',
                value: dayForm.note,
                onChange: (e) => setDayForm({ ...dayForm, note: e.target.value }),
              })),
            h('div', { style: { fontSize: 10.8, color: 'var(--sc-mute)', marginBottom: 13, lineHeight: 1.7 } },
              '存下来以后可以点右上「导出 .ics」，导进 Google 日历 / Outlook / 手机日历，到点会自动提醒。'),
            h('div', { style: { display: 'flex', gap: 9 } },
              h('button', {
                className: 'sc-btn', style: { flex: 1, padding: '9px' },
                onClick: () => setDayForm(null),
              }, '取消'),
              h('button', {
                className: 'sc-btn pri', style: { flex: 1, padding: '9px' },
                onClick: () => addEvent(dayForm),
              }, '保存'))))
        : null

      /* ------------------------------------------------ 问答抽屉 */
      const askEl = ask
        ? h('div', {
          style: {
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(400px,86%)',
            background: 'var(--sc-card)', borderLeft: '1px solid var(--sc-line)',
            display: 'flex', flexDirection: 'column', zIndex: 50,
            boxShadow: 'var(--sc-shadow)',
          },
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
              borderBottom: '1px solid var(--sc-line)',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 12.8 } },
              '💬 问 AI' + (curSubj ? ' · ' + curSubj.code : '')),
            h('div', { style: { flex: 1 } }),
            h('button', {
              className: 'sc-btn',
              style: { padding: '2px 9px', fontSize: 12 },
              onClick: () => setAsk(false),
            }, '×')),
          h('div', {
            className: 'sc-scroll',
            style: { flex: 1, overflow: 'auto', padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 9 },
          },
            askLog.length === 0
              ? h('div', { style: { color: 'var(--sc-mute)', fontSize: 12.2, lineHeight: 1.9 } },
                '问点什么吧，比如：',
                h('br'),
                '· 这章最容易考什么？',
                h('br'),
                '· K-map 怎么圈才不出错？',
                h('br'),
                '· 用一句话讲清贝叶斯')
              : null,
            askLog.map((m, i) =>
              h('div', {
                key: i,
                style: {
                  alignSelf: m.role === 'me' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  background: m.role === 'me' ? 'var(--sc-teal-soft)'
                    : m.role === 'err' ? 'var(--sc-red-soft)' : 'var(--sc-soft)',
                  color: m.role === 'err' ? 'var(--sc-red)' : 'var(--sc-ink)',
                  borderRadius: 11, padding: '8px 11px', fontSize: 12.4,
                  lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                },
              }, m.text))),
          h('div', {
            style: {
              display: 'flex', gap: 7, padding: '10px 12px',
              borderTop: '1px solid var(--sc-line)',
            },
          },
            h('input', {
              className: 'sc-input', placeholder: askBusy ? '正在想…' : '输入问题，回车发送',
              value: askQ, disabled: askBusy,
              onChange: (e) => setAskQ(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') sendAsk() },
            }),
            h('button', {
              className: 'sc-btn pri', disabled: askBusy,
              onClick: sendAsk, style: { padding: '7px 14px' },
            }, askBusy ? '…' : '发送')))
        : null

      /* ------------------------------------------------ 翻译抽屉 */
      const transFiles = transFilesOf()
      const transEl = trans
        ? h('div', {
          style: {
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(400px,86%)',
            background: 'var(--sc-card)', borderLeft: '1px solid var(--sc-line)',
            display: 'flex', flexDirection: 'column', zIndex: 50,
            boxShadow: 'var(--sc-shadow)',
          },
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
              borderBottom: '1px solid var(--sc-line)',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 12.8 } },
              '🌐 中英对照' + (curSubj ? ' · ' + curSubj.code : '')),
            h('div', { style: { flex: 1 } }),
            h('button', {
              className: 'sc-btn',
              style: { padding: '2px 9px', fontSize: 12 },
              onClick: () => setTrans(false),
            }, '×')),

          h('div', { style: { padding: '12px 14px', borderBottom: '1px solid var(--sc-line)' } },
            h('div', { style: { display: 'flex', gap: 7, marginBottom: 10 } },
              [[ 'topics', '📚 知识点标题' ], [ 'file', '📄 整份文件' ]].map(([k, label]) =>
                h('button', {
                  key: k,
                  className: transMode === k ? 'sc-btn pri' : 'sc-btn',
                  style: { flex: 1, padding: '6px', fontSize: 12 },
                  onClick: () => {
                    setTransMode(k)
                    if (k === 'topics') checkPending(transTarget)
                  },
                }, label))),
            h('div', { style: { display: 'flex', gap: 7, marginBottom: 9 } },
              [[ 'en', '中 → 英' ], [ 'zh', '英 → 中' ]].map(([k, label]) =>
                h('button', {
                  key: k,
                  className: transTarget === k ? 'sc-btn pri' : 'sc-btn',
                  style: { flex: 1, padding: '6px', fontSize: 12 },
                  onClick: () => {
                    setTransTarget(k)
                    setTransPreview(null); setTransSaved(''); setTransFileErr('')
                    if (transMode === 'topics') checkPending(k)
                  },
                }, label))),

            transMode === 'topics'
              ? h('div', {},
                h('label', {
                  style: {
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.6,
                    color: 'var(--sc-mute)', marginBottom: 9, cursor: 'pointer',
                  },
                },
                  h('input', {
                    type: 'checkbox', checked: transForce,
                    onChange: (e) => setTransForce(e.target.checked),
                  }),
                  '连已有的也重译一遍'),
                h('div', { style: { fontSize: 11.6, color: 'var(--sc-mute)', marginBottom: 10 } },
                  transPending === null
                    ? '正在数…'
                    : transPending === 0
                      ? '这个科目已经不缺了，中英都齐。'
                      : `待翻译 ${transPending} 条`),
                h('button', {
                  className: 'sc-btn pri', disabled: transBusy || transPending === 0,
                  style: { width: '100%', padding: '8px' },
                  onClick: runTranslate,
                }, transBusy ? '翻译中…（每条几秒）' : '开始翻译'),
                h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', marginTop: 9, lineHeight: 1.7 } },
                  '走 DSH 自己的模型服务，结果直接写进 topics.json —— 笔记、总结、速记卡立刻是中英对照的。'))
              : h('div', {},
                h('select', {
                  style: {
                    width: '100%', padding: '7px 8px', fontSize: 12, marginBottom: 8,
                    borderRadius: 8, border: '1px solid var(--sc-line)',
                    background: 'var(--sc-soft)', color: 'var(--sc-ink)',
                  },
                  value: transFile,
                  onChange: (e) => {
                    setTransFile(e.target.value)
                    setTransPreview(null); setTransSaved(''); setTransFileErr('')
                  },
                },
                  h('option', { value: '' },
                    transFiles.length ? '— 选一份文件 —' : '这个科目还没有能抽文本的文件'),
                  transFiles.map((f) => h('option', { key: f.path, value: f.path }, f.label))),
                h('div', { style: { display: 'flex', gap: 7 } },
                  h('button', {
                    className: 'sc-btn pri',
                    disabled: !transFile || transFileBusy,
                    style: { flex: 1, padding: '7px' },
                    onClick: () => runFileTranslate(false),
                  }, transFileBusy ? '翻译中…' : '翻译并预览'),
                  transFile
                    ? h('button', {
                      className: 'sc-btn',
                      disabled: transFileBusy,
                      style: { padding: '7px 10px' },
                      title: '不看缓存，整份重译一遍',
                      onClick: () => runFileTranslate(true),
                    }, '重译')
                    : null),
                transFileBusy
                  ? h('div', { style: { fontSize: 11, color: 'var(--sc-mute)', marginTop: 8 } },
                    '整份要分几批送模型，长文件十几秒。')
                  : null,
                transFileErr
                  ? h('div', {
                    style: { fontSize: 11.4, color: 'var(--sc-red)', marginTop: 8, lineHeight: 1.7 },
                  }, transFileErr)
                  : null,
                transPreview && transPreview.ok
                  ? h('div', {
                    style: { fontSize: 11, color: 'var(--sc-mute)', marginTop: 8, lineHeight: 1.7 },
                  },
                    `${transPreview.segments.length} 段 · 原文 ${transPreview.chars} 字` +
                    (transPreview.truncated ? `（全文 ${transPreview.total} 字，只翻了前一段）` : '') +
                    ` · ${((transPreview.ms || 0) / 1000).toFixed(1)}s` +
                    (transPreview.cached ? ' · 走的缓存' : ''))
                  : null,
                transPreview && transPreview.ok
                  ? h('button', {
                    className: transSaved ? 'sc-btn' : 'sc-btn',
                    style: { width: '100%', padding: '7px', marginTop: 8 },
                    onClick: saveFileTranslate,
                  }, transSaved ? '✅ 已存：' + String(transSaved).split(/[\\/]/).pop() : '存成中英对照笔记')
                  : null,
                h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', marginTop: 9, lineHeight: 1.7 } },
                  '讲义 / 试卷 / Tutorial 都能选，PDF、Word、PPT 自动抽文本。翻完先对着看，满意再存。'))),

          h('div', {
            className: 'sc-scroll',
            style: {
              flex: 1, overflow: 'auto', padding: '13px 14px',
              display: 'flex', flexDirection: 'column', gap: 8,
            },
          },
            transMode === 'topics'
              ? (transLog.length === 0
                ? h('div', { style: { color: 'var(--sc-mute)', fontSize: 12.2, lineHeight: 1.9 } },
                  '考卷是英文的，所以每一条知识点最好中英都有。',
                  h('br'),
                  '点上面的按钮，缺的那一边我补齐。')
                : transLog.map((m, i) =>
                  h('div', {
                    key: i,
                    style: {
                      fontSize: m.role === 'pair' ? 11.8 : 12.2,
                      lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      color: m.role === 'err' ? 'var(--sc-red)' : m.role === 'pair' ? 'var(--sc-ink)' : 'var(--sc-mute)',
                      background: m.role === 'err' ? 'var(--sc-red-soft)'
                        : m.role === 'pair' ? 'var(--sc-soft)' : 'transparent',
                      borderRadius: m.role === 'pair' ? 8 : 0,
                      padding: m.role === 'pair' ? '6px 9px' : 0,
                      fontWeight: m.role === 'info' ? 600 : 400,
                    },
                  }, m.text)))
              : (transPreview && transPreview.ok
                ? transPreview.segments.map((s) =>
                  h('div', {
                    key: s.i,
                    style: {
                      background: 'var(--sc-soft)', borderRadius: 8, padding: '7px 9px',
                      borderLeft: '2px solid var(--sc-line)',
                    },
                  },
                    h('div', { style: { fontSize: 10.2, color: 'var(--sc-mute)', marginBottom: 3 } },
                      '#' + (Number(s.i) + 1)),
                    h('div', {
                      style: {
                        fontSize: 11.4, lineHeight: 1.7, color: 'var(--sc-mute)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 5,
                      },
                    }, s.src),
                    h('div', {
                      style: {
                        fontSize: 12.2, lineHeight: 1.75, color: 'var(--sc-ink)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      },
                    }, s.dst || '（这一段没译出来，可以点「重译」）')))
                : h('div', { style: { color: 'var(--sc-mute)', fontSize: 12.2, lineHeight: 1.9 } },
                  '选一份文件，点「翻译并预览」。',
                  h('br'),
                  '这里会一段原文、一段译文对着排；上面灰的是原文，下面亮的是译文。'))))
        : null

      /* ------------------------------------------------ 一键生成抽屉 */
      const genEl = gen
        ? (() => {
          const src = genSources
          const picked = Object.keys(genPick).filter((p) => genPick[p]).length
          const job = genJob
          const pctDone = job && job.progress && job.progress.total
            ? Math.round((job.progress.done / job.progress.total) * 100)
            : 0
          const wantRows = [
            ['note', '📝 笔记', '整份讲义 → 一份能直接读的笔记。它就是「笔记」页看的那份，前面那步会自动排成 Word'],
            ['topics', '📌 知识点', '另外提炼成知识点库 + 题卡（要刷题/出卷才勾）'],
            ['summary', '📄 总结', '掌握度总览 + 按章节明细 + 最该补的'],
            ['cheatsheet', '⚡ 速记卡', '每条一行，一页纸能看完'],
            ['docx', '📘 Word', '笔记的正式文件。勾了「笔记」就一定有它，取消也会自动带上'],
            ['pptx', '📊 PPT', '16:9 课件，能拿去讲'],
            ['pdf', '📱 PDF', '排版固定，手机上直接看，发给同学不变形'],
          ]

          return h('div', {
            style: {
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(440px,90%)',
              background: 'var(--sc-card)', borderLeft: '1px solid var(--sc-line)',
              display: 'flex', flexDirection: 'column', zIndex: 50,
              boxShadow: 'var(--sc-shadow)',
            },
          },
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
                borderBottom: '1px solid var(--sc-line)',
              },
            },
              h('div', { style: { fontWeight: 700, fontSize: 12.8 } },
                '🪄 一键生成' + (curSubj ? ' · ' + curSubj.code : '')),
              h('div', { style: { flex: 1 } }),
              h('button', {
                className: 'sc-btn', style: { padding: '2px 9px', fontSize: 12 },
                onClick: () => setGen(false),
              }, '×')),

            h('div', {
              className: 'sc-scroll',
              style: { flex: 1, overflow: 'auto', padding: '13px 14px' },
            },
              /* 讲义选择 */
              h('div', { style: { fontSize: 11.4, fontWeight: 700, color: 'var(--sc-mute)', marginBottom: 7 } },
                '① 用哪些讲义'),
              !src
                ? h('div', { style: { fontSize: 12, color: 'var(--sc-mute)' } }, '正在读讲义目录…')
                : !src.ok
                  ? h('div', { style: { fontSize: 12, color: 'var(--sc-red)' } }, '读不到讲义：' + (src.error || ''))
                  : !(src.files || []).length
                    ? h('div', { style: { fontSize: 12, color: 'var(--sc-mute)', lineHeight: 1.8 } },
                      '讲义分区里还没有 PDF / PPTX / DOCX。',
                      h('br'),
                      '先把 Moodle 的课件拖进「讲义」，再回来点这个。')
                    : h('div', null,
                      (src.files || []).map((f) =>
                        h('label', {
                          key: f.path,
                          style: {
                            display: 'flex', alignItems: 'flex-start', gap: 7,
                            padding: '6px 8px', borderRadius: 8, marginBottom: 4,
                            background: genPick[f.path] ? 'var(--sc-teal-soft)' : 'transparent',
                            border: '1px solid ' + (genPick[f.path] ? 'var(--sc-teal)' : 'var(--sc-line)'),
                            cursor: 'pointer', fontSize: 11.8,
                          },
                        },
                          h('input', {
                            type: 'checkbox', checked: !!genPick[f.path],
                            onChange: (e) => setGenPick({ ...genPick, [f.path]: e.target.checked }),
                            style: { marginTop: 2 },
                          }),
                          h('div', { style: { flex: 1, minWidth: 0 } },
                            h('div', { style: { fontWeight: 600, wordBreak: 'break-word' } },
                              (FILE_ICON[f.ext] || '📎') + ' ' + f.name),
                            h('div', { style: { fontSize: 10.4, color: 'var(--sc-mute)', marginTop: 1 } },
                              (f.lecture ? f.lecture + ' · ' : '') + f.sizeText)),
                        )),
                      src.unsupported && src.unsupported.length
                        ? h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', marginTop: 6, lineHeight: 1.7 } },
                          '跳过（抽不了文本）：' + src.unsupported.map((u) => u.name).join('、'))
                        : null),

              /* 产出选择 */
              h('div', { style: { fontSize: 11.4, fontWeight: 700, color: 'var(--sc-mute)', margin: '14px 0 7px' } },
                '② 要生成什么'),
              wantRows.map(([k, label, desc]) =>
                h('label', {
                  key: k,
                  style: {
                    display: 'flex', alignItems: 'flex-start', gap: 7, padding: '6px 8px',
                    borderRadius: 8, marginBottom: 4, cursor: 'pointer', fontSize: 11.8,
                    border: '1px solid ' + (genWant[k] ? 'var(--sc-line)' : 'transparent'),
                  },
                },
                  h('input', {
                    type: 'checkbox', checked: !!genWant[k],
                    onChange: (e) => {
                      const checked = e.target.checked
                      const next = { ...genWant, [k]: checked }
                      // 笔记 / 总结 / 速记卡都是「先写正文再排版」，没有 Word 就没有对外文件
                      // （不再落 .md）。所以勾这几个的时候顺手把 Word 带上。
                      if (checked && ['note', 'summary', 'cheatsheet'].includes(k)) next.docx = true
                      // 反过来：笔记还勾着却取消 Word → 结果会是「跑完了什么文件都没有」，
                      // 笔记页自然也看不到。这里直接留住，并说清为什么。
                      if (!checked && k === 'docx' && (next.note || next.summary || next.cheatsheet)) {
                        next.docx = true
                        say('笔记 / 总结 / 速记卡要靠 Word 才出得来文件，Word 不能单独取消', 'err')
                      }
                      setGenWant(next)
                    },
                    style: { marginTop: 2 },
                  }),
                  h('div', null,
                    h('div', { style: { fontWeight: 600 } }, label),
                    h('div', { style: { fontSize: 10.2, color: 'var(--sc-mute)' } }, desc)))),

              /* ③ 生成偏好：直接改模型怎么写 */
              prefsSchema.length
                ? h('div', null,
                  h('div', { style: { fontSize: 11.4, fontWeight: 700, color: 'var(--sc-mute)', margin: '14px 0 7px' } },
                    '③ 生成偏好'),
                  prefsSchema.map((p) =>
                    h('div', { key: p.key, style: { marginBottom: 9 } },
                      h('div', { style: { fontSize: 11, fontWeight: 650, marginBottom: 4 } }, p.label),
                      h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                        p.options.map((o) => {
                          const on = (prefs && prefs[p.key]) === o.id
                          return h('div', {
                            key: o.id,
                            title: o.desc || '',
                            onClick: () => setPref(p.key, o.id),
                            style: {
                              padding: '3px 10px', borderRadius: 7, fontSize: 10.8, cursor: 'pointer',
                              background: on ? 'var(--sc-teal)' : 'var(--sc-soft)',
                              color: on ? '#fff' : 'var(--sc-ink)',
                              border: '1px solid ' + (on ? 'var(--sc-teal)' : 'var(--sc-line)'),
                              fontWeight: on ? 700 : 400,
                            },
                          }, o.label)
                        })),
                      p.hint
                        ? h('div', { style: { fontSize: 9.8, color: 'var(--sc-mute)', marginTop: 3 } }, p.hint)
                        : null)))
                : null,

              /* 开始 */
              h('div', { style: { display: 'flex', gap: 7, marginTop: 14 } },
                h('button', {
                  className: 'sc-btn pri',
                  disabled: genBusy || !picked,
                  style: { flex: 1, padding: '9px' },
                  onClick: startGen,
                }, genBusy ? '跑着…' : `开始（${picked} 份讲义）`),
                h('button', {
                  className: 'sc-btn', disabled: genBusy,
                  title: '不重跑模型，只拿现成的知识点重排一遍 Word / PPT',
                  style: { padding: '9px 12px' },
                  onClick: renderOnly,
                }, '只重排文档')),

              /* 进度 */
              job
                ? h('div', { style: { marginTop: 16 } },
                  h('div', {
                    style: {
                      height: 6, borderRadius: 4, background: 'var(--sc-soft)',
                      overflow: 'hidden', marginBottom: 7,
                    },
                  },
                    h('div', {
                      style: {
                        width: pctDone + '%', height: '100%',
                        background: job.state === 'failed' ? 'var(--sc-red)' : 'var(--sc-teal)',
                        transition: 'width .3s',
                      },
                    })),
                  h('div', {
                    style: {
                      fontSize: 11.8, fontWeight: 650, marginBottom: 8,
                      color: job.state === 'failed' ? 'var(--sc-red)'
                        : job.state === 'done' ? 'var(--sc-teal)' : 'var(--sc-ink)',
                    },
                  },
                    (job.state === 'running' ? '⏳ ' : job.state === 'done' ? '✅ '
                      : job.state === 'partial' ? '⚠️ ' : '❌ ') + (job.step || '')),
                  h('div', { style: { display: 'flex', gap: 10, fontSize: 10.8, color: 'var(--sc-mute)', marginBottom: 8 } },
                    h('span', null, '知识点 +' + (job.out ? job.out.topics : 0)),
                    h('span', null, '题卡 +' + (job.out ? job.out.cards : 0)),
                    h('span', null, '文件 ' + (job.out ? job.out.files.length : 0))),
                  job.out && job.out.files && job.out.files.length
                    ? h('div', { style: { marginBottom: 10 } },
                      job.out.files.map((f) =>
                        h('div', {
                          key: f.path,
                          style: {
                            fontSize: 11.6, padding: '5px 8px', borderRadius: 7,
                            background: 'var(--sc-soft)', marginBottom: 3,
                            display: 'flex', gap: 6, alignItems: 'center',
                          },
                        },
                          h('span', null, f.kind === 'pptx' ? '📊' : f.kind === 'docx' ? '📘' : f.kind === 'pdf' ? '📱' : '📄'),
                          h('div', { style: { flex: 1, minWidth: 0 } },
                            h('div', { style: { wordBreak: 'break-all', fontSize: 11.2 } }, f.name),
                            // 显示落在哪个文件夹 —— 不然「我的 ppt 去哪了」找不着
                            h('div', {
                              title: f.path,
                              style: { fontSize: 9.8, color: 'var(--sc-mute)', wordBreak: 'break-all' },
                            }, relPath(f.path))),
                          h('button', {
                            className: 'sc-btn',
                            style: { padding: '1px 7px', fontSize: 10.4 },
                            onClick: () => openPreview(f),
                          }, '打开'))))
                    : null,
                  job.logs && job.logs.length
                    ? h('div', {
                      style: {
                        fontSize: 11, lineHeight: 1.75, color: 'var(--sc-mute)',
                        background: 'var(--sc-soft)', borderRadius: 9, padding: '8px 10px',
                        maxHeight: 220, overflow: 'auto',
                      },
                    },
                      job.logs.slice(-24).map((l, i) =>
                        h('div', {
                          key: i,
                          style: { color: l.kind === 'err' ? 'var(--sc-red)' : l.kind === 'warn' ? 'var(--sc-amber)' : 'inherit' },
                        }, l.text)))
                    : null)
                : h('div', {
                  style: { marginTop: 14, fontSize: 11, color: 'var(--sc-mute)', lineHeight: 1.9 },
                },
                  '跑起来是要几分钟的：每份讲义抽文本几秒，模型提炼一份十几秒。',
                  h('br'),
                  '产出的文件落在科目的「1_复习资料」，自动标成 DSH 生成，跟讲义分开。')))
        })()
        : null

      /* ------------------------------------------------ 出练习卷抽屉 */
      const paperEl = paper
        ? (() => {
          const info = paperInfo
          const job = paperJob
          const pctDone = job && job.progress && job.progress.total
            ? Math.round((job.progress.done / job.progress.total) * 100)
            : 0
          const opts = (info && info.options) || []
          const tpls = (info && info.templates) || []
          const curTpl = tpls.find((t) => t.path === paperTpl) || null
          const analyzed = info && info.current
          const sameAsAnalyzed = analyzed && curTpl && analyzed.sourceName === curTpl.name

          const selectStyle = {
            fontSize: 11.8, padding: '5px 8px', borderRadius: 7,
            border: '1px solid var(--sc-line)', background: 'var(--sc-card)',
            color: 'var(--sc-ink)',
          }

          return h('div', {
            style: {
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(440px,90%)',
              background: 'var(--sc-card)', borderLeft: '1px solid var(--sc-line)',
              display: 'flex', flexDirection: 'column', zIndex: 50,
              boxShadow: 'var(--sc-shadow)',
            },
          },
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
                borderBottom: '1px solid var(--sc-line)',
              },
            },
              h('div', { style: { fontWeight: 700, fontSize: 12.8 } },
                '📝 出练习卷' + (curSubj ? ' · ' + curSubj.code : '')),
              h('div', { style: { flex: 1 } }),
              h('button', {
                className: 'sc-btn', style: { padding: '2px 9px', fontSize: 12 },
                onClick: () => setPaper(false),
              }, '×')),

            h('div', {
              className: 'sc-scroll',
              style: { flex: 1, overflow: 'auto', padding: '13px 14px' },
            },
              /* ① 模板 */
              h('div', { style: { fontSize: 11.4, fontWeight: 700, color: 'var(--sc-mute)', marginBottom: 6 } },
                '① 照哪份真卷的版式'),
              !info
                ? h('div', { style: { fontSize: 12, color: 'var(--sc-mute)' } }, '正在读试卷目录…')
                : !info.ok
                  ? h('div', { style: { fontSize: 12, color: 'var(--sc-red)' } }, '读不到：' + (info.error || ''))
                  : !tpls.length
                    ? h('div', { style: { fontSize: 12, color: 'var(--sc-mute)', lineHeight: 1.8 } },
                      '试卷分区里没有 PDF / DOCX 卷子。',
                      h('br'),
                      '把你那份校内真卷拖进「试卷」再回来。')
                    : h('div', null,
                      h('select', {
                        value: paperTpl,
                        onChange: (e) => setPaperTpl(e.target.value),
                        style: { ...selectStyle, width: '100%', marginBottom: 7 },
                      }, tpls.map((t) =>
                        h('option', { key: t.path, value: t.path }, t.name))),
                      h('div', { style: { display: 'flex', gap: 7, alignItems: 'center' } },
                        h('button', {
                          className: 'sc-btn', disabled: paperBusy || !paperTpl || sameAsAnalyzed,
                          style: { flex: 1, padding: '7px' },
                          onClick: analyzePaper,
                        }, sameAsAnalyzed ? '版式已解析' : '分析版式'),
                        analyzed
                          ? h('div', { style: { fontSize: 10.6, color: 'var(--sc-mute)', flex: 1, lineHeight: 1.6 } },
                            '当前缓存：' + analyzed.sourceName,
                            h('br'),
                            analyzed.sections.map((s) => `${s.name} ${s.questionCount}题`).join(' · '))
                          : null),
                      analyzed && !sameAsAnalyzed
                        ? h('div', { style: { fontSize: 10.6, color: 'var(--sc-amber)', marginTop: 6 } },
                          '注意：选了别的卷子，出卷会用旧的版式缓存，先点「分析版式」。')
                        : null),

              /* ② 范围 */
              h('div', { style: { fontSize: 11.4, fontWeight: 700, color: 'var(--sc-mute)', margin: '14px 0 6px' } },
                '② 题目范围'),
              opts.length
                ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
                  h('select', {
                    value: paperFrom,
                    onChange: (e) => setPaperFrom(e.target.value),
                    style: selectStyle,
                  },
                    h('option', { value: '' }, '从…'),
                    opts.map((o) => h('option', { key: 'f' + o.label, value: o.num == null ? '' : String(o.num) },
                      o.label + `（${o.count}）`))),
                  h('span', { style: { fontSize: 12, color: 'var(--sc-mute)' } }, '到'),
                  h('select', {
                    value: paperTo,
                    onChange: (e) => setPaperTo(e.target.value),
                    style: selectStyle,
                  },
                    h('option', { value: '' }, '…到'),
                    opts.map((o) => h('option', { key: 't' + o.label, value: o.num == null ? '' : String(o.num) },
                      o.label))))
                : h('div', { style: { fontSize: 11.6, color: 'var(--sc-mute)', lineHeight: 1.8 } },
                  '这个科目还没有知识点，所以定不了范围。',
                  h('br'),
                  '先点「🪄 一键生成」把讲义变成知识点。'),

              h('label', {
                style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.8, marginTop: 11, cursor: 'pointer' },
              },
                h('input', {
                  type: 'checkbox', checked: paperAnswers,
                  onChange: (e) => setPaperAnswers(e.target.checked),
                }),
                '同时出答案版（含批改参考）'),
              h('label', {
                style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.8, marginTop: 6, cursor: 'pointer' },
              },
                h('input', {
                  type: 'checkbox', checked: paperPdf,
                  onChange: (e) => setPaperPdf(e.target.checked),
                }),
                '同时出 PDF（手机上做卷子方便）'),

              h('div', { style: { fontSize: 10.8, color: 'var(--sc-mute)', marginTop: 8, lineHeight: 1.75 } },
                '题数、每题分值、有没有 (a)(b) 子题、页眉页脚、题号样式，全部照那份真卷；只把题目内容换成你选的章节。产出落在「3_练习题」。'),

              /* ③ 开始 */
              h('div', { style: { display: 'flex', gap: 7, marginTop: 13 } },
                h('button', {
                  className: 'sc-btn pri',
                  disabled: paperBusy || !analyzed || !opts.length,
                  style: { flex: 1, padding: '9px' },
                  onClick: startPaper,
                }, paperBusy ? '跑着…' : '开始出卷')),

              /* 进度 */
              job
                ? h('div', { style: { marginTop: 16 } },
                  h('div', {
                    style: { height: 6, borderRadius: 4, background: 'var(--sc-soft)', overflow: 'hidden', marginBottom: 7 },
                  },
                    h('div', {
                      style: {
                        width: pctDone + '%', height: '100%',
                        background: job.state === 'failed' ? 'var(--sc-red)' : 'var(--sc-teal)',
                        transition: 'width .3s',
                      },
                    })),
                  h('div', {
                    style: {
                      fontSize: 11.8, fontWeight: 650, marginBottom: 8,
                      color: job.state === 'failed' ? 'var(--sc-red)'
                        : job.state === 'done' ? 'var(--sc-teal)' : 'var(--sc-ink)',
                    },
                  },
                    (job.state === 'running' ? '⏳ ' : job.state === 'done' ? '✅ '
                      : job.state === 'partial' ? '⚠️ ' : '❌ ') + (job.step || '')),
                  job.out && job.out.files && job.out.files.length
                    ? h('div', { style: { marginBottom: 10 } },
                      job.out.files.map((f) =>
                        h('div', {
                          key: f.path,
                          style: {
                            fontSize: 11.6, padding: '5px 8px', borderRadius: 7,
                            background: 'var(--sc-soft)', marginBottom: 3,
                            display: 'flex', gap: 6, alignItems: 'center',
                          },
                        },
                          h('span', null, f.kind === 'paper' ? '📝' : '✅'),
                          h('span', { style: { flex: 1, wordBreak: 'break-all', fontSize: 11.2 } },
                            f.name + (f.questions ? `（${f.questions} 题 / ${f.marks} 分）` : '')),
                          h('button', {
                            className: 'sc-btn', style: { padding: '1px 7px', fontSize: 10.4 },
                            onClick: () => openPreview(f),
                          }, '打开'))))
                    : null,
                  job.logs && job.logs.length
                    ? h('div', {
                      style: {
                        fontSize: 11, lineHeight: 1.75, color: 'var(--sc-mute)',
                        background: 'var(--sc-soft)', borderRadius: 9, padding: '8px 10px',
                        maxHeight: 220, overflow: 'auto',
                      },
                    },
                      job.logs.slice(-24).map((l, i) =>
                        h('div', {
                          key: i,
                          style: { color: l.kind === 'err' ? 'var(--sc-red)' : l.kind === 'warn' ? 'var(--sc-amber)' : 'inherit' },
                        }, l.text)))
                    : null)
                : null))
        })()
        : null

      /* ------------------------------------------------ 导入确认 */
      const importEl = importing
        ? h('div', {
          style: {
            position: 'absolute', inset: 0, background: 'rgba(10,14,22,.5)',
            display: 'grid', placeItems: 'center', zIndex: 48, padding: 22,
          },
          onClick: (e) => { if (e.target === e.currentTarget) setImporting(null) },
        },
          h('div', {
            style: {
              width: 'min(560px,100%)', maxHeight: '84%', overflow: 'auto',
              background: 'var(--sc-card)', borderRadius: 16, padding: '22px 24px',
              border: '1px solid var(--sc-line)', boxShadow: 'var(--sc-shadow)',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 4 } },
              '📂 导入文件夹'),
            h('div', { style: { fontSize: 12, color: 'var(--sc-mute)', marginBottom: 14 } },
              importing.folderName + ' · 共 ' + importing.total + ' 个文件'),
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
              h('input', {
                className: 'sc-input', placeholder: '科目代码 COMP2011',
                value: importing.code,
                onChange: (e) => setImporting({ ...importing, code: e.target.value }),
              }),
              h('input', {
                className: 'sc-input', placeholder: '考试日 YYYY-MM-DD（可空）',
                value: importing.examDate,
                onChange: (e) => setImporting({ ...importing, examDate: e.target.value }),
              })),
            h('div', { style: { fontSize: 11.5, color: 'var(--sc-mute)', margin: '4px 0 9px' } },
              '按文件名自动分区，可以改：'),
            importing.unsure > 0
              ? h('div', {
                style: {
                  fontSize: 11.5, color: 'var(--sc-amber)', background: 'var(--sc-soft)',
                  borderRadius: 8, padding: '7px 10px', marginBottom: 8, lineHeight: 1.7,
                },
              }, '有 ' + importing.unsure + ' 个文件没认出分区，默认放进了「参考」。' +
                '点分组标题可以展开逐个确认，或者用右边的下拉整组改。')
              : null,
            Object.entries(importing.groups).map(([sec, items]) => {
              const sdef = ((config && config.sections) || []).find((x) => x.key === sec)
              const open = !!(importing.open && importing.open[sec])
              return h('div', { key: sec, style: { marginBottom: 6 } },
                h('div', {
                  style: {
                    display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
                    borderRadius: 9, background: 'var(--sc-soft)',
                  },
                },
                  h('div', {
                    style: { fontSize: 12.3, fontWeight: 650, minWidth: 64, cursor: 'pointer' },
                    onClick: () => setImporting({
                      ...importing,
                      open: { ...(importing.open || {}), [sec]: !open },
                    }),
                  }, (open ? '▾ ' : '▸ ') + (sdef ? sdef.label : sec)),
                  h('div', { style: { fontSize: 11.5, color: 'var(--sc-mute)', flex: 1 } },
                    items.length + ' 个'),
                  h('select', {
                  className: 'sc-input',
                  style: { width: 'auto', padding: '3px 7px', fontSize: 11.5 },
                  value: sec,
                  onChange: (e) => {
                    const to = e.target.value
                    if (to === sec) return
                    const g = { ...importing.groups }
                    g[to] = (g[to] || []).concat(g[sec])
                    delete g[sec]
                    setImporting({ ...importing, groups: g })
                  },
                  }, ((config && config.sections) || []).map((x) =>
                    h('option', { key: x.key, value: x.key }, x.label)))),
                open
                  ? h('div', {
                    style: {
                      maxHeight: 150, overflow: 'auto', marginTop: 3,
                      padding: '4px 10px 6px', borderLeft: '2px solid var(--sc-line)',
                      marginLeft: 8,
                    },
                  },
                    items.map((it, i) =>
                      h('div', {
                        key: i,
                        style: {
                          fontSize: 11, color: 'var(--sc-mute)', padding: '1px 0',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        },
                        title: it.rel,
                      }, it.rel)))
                  : null,
              )
            }),
            busy ? h('div', { style: { fontSize: 12, color: 'var(--sc-teal)', margin: '8px 0' } }, busy) : null,
            h('div', { style: { display: 'flex', gap: 9, marginTop: 14 } },
              h('button', {
                className: 'sc-btn', style: { flex: 1, padding: '9px' },
                onClick: () => setImporting(null),
              }, '取消'),
              h('button', {
                className: 'sc-btn pri', style: { flex: 2, padding: '9px' },
                onClick: doImport,
              }, '导入 ' + importing.total + ' 个文件'))))
        : null

      /* ------------------------------------------------ 组装 */
      const toastEl = toast
        ? h('div', {
          style: {
            position: 'absolute', right: 16, bottom: 16, zIndex: 60,
            background: toast.kind === 'err' ? 'var(--sc-red)' : 'var(--sc-teal)',
            color: '#fff', padding: '9px 15px', borderRadius: 9, fontSize: 12.4,
            boxShadow: 'var(--sc-shadow)', pointerEvents: 'none', maxWidth: 380,
          },
        }, toast.text)
        : null

      return h('div', {
        className: 'sc-root',
        style: { position: 'relative', width: '100%', height: '100%', background: 'var(--sc-bg)' },
      },
        h('div', { style: { display: 'flex', height: '100%', overflow: 'hidden' } },
          side,
          h('section', {
            style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
          }, tabs, pane, headBar),
        ),
        modalEl,
        supportEl,
        backupEl,
        docEl,
        dayFormEl,
        modelEl,
        askEl,
        transEl,
        genEl,
        paperEl,
        gradeEl,
        previewEl,
        importEl,
        toastEl,
      )
    }

    /* ----------------------------------------------------------- apply */
    function apply(ctx) {
      const disposers = []
      try {
        ensureStyle()
        const slots = ctx.slots
        if (!slots) return

        disposers.push(
          slots.inject('sidebar.panellist', () =>
            slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: PANEL_ORDER,
                label: () => '学习资源库',
              },
              StudyIcon,
            ),
          ),
        )
        disposers.push(
          slots.inject('main', () =>
            slots.register(
              { name: 'main', key: PANEL_ID, inject: () => ({}) },
              StudyLibraryPanel,
            ),
          ),
        )
      } catch (e) {
        try {
          console.warn('[study-coach] panel registration failed:', e && e.message)
        } catch {}
      }

      ctx.effect(
        () => () => {
          for (const d of disposers.splice(0)) {
            try { d() } catch {}
          }
        },
        'study-coach: library panel',
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

