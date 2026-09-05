# @apanoo/dsh-glm-quota

> dsh 插件：会话选中 GLM Coding Plan（zai-coding-cn）模型时，在输入框底部的模型选择器内、当前模型文案左侧显示 5 小时用量剩余百分比。

状态：**设计定稿，未开工**。数据源与通道先例均已实证（见 §1、§3），P0 约半天工作量。

---

## 1. 已验证的数据源事实（2026-09-04 调研，全部本地/源码实证）

### 1.1 配额接口

```
GET {base}/api/monitor/usage/quota/limit
Authorization: Bearer <api_key>
```

- **base 选择规则**（与 provider 名联动，来自 pi-zai-usage / cc-switch）：
  provider 为 `zai-coding-cn` 或名字含 `bigmodel` → `https://open.bigmodel.cn`；否则 `https://api.z.ai`。
  **本机 provider 是 `zai-coding-cn` → base 固定 `open.bigmodel.cn`。**
- 响应 `data.limits[]`，每项含 `type` / `unit` / **`percentage`（已用%，服务端算好）** / `nextResetTime`：

| type | unit | 含义 | 用途 |
| --- | --- | --- | --- |
| `TOKENS_LIMIT` | 3 | **5 小时滚动 token 窗口** | 徽标主显示：剩余% = 100 − percentage |
| `TOKENS_LIMIT` | 6 | 周配额（部分套餐才有） | P2 明细 |
| `TIME_LIMIT` | 5 | 工具/搜索类月度 | P2 明细 |

- 国内站裸 key / Bearer 均接受（实测结论，统一用 Bearer 最通用）。

### 1.2 先例（可信度依据）

- **pi-zai-usage**（npm `pi-zai-usage@0.1.0`，MIT）：同 pi 底座的扩展，源码已读——上述接口、字段、语义全部出自其 `extensions/zai-usage.ts`；其数据又参考 cc-switch 的 coding_plan 实现。社区已验证可用。
- dsh 的 provider 命名空间是 `llm-pi-ai`（同 pi 底座），provider 表里的模型（glm-4.5-air / 4.7 / 5-turbo / 5.1 / 5.2 / 5.3 / 5.3-flash）就是徽标的触发集合。

### 1.3 API Key 的来源（关键，已实证）

- `~/.dsh/settings.yaml`：`llm-pi-ai.providers.zai-coding-cn.apiKeyEnv: ZAI_CODING_CN_API_KEY`
- key 实际存放在 **`~/.dsh/.credentials.yaml`**（已确认文件含该 key 名）。
- **注意**：dsh 的 launchd 服务环境变量里**没有**这个 env（已查 `launchctl print`）——dsh 自己走 `.credentials.yaml` 解析。插件服务端半与 dsh 同进程同权限，**读同一文件**即可；保底再探 `process.env`。
- 红线：**key 永不出服务端**。HTTP 路由只回 `remaining / percentage / nextResetTime / fetchedAt`。

## 2. 功能定义

- 触发条件：会话当前选中模型 ∈ zai-coding-cn 模型表（配置化，默认 `glm-*` 前缀匹配 + 模型 id 精确表双保险）。选其他 provider 模型 → 徽标隐藏。
- 展示位置：输入框底部的**模型选择器内部，当前模型文案左侧**（与模型状态同一语义区域）。
- 展示内容：纯文字百分比 `42%`（不使用圆角背景）；`glm` 使用弱化灰色，百分比按余量着色；颜色阈值 绿 >50 / 黄 20–50 / 红 ≤20 / 灰 = 无数据或 stale；hover title = `GLM 5h 窗口剩余 42% · HH:MM 重置`。
- 双主题适配：亮色直接可用，暗色挂 `body[data-ds-dark-theme]` 覆盖（web-kit 同款约定）。

## 3. 架构

```
┌─ dsh 主进程 ─────────────────────────────┐
│ 插件服务端半 (src/server/index.js)        │
│  · 每 5 min 轮询配额接口                  │
│  · 内存缓存 {percentage,nextResetTime,    │
│    fetchedAt,stale}，失败保留上次值        │
│  · webServer 注册 GET /glm-quota 精确路由  │
│    （fence.js 信任围栏，web-kit 同款）      │
│  · 读 ~/.dsh/.credentials.yaml 取 key     │
└──────────────┬───────────────────────────┘
               │ HTTP（同源 fetch，Caddy 认证 +
               │ fence 双层防御）
┌──────────────┴───────────────────────────┐
│ 插件客户端半 (src/client/index.js)        │
│  · 徽标注入：定位模型选择器 → 模型文案左侧 │
│  · 刷新：模型选择器出现时拉一次；期间      │
│    60s 轮询；失败显示上次值/灰态           │
│  · 当前模型判定 → 决定显示/隐藏            │
└──────────────────────────────────────────┘
```

> **决策记录**：原设计用 `connection.rpc`/channel（plugin-manager 先例），实现时改为
> webServer 精确路由——web-kit 已验证同款（openpath/dock 走 /web-kit），安全模型一致
> （Caddy basic_auth + fence.js 纵深防御），少一层 rpc API 依赖。

### 3.1 为什么挂在模型选择器而不是 tab 行

用量信息描述的是当前模型，不是页面导航状态。输入框底部的模型选择器是最合适的语义容器：

```text
[工具]        3%   GLM-5.3-Flash⌄                    [发送]
```

这样可以避开右上角下载按钮，也不会让 tab 行右侧出现孤立的第二个控件。徽标不是新 tab，
也不改变模型选择器按钮的点击行为，只作为按钮内部的 `pointer-events:none` 元信息。

### 3.2 模型选择器锚点（已实现，P0 版）

dsh 的 `dsh-client-ui-model-selection` 源码确认了稳定结构：

- 模型选择器按钮带 `aria-haspopup="menu"`；
- 当前模型文本带 CSS Modules 类名 `<hash>_triggerLabel`；
- 插件查找 `[class*="_triggerLabel"]`，再向上找到 `aria-haspopup="menu"` 的父按钮；
- 徽标插入到该按钮内部、`triggerLabel` 之前，因此自然位于模型文案左侧。

这比依赖 tab 的中文/英文文本、弹窗列表的 `modelName` 或隐藏 locale 节点更稳定。模型切换时，
MutationObserver 观察文本/结构变化，2 秒自愈检查会重新挂载；当前 label 含 `glm` 时显示，其他模型隐藏。

显示样式是纯文字：`3%`。百分比按余量使用绿/黄/红色；数据过期时整体降级。由于徽标已经位于 GLM 模型文案左侧，不再重复显示 `glm` 前缀。

### 3.3 移动端防换行（v0.2.4）

dsh 输入框底行（`InputBar` 的 `.row`）是 `flex-wrap:wrap`：左簇（＋按钮/权限选择）与右簇
（模型选择器/上下文环/发送键，`flex:none` 不可压缩）之和超过行宽时，右簇整体掉到第二行。
手机窄屏下模型按钮（`max-width:min(360px,45cqw)`）加推理模型的 effort 文案，很容易越过临界点。

v0.2.3 只压缩间距，最差组合（长模型名 + effort 文案 + 徽标，英文界面文案更长）下仍会换行；
v0.2.4 改为结构上禁止换行（纯插件侧，不修改 dsh 文件）：

- 徽标可见（选中 GLM 模型）时，从模型按钮向上找到 `<hash>_row` 底行（爬 8 层，
  兼容 slot 包装层），打标记类 `dsh-gq-row`；切到非 GLM 模型时移除；
- `@media (max-width:600px)` 内对该标记行：`flex-wrap:nowrap`；右侧簇由 `flex:none`
  改为 `flex:0 1 auto;min-width:0`（可收缩）；权限选择按钮允许省略号；行内 gap 压到 8px；
- 空间不足时的收缩顺序：模型名先省略 → 权限文案省略 → 徽标/发送键固定不动，
  两行在几何上不可能出现；中英文界面同一套规则，与语言无关；
- 桌面端、宽屏、非 GLM 状态完全不受影响；选择器全部 scoped 在标记行内。


## 4. 工程结构

```
dsh-glm-quota/
├── package.json            # @apanoo/dsh-glm-quota；"dsh":{"client":{"platform":"web"}}
├── scripts/build.mjs       # 零依赖打包器构建：src→lib，语法校验，部署到 profile
├── scripts/install.sh      # 复制插件 + 幂等注册 cordis.patch.yml（web-kit 同款）
├── scripts/bundle.mjs      # 零依赖打包器（web-kit 同款，150 行）
├── src/
│   ├── server/
│   │   ├── index.js        # 5min 轮询 + 缓存 + /glm-quota 路由 + .credentials.yaml 解析
│   │   └── fence.js        # 信任围栏（web-kit 同款：sec-fetch-site/Origin/Host 校验）
│   └── client/
│       ├── index.js        # 入口：installBadge
│       ├── badge.js        # 模型选择器定位 / 徽标注入 / 模型判定 / 刷新调度
│       └── usage.js        # /glm-quota 取数 + 容错（失败保留上次值标 stale）
├── lib/                    # 构建物（入库，install.sh 依赖；勿手改）
├── .gitignore              # node_modules/ *.log .DS_Store
└── README.md               # 本文档
```

## 5. 安装与卸载

**方式 A：从本仓库（推荐，dsh 官方 profile 注册方式）**

```bash
git clone <本仓库> && cd dsh-glm-quota
bash scripts/install.sh     # lib/ 已入库，clone 后可直接装
```

脚本做三件事：① 复制 `lib/ + package.json` 到 `~/.dsh/profiles/web/node_modules/@apanoo/dsh-glm-quota/`；② `node --check` 语法自检；③ 幂等追加注册块到 `~/.dsh/profiles/web/cordis.patch.yml`（已存在则跳过）：

```yaml
- insert:
    - id: glm-quota
      name: '@apanoo/dsh-glm-quota'
```

**方式 B：从源码构建**

```bash
npm run build               # src/ → lib/ → 语法校验 → 部署到 profile
bash scripts/install.sh     # 幂等：只补 patch 注册
```

**生效**：安装/改 server 后重启 dsh（`launchctl kickstart -k gui/501/com.dsh.web`）；
只改 client 刷新浏览器即可。**卸载**：从 cordis.patch.yml 删除 insert 块 +
`rm -rf ~/.dsh/profiles/web/node_modules/@apanoo/dsh-glm-quota`，再重启 dsh。

**自检**：`curl -s http://127.0.0.1:3080/glm-quota` 应返回
`{"ok":true,"remaining":…,"percentage":…,…}`（200 = 服务端半、key、上游接口全通）。

## 6. 核心骨架（实现底稿，与 lib 产物等价）

### 6.1 服务端半

```js
// src/server/index.js（草案）
const QUOTA_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
const POLL_MS = 5 * 60 * 1000;
let cache = null;            // {percentage, nextResetTime, fetchedAt, stale}
let timer = null;

async function readKey() {
  // 1) process.env.ZAI_CODING_CN_API_KEY  2) ~/.dsh/.credentials.yaml 解析
  //    yaml 解析优先 require dsh 进程内已有解析器，保底手写窄解析（只取这一键）
}

async function refresh() {
  try {
    const key = await readKey();
    const res = await fetch(QUOTA_URL, { headers: { Authorization: `Bearer ${key}` } });
    const data = await res.json();
    const five = (data?.data?.limits ?? []).find(l => l.type === "TOKENS_LIMIT" && l.unit === 3);
    if (five) cache = { percentage: Number(five.percentage) || 0,
                        nextResetTime: five.nextResetTime ?? null,
                        fetchedAt: Date.now(), stale: false };
  } catch (e) { if (cache) cache.stale = true; }   // 失败保留上次值
}

function apply(ctx) {
  refresh();
  timer = setInterval(refresh, POLL_MS);           // 无 jitter 需求：单用户自用
  // webServer.register({kind:"exact", path:"/glm-quota", handler})
  // ctx.effect 注册轮询定时器；卸载时 clearInterval
}
module.exports = { name: "glm-quota", inject: ["webServer"], apply };
```

### 6.2 客户端半（badge 核心逻辑）

```js
// src/client/badge.js（实际实现的简化骨架）
var REFRESH_MS = 60 * 1000;

function findTriggerLabel() {
  // 找 <hash>_triggerLabel，再向上找到 aria-haspopup="menu" 的模型选择器按钮
}

function ensureBadge(host, label) {
  // badge 作为 host 的首个子项，插到 label 左侧；host 重建后自动迁移
}
function currentModelText(label) { return label.textContent.trim(); }
function paint(cache) { /* glm 文字、remaining%、阈值色、stale、重置时间 title */ }

function tick() {
  var label = findTriggerLabel();
  if (!label) return;
  var host = findHost(label);
  if (!host) return;
  ensureBadge(host, label);
  if (!/glm/i.test(currentModelText(label))) { hide(); return; }
  fetch("/glm-quota").then(function (r) { return r.json(); }).then(paint);
}
```

> 上面是实现底稿；可运行源码位于 `src/`，`lib/` 是 `npm run build` 生成物。

## 7. 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| 1 | 配额接口是社区逆向（cc-switch），非官方契约 | 失败保留上次值 + stale 灰态；接口字段解析集中在单函数便于跟进 |
| 2 | 5h 为滚动窗口，语义随官方调整 | 直接消费服务端 percentage/nextResetTime，不自算窗口 |
| 3 | dsh 升级后模型选择器结构漂移 | 优先使用 `aria-haspopup="menu"` + `<hash>_triggerLabel` 语义/结构锚点；MO/2s 自愈 |
| 4 | `.credentials.yaml` 解析格式变化 | 双路：env 保底；解析失败时返回 unknown，徽标灰态 |
| 5 | key 安全 | 只在服务端进程内；HTTP 回复仅 percentage/remaining/nextResetTime/fetchedAt |
| 6 | 模型选择器空间较窄 | 百分比使用小号等宽字；按钮本身已有 ellipsis，徽标 flex-shrink:0 |

## 8. 分期

- **P0（已实现）**：服务端轮询+缓存；客户端模型选择器左侧纯文字元信息；中英文/移动端/桌面端结构锚定；双主题。
- **P1**：继续观察真实桌面端布局；必要时从 model-selection store 读取 provider/model id，替代 label 文本匹配。
- **P2**：点击或 hover 展示周配额 / 工具额度 / 重置时间明细。

## 9. 验证清单（每轮发版过一遍）

- [ ] 选中 glm 模型：输入框底部显示 `42%`，位于当前模型文案左侧
- [ ] 切到非 GLM 模型：`glm` 元信息隐藏，模型选择器仍可正常点击
- [ ] 断网/改坏 key：显示灰色占位或保留上次数值，不报错不闪烁
- [ ] 明暗主题切换：文字对比度可读
- [ ] 桌面 + 手机（安卓壳 / PWA）均不遮挡模型名、下拉箭头和发送按钮
- [ ] dsh 重启后 5 min 内出现数据；轮询期间 CPU/网络无可感知开销

## 10. 参考

- pi-zai-usage：https://github.com/Feng-H/pi-zai-usage （npm `pi-zai-usage@0.1.0`，MIT）
- Z.AI Devpack FAQ：https://docs.z.ai/devpack/faq
- dsh 插件机制：`dsh-repair/dsh-tab-kit.md` §1（slots/renderSlot 契约）、web-kit `scripts/install.sh`（部署注册先例）
