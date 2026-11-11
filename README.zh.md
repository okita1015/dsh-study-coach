# dsh-study-coach 学习资源库

[![test](https://github.com/okita1015/dsh-study-coach/actions/workflows/test.yml/badge.svg)](https://github.com/okita1015/dsh-study-coach/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-3c873a.svg)](https://nodejs.org)

**把一整个学期的讲义，变成能复习的东西。**

PDF / PPT 丢进科目文件夹，拿回来的是：

- **笔记** —— 每个知识点中文讲解，英文术语并排写在旁边，考前对着英文卷不慌
- **练习卷** —— 照你校内真卷的版式、每题分值、题型措辞出，只换题目内容
- **错题本** —— 按遗忘曲线算好明天该复习哪几个，不靠感觉

**全部跑在 DSH 里面**：没有独立进程、不占端口、也不用 iframe。

> English docs: [README.md](./README.md)

---

## 看一眼

```
┌ 学习资源库 ────────────────────── [📄 总结] [⚡ 速记] [🌗] ┐
├──────────┬────────────────────────────────────────────────┤
│ 科目      │  [📁 资料] [📝 笔记 33] [❓ 题目 32]            │
│          │                                                │
│ COMP2011  │  📖 讲义 10  ✏️ 作业 6  📝 试卷 4  📎 参考 1     │
│ 33 · 32  │  ┌──────────────────────────────────┐          │
│          │  │  📥 把文件拖到这里 → 存进「讲义」  │          │
│ + 新科目  │  └──────────────────────────────────┘          │
│          │  📕 📊 📊 📕 📊    ← 点 × 删除                │
└──────────┴────────────────────────────────────────────────┘
```

---

## 功能

**资料管理**
- 按科目分文件夹，四个分区：**讲义 / 作业 / 试卷 / 参考**
- **整个内容区都能拖**，支持多选，自动落到当前选中的分区
- 分区会探测多种目录结构，已有的 `0_课程材料/Tutorial` 直接就能用
- 一键删除；`/api/study-coach/file` 直接打开（PDF/图片内嵌）

**笔记与题目**
- 笔记按讲义分组，每条带掌握度进度条
- 题目每题「做题」→ 看答案 → **我会了 / 不会**，直接写回掌握度
- 天生双语：知识点可同时带 `title` 和 `titleEn`

**文档生成**
- **总结**：总览表、掌握度分布、按章节明细、最该补的、今日计划
- **速记卡**：每条知识点一行，中英并排，一页纸能看完
- 导出 Markdown：**复制 / 下载 / 存进科目** 三个出口
- 预览里能切语言：中英对照 / 纯中文 / English only

**间隔重复**
- 答对 **+15%**，答错 **−25%**
- 下次复习按掌握度取 1 / 2 / 4 / 7 / 15 / 30 天
- `study_plan` 把「该复习」和「还没学过」分开排

**主题**
- 颜色全走 CSS 变量，组件里没有硬编码色值
- 默认跟随系统 `prefers-color-scheme`，也能手动切浅色/深色，记在 `localStorage`
- DSH 亮色、暗色外壳都正常

---

## 安装

**依赖**：DSH 2.x（自带 Node ≥ 22）；Python 3.10+，并且装了 `pymupdf` / `python-docx` / `python-pptx`。
DSH 自带的 Python 运行时里这三个库都有，不用自己装；只有你手动指定了系统 Python 时才需要
`python -m pip install pymupdf python-docx python-pptx`。

**一条命令** —— 安装器会替你改 profile、建好链接（改之前先备份 `package.json`，重复跑也安全）：

```bash
git clone https://github.com/okita1015/dsh-study-coach.git
cd dsh-study-coach
node install.mjs
```

**没装 git？下载 zip，双击就行：**

1. https://github.com/okita1015/dsh-study-coach/archive/refs/heads/main.zip
2. 解压到任意地方
3. Windows → 双击 **`install.cmd`** · macOS/Linux → `./install.sh`
4. 重启 DSH

多个 profile？`node install.mjs --profile desktop`。只想看会改什么？加 `--dry-run`。

装完先跑一次自检，它会告诉你这台机器缺什么：

```bash
cd ~/dsh-study-coach && node doctor.mjs
```

重启 DSH，侧边栏出现 **📚 学习资源库**。

> **不要**再往 profile 的 `cordis.patch.yml` 里加一遍 —— 包自带 patch 层，写两次会报 `duplicate loader entry id`。

## 配置

| 环境变量 | 默认 | 含义 |
| --- | --- | --- |
| `DSH_STUDY_WORKSPACE` | 自动探测（Windows 有 `C:\Workspace` 就先用它，否则 `~/Workspace` → `~/Documents/Workspace`） | 科目文件夹的根目录 |

分区目录探测顺序（第一个存在的用，都不存在就建第一个）：

| 分区 | 候选 |
| --- | --- |
| 讲义 | `0_课程材料/讲义`、`讲义`、`lectures` |
| 作业 | `0_课程材料/Tutorial`、`0_课程材料/作业`、`Tutorial`、`作业` |
| 试卷 | `0_课程材料/试卷`、`试卷`、`exams` |
| 参考 | `4_其他`、`参考`、`reference` |

数据在 `$DSH_HOME/study/`：

```
study/
├── subjects.json            科目清单
└── COMP2011/
    ├── topics.json          知识点 + 掌握度 + 下次到期
    ├── cards.json           题卡
    ├── attempts.jsonl       答题流水（只追加）
    ├── schedule.json        每科独立的考试/作业日历
    └── generated.json       原件 / DSH 生成物清单
```

---

## 给 AI 用的工具

| 工具 | 作用 |
| --- | --- |
| `study_library` | 列出科目、各分区文件、笔记/题数 |
| `study_subjects` | 同上，外加工作区里没登记的目录 |
| `study_add` | 登记/更新科目 |
| `study_topics` | 查看/写入知识点（幂等） |
| `study_cards` | 查看/写入题卡（幂等） |
| `study_plan` | 今天复习什么，分「该复习」「没学过」 |
| `study_drill` | 按弱项加权抽题 |
| `study_check` | 记一次对错，更新掌握度和下次到期 |
| `study_stats` | 掌握度报表 |

典型闭环：**你拖文件 → AI 调 `study_library` 看到 → 读文件 → 写 `study_topics` + `study_cards` → 面板里就有笔记和题目。**

## HTTP 路由

全部在 `/api/study-coach/` 下，通过 `ctx.webServer` 挂载：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `config` | 分区定义 + 生成物命名特征 + 翻译方向 |
| GET | `tree` | 科目 → 分区 → 文件 |
| GET | `state` | 掌握度、计划、笔记、题目 |
| POST | `upload` | multipart：`code`、`section`、`files` |
| POST | `delete` | 删文件（限工作区，越界 403） |
| POST | `subject` | 新建/更新科目（会顺手建四个分区目录） |
| POST | `drill` | 抽题 |
| POST | `check` | 记对错 |
| GET | `file` | 读文件（PDF/图片内嵌） |
| GET | `cards.csv` | 题卡导出成 CSV（带 BOM，Excel / Anki 都能用） |
| GET | `asset` | 插件自带的图片，如 `?name=payme.png`（只读白名单） |
| GET | `backup` | 一个 JSON，装下所有科目的进度和偏好 |
| POST | `restore` | 把备份写回去（写前先给当前文件留快照） |
| POST | `export` | 生成总结 / 速记 Markdown |
| POST | `mark` | 标某个文件是原件还是 DSH 生成 |
| POST | `translate` | 补齐中英对照（`dryRun` 只数数量） |
| POST | `generated/backfill` | 给历史文件补记来源清单 |

客户端用**相对路径** `api/study-coach/...`（DSH 有 `<base href="./">`，绝对路径在多级部署下会打空），404 时自动回退绝对路径。

---

## 踩过的坑（写插件的人都该知道）

1. **`jsx(type, props, key)`** —— 第三个参数是 key，不是 children。这里统一用 `react.createElement` 避免歧义。
2. **侧边栏图标必须是 `<svg>`**，宿主会传 `size`；塞 emoji 到 `<span>` 里什么都不显示。
3. **`slots.inject(name, cb)`** 只在宿主真的声明了那个座位时才跑 `cb`。宿主没有 → 面板不出现，启动正常。外面再包 `try/catch`。
4. **工具 JSON schema 里每个 `object` 都必须写 `additionalProperties: true|false`**，否则 DSH 在 `apply()` 里抛 `JsonSchemaError`，整个插件加载失败——连路由都挂不上。
5. **用假 ctx 测试会掩盖 schema 错误**，发布前必须用真的 `@deepseek-ai/dsh-tools` 跑一遍 `apply()`。

## 开发

```bash
node test.mjs                    # 核心逻辑，24 条断言，用临时 DSH_HOME
node study-reset.mjs COMP2011     # 清掌握度，保留知识点和题卡
```

## 许可

MIT

## 每科独立的日程日历

每个科目一份日历，互不干扰。

- 月历网格，有事的日期显示彩色圆点，今天带描边
- **点任意一天**就能加事件：**考试 / 小测 / 作业截止 / 上课 / 其他**，可以填时间和备注
- 下面是全部日程列表，过去的事件自动变淡，一键删除
- **导出 .ics** → 标准 iCalendar，自带提前 1 天的 VALARM 提醒，
  导进 Google 日历 / Outlook / 苹果日历 / 手机日历，提醒就设好了

存在 `$DSH_HOME/study/<CODE>/schedule.json`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `schedule?code=` | 事件列表 + 可选类型 |
| POST | `schedule` | 新建/更新一条 |
| POST | `schedule/delete` | 删一条 |
| GET | `schedule/ics?code=` | 下载 `.ics` |

## 面板里直接问 AI

顶栏 **问** 打开侧边抽屉。问题走 DSH 自己的模型服务
（`ctx.llm.listProviders` → `listModels` → `prepareCall` → `BlockAssembler`），
**不用填 API key，也不用另起进程**。

每次提问会把这个科目的知识点和掌握度当上下文一起发过去，所以「这章」「那个公式」它知道你在说什么。

**优雅降级**：宿主没暴露 `llm` 服务时，抽屉直接说明原因，不会卡住、不会白屏、不会搞崩面板。

> SDK（`@deepseek-ai/dsh-llm`）是从 DSH **安装根目录**解析的 —— 用 junction 装进来的插件
> 靠常规 node 解析够不到 `Program Files`。要嵌到别处请设 `DSH_INSTALL_DIR`。

## 导入整个文件夹

侧栏「+ 新科目」下面多了 **📂 导入文件夹**：

1. 弹系统目录选择器（`webkitdirectory`）
2. 读完文件夹里所有文件，**按路径和文件名猜分区**
   （`lecture|讲义|lec N` → 讲义，`tutorial|作业|hw` → 作业，
   `exam|试卷|past paper` → 试卷，其余 → 参考）
3. 弹确认框：显示分组结果，每组带下拉可以改投别的分区；
   科目代码自动从文件夹名里抠（`COMP2011` 这种）
4. 每 20 个一批上传，顺手把科目和四个分区目录建好

**丢一个文件夹进去，出来一个整理好的科目。**

## 客户端 bundle 的坑（面板一直不出现就看这段）

只写 `dsh.client.platform: "web"` **不够** —— 只要你客户端代码用了 `ctx.slots`，
就必须声明你依赖哪些 client 服务：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-ui-slots"]
  }
}
```

不写 `inject` 的话：bundle 照样加载，但拿不到 `slots` 服务，`apply()` 直接
`return`，面板**静悄悄不注册，任何日志里都没有报错**。

我是对比 `@goodandready/dsh-vision-bridge` 和
`@linxin666/dsh-client-ui-skill-explorer` 的 package.json 才发现的。

## 分区语义（重要）

导入时的自动分区按这个来，规则顺序就是优先级：

| 顺序 | 分区 | 放什么 |
| --- | --- | --- |
| 0 | **参考** | **自制资料**：完整笔记、复习笔记、考前冲刺、速查卡、知识点清单、中英对照 |
| 1 | 试卷 | 真题、模拟卷、Practice Paper、答案卡、midterm / final / quiz |
| 2 | 作业 | Tutorial、Lab、Assignment、exercise、实验 |
| 3 | 讲义 | **只放老师发的原件**：`Lec N`、`Chapter N`、`ch N`、课件、slides |
| 4 | 参考 | 工具、清单、大纲、readme |

**为什么讲义排得这么后**：讲义分区应该只有从 Moodle 下载回来的原始课件。
如果把「01-完整笔记」「13-考前复习笔记-Ch1-5」这类自己整理的东西也判进去，
讲义分区就被生成物淹没了，原件反而找不到。

所以规则第一条就是「认出自制资料，直接丢参考」，而且它排在 chapter/章节号判断之前 ——
否则「考前复习笔记-Ch1-5」会因为含 `Ch1` 被误判成讲义。

验证过的 18 个真实文件名全部落对分区。

## 原件和生成物的分隔

同一个分区里如果既有老师发的原件、又有 DSH 这边整理出来的东西，
文件列表会自动**分成两段，中间画一条线**：

```
┌──────────┬──────────┬──────────┐
│ 📕 原件A  │ 📊 原件B  │ 📄 原件C  │
└──────────┴──────────┴──────────┘
─────────── DSH 生成 28 ───────────
┌──────────┬──────────┬──────────┐
│AI 📄笔记  │AI 📃速查  │AI 📕冲刺包│
└──────────┴──────────┴──────────┘
```

- 生成物左上角有 `AI` 角标，一眼分得清
- 判断依据是**命名约定**（`完整笔记 / 复习笔记 / 冲刺 / 速查 / 知识点清单 /
  中英对照 / 总结 / 提纲 / 错题本 / 逐题精讲 / 答案卡 / 精讲 / 刷题`），
  没用元数据 —— 因为这些文件本身就是按这套命名产出的
- 一个分区里如果只有一类，就不画线

服务端 `listFiles()` 会给每个文件打上 `origin: 'generated' | 'source'`，
客户端只负责按这个分两段渲染。

## 来源判定的三个层次（v0.7）

命名约定只是兜底，真正的判据是**科目清单**：

```
<DSH_HOME>/study/<CODE>/generated.json
{
  "files":    { "<绝对路径>": { "at": "...", "by": "user|backfill" } },   ← 一定算生成物
  "unmarked": { "<绝对路径>": { "at": "...", "by": "user" } }            ← 一定算原件
}
```

判定顺序：

| 顺序 | 依据 | 说明 |
| --- | --- | --- |
| 1 | `files` 命中 | 算 DSH 生成（`originBy: manifest`） |
| 2 | `unmarked` 命中 | 算原件（`originBy: manual`），用来纠正命名误判 |
| 3 | 命名命中 `GENERATED_RE` | 猜一把（`originBy: name`） |
| 4 | 都不命中 | 原件（`originBy: default`） |

**为什么要有清单**：靠命名总有判错的一天 —— 老师真发了个「总结.pdf」就会被当成 AI 的。
现在每个文件卡片右下角有个 `⇄` 按钮，点一下就在「原件 / DSH 生成」之间切，改完写进清单，下次刷新照样生效。

历史文件一次性补票：

```bash
node mark-generated.mjs          # 预演，只告诉你会标哪些
node mark-generated.mjs --apply  # 真写
```

也可以直接调接口 `POST /api/study-coach/generated/backfill {code}`，或者点分区栏右边的 **🔁 补记来源**。

## 中英对照：一键补齐（v0.7）

顶栏 **🌐 翻译** 打开抽屉：

- 选方向：**中 → 英** / **英 → 中**
- 勾 **连已有的也重译一遍**，会把已经有译文的一起覆盖
- 点「开始翻译」，走 DSH 自己的模型服务，结果**直接写回 `topics.json`**

写回以后，笔记、总结、速记卡立刻都是中英对照的，不用再手工整理。

```bash
# 命令行 / AI 也能用
study_translate { code: "COMP2011", target: "en", dryRun: true }   # 先看缺多少
study_translate { code: "COMP2011", target: "en" }                 # 真翻
```

实现上有两个细节值得记：

1. **分批**：一次 12 条。长科目一次全塞会把上下文顶爆，分批也能只重试失败的那一块。
2. **脏输出兜底**：模型爱包 ` ```json `、爱加解释、偶尔漏尾逗号。`parsePairs()` 先按 JSON 解析，
   再逐行用 `key: value` / `key = value` 兜底，并且按去掉空白后的原文对齐 —— 模型把简繁改掉也能对上。

没模型服务（纯命令行环境）时会明确告诉你翻不了，不会白等。

## 「其他目录」兜底分区（v0.7）

四个固定分区（讲义 / 作业 / 试卷 / 参考）只认固定目录名。
可实际用起来，自己建的文件夹恰恰放的是最要紧的东西：

```
COMP2011/
├── 0_课程材料/           ← 讲义 10 / 作业 6 / 试卷 4
├── 1_复习资料/   12 个   ← 以前面板上根本看不见
├── 2_图解笔记/    1 个
└── 3_练习题/     12 个   ← 以前面板上根本看不见
```

现在多了一个动态分区 **其他目录**：

- 扫科目根，把**没被四个固定分区收走的文件**全列出来，带相对路径（`3_练习题/Paper1.docx`）
- 自动跳过 `_build` / `.git` 这类 `_` `.` 开头的目录（那些不是学习资料）
- 同一份文件不会在两个分区里重复出现
- 这个分区是**只读浏览**的：拖文件进去会落到「参考」，免得散进科目根

分区栏只在这个分区真的有文件时才显示，不会有空的按钮一直挂着。

## 给 AI 用的工具（v0.7 新增）

| 工具 | 作用 |
| --- | --- |
| `study_translate` | 补齐知识点缺的那一边语言（`dryRun` 先看数量） |
| `study_mark` | 把某个文件标成「DSH 生成」或「原件」，覆盖命名判定 |

## 自测

```bash
node test.mjs           # 核心逻辑：64 条断言（含清单判定 / 翻译落库 / 脏 JSON 解析 / 其他目录）
node test-render.mjs    # 用真的有 react 跑 15 个渲染分支，抓运行时异常
node check-tools.mjs    # 用真的 @deepseek-ai/dsh-tools 跑 apply()，校验 11 个工具 schema
```

`check-tools.mjs` 别省 —— 工具 schema 漏一个 `additionalProperties`，DSH 会在 `apply()` 里直接抛错，
**整个插件加载失败，连 HTTP 路由都挂不上**，而界面上只看得到「正在加载资源库」。假 ctx 测不出来。


## 一键生成：讲义 → 笔记 / 总结 / 速记 / Word / PPT（v0.8）

顶栏 **🪄 一键生成**。选讲义、勾产出、点开始，剩下的它跑：

```
讲义 PDF / PPTX / DOCX
   │ ① 抽文本     PyMuPDF / python-docx / python-pptx（DSH 自带运行时里就有）
   ▼
纯文本
   │ ② 提炼      每份讲义单独问一次模型，要结构化 JSON：
   │             topics[{lecture,title,titleEn,summary,points}]
   │             cards[{topic,question,answer,marks}]
   │             note（这一节的 Markdown）
   ▼
topics.json / cards.json（幂等：重复跑不会翻倍）
   │ ③ 出文档
   ▼
1_复习资料/
  ├── COMP2011_Lec6-9_自动笔记.docx / .pdf
  ├── COMP2011_Lec6-9_总结.docx / .pdf
  ├── COMP2011_Lec6-9_速记卡.docx / .pdf
  └── COMP2011_Lec6-9_讲义.pptx
```

产出会自动写进科目的生成物清单，所以面板里跟讲义原件是**分开两段**显示的。

**Markdown 不落在资料库**：正文只是排版的原料，写在 `~/.dsh/study/<CODE>/.build/`。
笔记页读的是资料库，所以「📝 笔记」这个勾一定会连带把 Word 排出来 ——
只勾「笔记」、把 Word 取消，也不会变成「跑完了什么都没有」。
万一 Word 那步真的挂了，正文会被复制一份 `.md` 进资料库兜底，笔记页照样能读。

### 为什么每一步都单独设计

| 决定 | 原因 |
| --- | --- |
| **每份讲义单独提炼**，不合并 | 十份课件塞一个 prompt，模型只会回一份泛泛的大纲。一份一次，知识点才具体 |
| **要结构化 JSON**，不要自由 Markdown | 自由文本没法写进 topics.json，也就刷不了题、算不了掌握度 |
| **文本缓存**（`study/<CODE>/extract/<sha1>.json`） | 抽一份 PDF 几秒，但可能反复出文档。缓存键 = 路径 + 大小 + mtime，文件一改自动失效 |
| **异步 job + 轮询** | 抽文本 + 提炼一份十几秒，整条链几分钟。HTTP 挂着会超时，所以 `start` 立刻返回 `jobId` |
| **每步都能失败** | 抽不出字的 PDF 跳过并告诉你；模型翻车保留已完成的部分；Word 挂了至少 .md 还在 |

### 模型调用要点

- 强制 JSON，`parseModelJson()` 容错包 ` ``` `、多余解释、尾逗号
- 每个文件正文掐到 18000 字（课件再长只会拖慢，还容易丢结构）
- 题卡要挂到知识点上：先按 `title` 精确匹配，找不到再做一次包含匹配，挂不上就丢掉并在日志里说数量

### Python 依赖从哪来

插件**不要求你 pip install 任何东西**。DSH 自带运行时里已经有：

```
$DSH_HOME/dsh-runtimes/<任意版本>/dependencies/python/python.exe
  ├── pymupdf      PDF 抽文本
  ├── python-docx  .docx 读写
  └── python-pptx  .pptx 生成
```

定位顺序：`DSH_STUDY_PYTHON` → dsh-runtimes 通配 → PATH 里的 `python`。
一个都找不到时，面板会明说「抽不了文本」，不会假装在跑。

自己另装了 Python 也行，把路径给 `DSH_STUDY_PYTHON` 就好。

### 只重排文档

知识点已经在库里、只想换个排版：点抽屉里的 **只重排文档**（`POST /pipeline/render`），
不调模型，几秒钟用现有的 topics 出 Word / PPT。

### 工具

```bash
study_generate { code: "COMP2011" }                       # 全自动：讲义分区里所有能抽的文件
study_generate { code: "COMP2011", files: [...] }          # 指定讲义
study_generate { code: "COMP2011", want: { pptx: false } } # 不要 PPT
```

默认 `wait: true`，等它跑完再回结果（最多 5 分钟）；`wait: false` 只启动，之后用面板或轮询看进度。

## 踩过的坑（v0.8 补第 6 条，这条能让 DSH 直接崩）

### 6. `ctx.llm` 没在 `inject` 里声明，读一下就把 host 干掉

```js
export const inject = ['tools', 'webServer']

export function apply(ctx) {
  const llm = ctx.llm        // 💥 throw: cannot get property "llm" without inject
}
```

cordis 的 Context 是 Proxy —— **没在 `inject` 里声明的服务，读一次就抛**。
抛在 HTTP handler 里还算走运（被 try/catch 接住，接口 500）；抛在后台任务里就是
**unhandled rejection → host fatal → 整个 DSH 退出**。日志长这样：

```
Host fatal error: dsh: fatal load failure: Error: cannot get property "llm" without inject
    at runModel (…/dsh-study-coach/lib/routes.js:455:18)
    at refineOne (…/pipeline.js:134:23)
```

**修法有二，别混**：

| 需求 | 做法 |
| --- | --- |
| llm 是**硬依赖**（没模型就用不了） | `export const inject = ['tools','webServer','llm']`，宿主没有 llm 时插件不激活 |
| llm 是**软依赖**（没模型也要能开面板） | `ctx.inject(['llm'], (c) => { … c.llm … })` 拿一个合法子 ctx |

这个插件走第二条，因为纯命令行环境没有 llm，但资源库面板还有用：

```js
const llmRef = { ctx: null }
Promise.resolve(ctx.inject(['llm'], (c) => {
  llmRef.ctx = c                 // c 是带 llm 的合法 ctx
  return () => { llmRef.ctx = null }
})).catch(() => {})
const getLlm = () => { try { return llmRef.ctx?.llm } catch { return undefined } }
```

再加两条铁律：

1. **`ctx.inject` 的回调参数才是合法 ctx**，外面那个 ctx 读任何未声明的服务都会抛。
2. **后台任务必须接住 rejection**：`runPipeline(...).catch(e => …)`。漏一个 `.catch`，
   一次模型调用失败就能让整个 DSH 退出。

`test.mjs` 的 `[14]` 那一节专门用一个「读什么都抛」的 Proxy ctx 盯这个坑，回归时能立刻抓住。

## 照真卷出练习卷（v0.9）

顶栏 **📝 出练习卷**。这条是主人定的铁律：**版式一比一照校内真卷，只换题目内容**。

### 为什么不能「让模型随便出一份卷子」

你手里有校内真卷（`2024 Final Paper`、`2024 CA Test 1`）。自己发明的版式跟考场对不上：

| 真卷 | 自创卷 |
| --- | --- |
| Section A 8 题 × 5 分，Section B 3 题 × 20 分 | 平均分配，或者一堆 10 分题 |
| 页眉 `Page 1 of 8` + Programme/Year，三栏页脚 | 什么都没有 |
| 题号 `A1`、子题 `(a)(b)(c)` 缩进、`[3 marks]` 右对齐 | 手打编号 |
| 英文卷、Times New Roman、全大写 MODULE TITLE 带字距 | 中文标题、微软雅黑 |

所以流程反过来：**先解析真卷骨架，再按骨架填题**。

### 两步

```
① 分析版式    真卷 PDF/DOCX → 抽文本 → 模型输出骨架
              {封面信息, 每节题数, 每题分值, 说明文字,
               语言, 有没有子题, 出题口吻样本}
              存 $DSH_HOME/study/<CODE>/paper-template.json

② 选定范围    「从 Ch1 到 Ch5」两个下拉（选项来自 topics 的 lecture）
              → 按骨架逐节出题 → 组 JSON → make_paper.py 排 .docx
              → 3_练习题/<CODE>_Ch1-Ch5_练习卷_<日期>.docx
              → 3_练习题/..._答案.docx（含批改参考）
```

### 生成的时候有哪些东西会自动对齐

真卷写「Section A is worth 40 marks」「Each question is worth FIVE marks」「contains EIGHT questions」——
生成卷的题数一变，这些话不改就露馅。所以 `fixInstruction()` / `fixCoverInstructions()` 会按实际改：

```
真卷（模板）：  This section contains EIGHT questions. / worth FIVE marks.
生成卷（2 题）：This section contains TWO questions.  / worth FIVE marks.
```
单复数也管（`ONE question`，不是 `ONE questions`）。分值是**题目实际分值之和**，不是照抄计划值。

### 版式缓存可以手改

`paper-template.json` 是明文 JSON。模型解析得不对（比如把两节看成一节），直接改这个文件就行，
不用重新分析。里面的 `samples` 是**出题口吻样本** —— 想让卷子更像某一年，往这里塞那道真题的题干。

### 工具

```bash
study_paper { code: "COMP2011", analyze: true, template: "<真卷路径>" }   # 只解析版式
study_paper { code: "COMP2011", from: 1, to: 5 }                          # 出 Ch1-5 的卷
study_paper { code: "COMP2011", from: 6, to: 10, answers: true }          # 出 Ch6-10 + 答案
```

### 路由

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `paper/template?code=` | 读已缓存的版式骨架 |
| POST | `paper/analyze` | `{code, file}` 解析真卷（要一次模型调用） |
| GET | `paper/scope?code=` | 可选章节 + 试卷分区里能当模板的卷子 |
| POST | `paper/generate` | `{code, from, to, answers}` → 异步 job，用 `pipeline/status` 查 |

### 7. 只取 `providers[0]` 调模型 —— 明明有十个通道却说没模型

```js
const provider = providers[0].id            // deepseek-official（账号掉线、拉不到模型）
const models = await llm.listModels(provider)
if (!models.length) return { error: 'no-model' }   // 全体功能挂掉，其他通道明明活着
```

插件里做「翻译 / 一键生成 / 出练习卷」，一调模型就 503，面板只显示 `解析失败 HTTP 503`。
真相是：`listProviders()` 排第一的那个是**掉线的官方账号**，返回 0 个模型；而
`llm-deepseek-account` 和免费通道那 10 个 provider 都是好的。

两处都要改：

1. **遍历所有 provider**，找第一个真有模型的；再挑一个非 reasoning 的模型。
2. **客户端把服务端的 `error` / `detail` 带出来** —— 只抛「HTTP 503」等于让人瞎猜。

还支持 `DSH_STUDY_MODEL=provider/model` 手动钉死，调试时不用改代码。

`/health` 现在会列每个 provider 有几个模型、选中哪个，一眼看出哪个通道活着。

## 试卷页：一屏一题，直接在空白上写（v0.18 ~ v0.21）

试卷和笔记是两件事：笔记要满屏字读，试卷要一块空白做。所以顶栏多了一个 **📄 试卷**。

**一屏一题**

服务端 `flattenPaper()` 把卷子摊平成「一题一条」（`no / section / stem / parts / table /
figure / marks / answer`），面板一次只显示一题，底部 `◀ 上一题` / `下一题 ▶` 翻页。

**鼠标 / 触屏直接在留白上写**

`<canvas>` + Pointer Events，`touchAction:none`，`setPointerCapture` 保证笔尖拖出画布再拖回来不断。
四种笔色、三档粗细、橡皮、撤销、清空。

两个实现要点（改之前先读）：

- **笔迹不进 `useState`**：每画一笔都 setState 会让整页重渲染几十次，手感立刻变拖。
  笔画存在 `useRef` 的 `inkStore` 里，`pointermove` 只增量画最后两个点之间那一小段。
- **尺寸会变**（点「大板」、答案展开、窗口变化）→ 位图被重置 → 笔迹消失。
  所以 `repaintInk()` 按 `devicePixelRatio` 重设位图并整张重画，用 `ResizeObserver` 盯住画板本身
  （`window.resize` 不知道「只是这块板变高了」）。

**橡皮**用 `globalCompositeOperation='destination-out'`，擦完是真的透明，不会拿白漆盖一层。
笔迹按 `"卷子路径::A3"` 存 —— 每份卷子的题号都长一个样，不隔离换卷子会串。

## 题目自带的图（v0.19 ~ v0.21）

「下图是一个加权图…」这类题，光有文字是没法做的。模型画不出图，但它说得出图长什么样，
所以让它给**结构化数据**，两边各自照着画：

```json
"figure": {
  "kind": "graph",
  "directed": false,
  "nodes": ["A","B","C","D","E"],
  "edges": [["A","B",4],["A","C",2],["B","C",1]]
}
```

| 画在哪 | 怎么画 |
|---|---|
| 面板（试卷页） | `lib/client.js` 的 `paperFigureSvg()` → SVG，顶点按圆周摆、权重标在边中点 |
| Word（导出的卷子） | `scripts/_figure.py` → PIL 画 PNG（4 倍超采样再缩，边缘不狗牙）插进 docx |

**两边的布局规则必须一致**：`LOGIC_W/LOGIC_H/EDGE_R` 在两边都写了一份，改一处记得改另一处。

`normalizeFigure()`（`lib/paper.js`）负责收拾模型的各种偷懒写法：`nodes` 写字符串还是对象、
`edges` 写数组还是 `{from,to,weight}`、权重叫 `w` 还是 `weight` 还是没给、`directed` 漏了。
**引用了不存在的顶点、自环、认不出来的结构一律丢掉** —— 画一张和题干数字对不上的图，
比不画糟糕得多。

figure 表达不了的东西（老师手绘图、电路照片、讲义截图）用题目右上角的 **🖼 配图** 手动挂，
存在 `study/<科目>/paper-images.json`，键是 `"<卷子文件名>::A3"`。

> 图片走 `GET raw?path=` 直出字节 —— `preview` 是把内容包成 JSON 给面板的，当 `<img src>` 使不了。

## 别人的科目怎么办：从原始资料里抽图（v0.22）

`figure` 只能表达「顶点 + 边」，那是离散数学的形状。**别人考的是电路图、化学结构、
组织切片、地图、财务报表截图** —— 模型一个字都描述不出来。

但这些图本来就在老师发的 PDF / PPTX / DOCX 里。

`scripts/extract_images.py`：

| 来源 | 怎么抽 |
| --- | --- |
| PDF | PyMuPDF 逐页取嵌入位图，**按内容 md5 去重**（页眉 logo / 水印每页都一样，不去重会抽出 N 份同一张） |
| PPTX / DOCX / XLSX | 都是 zip，直接读 `ppt/media/` `word/media/` `xl/media/` |
| 其他 | 说明抽不了，不影响别的 |

- 小于 48px 的丢掉（项目符号、图标、分隔线）
- `emf` / `wmf` 跳过（浏览器不认）
- 落到 `~/.dsh/study/<科目>/figures/`
- **文件名里的括号会被替换掉** —— 这个文件路径要被写进 Markdown 的 `![说明](路径)`，
  路径里带 `)` 会把语法截断，笔记里的图就插不进 Word 了

面板里：试卷页 → 题目右上角 **🖼 配图** → 「📥 从讲义 / 真卷里抽图」选一份 → 抽出来的图
直接列在下面，点一下就挂到这一题上。

## 笔记里配讲义原图（v0.22）

笔记模式跑完，每份讲义会顺手抽一遍图，`composeNote()` 在那一章末尾插：

```markdown
#### 这一章的图（来自讲义）

![](/home/you/.dsh/study/ITP3902/figures/Lec 5 - Graph 1-image1.png)
```

一章最多 6 张（别把笔记撑成相册）。`make_docx.py` 认 `![说明](路径)` 这种行，
按 14.5cm 宽居中插入，`说明` 有内容就排成灰色斜体图注。

抽图失败不影响笔记正文 —— 有些讲义就是纯文字，或者图是矢量画的抽不出来。

## 面板里直接看文件（v0.9.3）

以前文件卡上的「打开」是 `<a target="_blank">` —— **Electron 里打不开新窗口**，点了像没反应，
看起来就是「文件打不开」。现在改成面板内预览：

| 类型 | 怎么显示 |
| --- | --- |
| PDF | `<iframe>` 直接内嵌，滚动就能翻页（走 `/api/study-coach/file`，inline） |
| 图片 | 内嵌显示，宽屏自适应 |
| docx / pptx / xlsx / txt / md | 服务端 `scripts/extract.py` 抽成纯文本，面板里滚动阅读 |
| zip / 其它二进制 | 说明这个类型看不了，引导点「另存」 |

点任意文件卡就打开，右上角：

- **另存** —— 下载到本机用 Word / PowerPoint 打开
- **关闭** —— 或者点遮罩空白处

预览接口：

```bash
GET /api/study-coach/preview?code=COMP2011&path=<文件绝对路径>
→ { ok, name, ext, sizeText, kind: 'pdf'|'image'|'text'|'binary', text, chars, note }
```

抽文本有缓存（`study/<CODE>/extract/<sha1>.json`），同一个文件第二次点开是瞬时的。

### 又一个会让 Word 判「文件已损坏」的坑

```python
settings = doc.settings.element
settings.append(OxmlElement('w:updateFields'))   # ❌ 位置错，Word 打开会报损坏
```

`w:updateFields` 在 `w:settings` 里**位置是固定的**（必须排在 `w:compat` / `w:rsids` /
`w:themeFontLang` 之前）。随手 append 到末尾就是违反 OOXML schema。

正确做法：**别碰 settings.xml**，给要重算的那个域打 `w:dirty="true"`：

```python
fld = OxmlElement('w:fldSimple')
fld.set(qn('w:instr'), 'PAGE')
fld.set(qn('w:dirty'), 'true')     # ✅ Word 打开时自己重算这一个域
```

`w:pBdr`（段落下边框）在 `w:pPr` 里同样有位置要求，必须排在 `w:spacing` / `w:ind` / `w:jc`
之前 —— python-docx 的 `paragraph_format` 会自己按序插入，但手工 `append` 就会错位。

验证手段：机器上装了 Office 的话，用 COM 真开一次最实在：

```powershell
$w = New-Object -ComObject Word.Application
$w.DisplayAlerts = 0
$d = $w.Documents.Open($path, $false, $true)   # 损坏文件在这里就会抛
$d.ComputeStatistics(2)                        # 页数
$d.Close($false); $w.Quit()
```

把上面几行存成 `docx-open-check.ps1` 就能单独验一份 docx 打得开。

## 环境要求与跨平台（v0.9.4）

Windows / macOS / Linux 都能跑，除了 DSH 自带的东西不需要额外装。

```bash
node doctor.mjs      # 一条命令告诉你哪些功能能用、缺什么
```

| 项目 | 怎么找 |
| --- | --- |
| **工作区** | `DSH_STUDY_WORKSPACE` → `C:\Workspace`（Windows 且存在）→ `~/Workspace` → `~/Documents/Workspace` |
| **DSH 运行时** | `DSH_INSTALL_DIR` → Electron 的 `process.resourcesPath` → 从 `process.execPath` 推（Win/Linux 在 `<dir>/resources/app`，macOS 在 `<App>.app/Contents/Resources/app`）→ 各平台默认安装位置 |
| **Python** | `DSH_STUDY_PYTHON` → `$DSH_HOME/dsh-runtimes/*/dependencies/python`（Windows `python.exe`，POSIX `bin/python3`）→ PATH 里的 `python`/`python3`。**所有候选都探一遍，库最全的赢** —— 系统里裸装的 Python 不会顶掉 DSH 运行时那个 |
| **字体** | `scripts/_fonts.py` 按平台给：Windows 微软雅黑/Consolas，macOS 苹方/Menlo，Linux Noto CJK/DejaVu |

### 环境变量

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `DSH_STUDY_WORKSPACE` | 自动探测 | 科目文件夹放哪儿 |
| `DSH_STUDY_PYTHON` | 自动探测 | 抽 PDF / 写 Word / 写 PPT 用哪个解释器 |
| `DSH_INSTALL_DIR` | 自动探测 | DSH 安装根目录（探测失败时手动指） |
| `DSH_STUDY_MODEL` | — | 钉死通道：`provider/model` |
| `DSH_STUDY_PROVIDER` | — | 优先通道，逗号分隔 |

### 测试

```bash
node test.mjs           # 224 条断言，纯逻辑 —— CI 能跑，不需要 DSH 和 Python
node test-render.mjs    # 35 个渲染分支，过真实 react（需要 DSH 安装）
node check-tools.mjs    # 用真的 @deepseek-ai/dsh-tools 校验 14 个工具 schema
node doctor.mjs         # 环境自检
node audit.mjs          # 跨平台审计：写死路径 / 平台专属命令
```

CI（`.github/workflows/test.yml`）在 **ubuntu / windows / macos × node 22 / 24** 上跑 `test.mjs`，
用一个固定版本的 Python 编译全部脚本，再跑一遍跨平台审计（只当提示：没有 DSH 的 runner 只能查一半）。

---

## 打赏作者

这个插件全部免费、MIT 开源。**没有任何功能锁在付费后面** —— 计划、出卷、刷题，给不给钱都一样。

要是它帮你在考前救回一个晚上，随手请杯奶茶就行，不给也照样用：

<img src="assets/payme-hk.png" alt="香港：AlipayHK / PayMe / FPS" width="180"> <img src="assets/payme.png" alt="内地：微信支付" width="180">

香港同学扫左边（**AlipayHK / PayMe / FPS**），内地同学扫右边（**微信支付**）。
面板里点 **☕** 也是这两张，上面有 🇭🇰 / 🇨🇳 两个切换。
想拿去给自己的班用？把 `assets/payme-hk.png` 和 `assets/payme.png`（600×600）换成你自己的图，
不用改代码；缺哪张面板就把那一栏藏掉，不会显示破图。
