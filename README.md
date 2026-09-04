# @apanoo/dsh-glm-quota

> dsh 插件：会话选中 GLM Coding Plan（zai-coding-cn）模型时，在「对话 / 轨迹」tab 行**最右侧**显示 5 小时用量剩余百分比徽标。

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
- 红线：**key 永不出服务端**。rpc 只回 `percentage / nextResetTime / fetchedAt`。

## 2. 功能定义

- 触发条件：会话当前选中模型 ∈ zai-coding-cn 模型表（配置化，默认 `glm-*` 前缀匹配 + 模型 id 精确表双保险）。选其他 provider 模型 → 徽标隐藏。
- 展示位置：**「对话 / 轨迹」tab 同一行最靠右**（用户定稿）。
- 展示内容：小 pill，文本 = 剩余百分比（如 `42%`）；颜色阈值 绿 >50 / 黄 20–50 / 红 ≤20 / 灰 = 无数据或 stale；hover title = `GLM 5h 窗口剩余 42% · HH:MM 重置`。
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
│  · 徽标注入：定位 tab 行 → 行尾插 pill     │
│  · 刷新：tab 行出现时拉一次；打开期间      │
│    60s 轮询；失败显示上次值/灰态           │
│  · 选中模型判定 → 决定显示/隐藏            │
└──────────────────────────────────────────┘
```

> **决策记录**：原设计用 `connection.rpc`/channel（plugin-manager 先例），实现时改为
> webServer 精确路由——web-kit 已验证同款（openpath/dock 走 /web-kit），安全模型一致
> （Caddy basic_auth + fence.js 纵深防御），少一层 rpc API 依赖。

### 3.1 为什么 tab 行徽标用 DOM 增强而不是插槽

`conversation.view` 插槽注册的条目会被渲染成**新 tab**（tab-kit 的机制），徽标不是 tab——所以走 DOM 增强：

1. 结构匹配定位 tab 行：找文本 ∈ {`对话`,`Chats`} 与 {`轨迹`,`Trajectory`} 的叶节点的**公共父行**（向上爬 ≤8 层，两标签都命中的最小容器）；
2. 行 `position:static` 时改 relative，徽标 absolute 右缘垂直居中（`right:12px`），flex 与否都能保证「最靠右」；
3. MutationObserver + 2s 自愈 interval（sessionlog.js 同款防漂移套路），`WeakSet` 去重防重复插入；诊断日志 `console.info("[glm-quota] …")`（30s 节流）。

### 3.2 选中模型怎么判定（已实现，P0 版）

锚定 model-selection 的 CSS Modules 类名：`[class*="modelName"]` 稳定命中
composer model seat / 弹窗行的模型名元素（哈希前缀随构建变，源类名后缀不变）：

1. 弹窗打开：选中行祖先带 `aria-checked="true"` → 优先取它；
2. 弹窗关闭：只有 seat 一个元素 → 取第一个；
3. 文本含 `glm`（忽略大小写）→ 显示；命中其他已知厂商（gpt/claude/deepseek/…）→ 隐藏；
4. 无信号 → 默认显示。

> P1 升级路径：model-selection 的 store/服务直读选中模型 id，精确匹配
> zai-coding-cn 模型表（`glm-4.5-air/4.7/5-turbo/5.1/5.2/5.3/5.3-flash`）。
> **教训**：初版按视口下部 30% 扫含 glm/厂商关键字的短文本，被聊天内容里的
> deepseek/gpt 字样误伤隐藏——已废弃该启发式。

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
│       ├── badge.js        # tab 行定位 / 徽标注入 / 模型判定 / 刷新调度
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
  // rpc channel 注册：对齐 plugin-manager 的 connection.rpc/channel API（P0 第一步核对其注册形态）
  // channel "glm-quota:usage" → () => cache
}
module.exports = { name: "glm-quota", apply };
```

### 6.2 客户端半（badge 核心逻辑草案）

```js
// src/client/badge.js（草案）
var REFRESH_MS = 60 * 1000;
var GLM_IDS = null;   // 配置表，默认 glm-* 前缀

function findTabRow() {
  // 1) 找文本∈{对话,Chats} 与 {轨迹,Trajectory} 的叶子节点
  // 2) 向上爬 ≤6 层找同时包含两者的最小容器 → 返回
}

function ensureBadge(row) { /* WeakSet 去重；行尾插 pill；点击预留 P2 */ }

function paint(cache) { /* 剩余%=100-percentage；阈值着色；stale→灰+title 标注 */ }

function tick() {
  var row = findTabRow();
  if (!row) return;
  ensureBadge(row);
  if (!glmModelSelected()) { hide(); return; }
  rpc("glm-quota:usage").then(paint).catch(paintStale);
}
// MutationObserver + 2s interval 自愈 + 打开期间 60s tick
```

## 7. 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| 1 | 配额接口是社区逆向（cc-switch），非官方契约 | 失败保留上次值 + stale 灰态；接口字段解析集中在单函数便于跟进 |
| 2 | 5h 为滚动窗口，语义随官方调整 | 直接消费服务端 percentage/nextResetTime，不自算窗口 |
| 3 | dsh 升级后 tab 行结构漂移 | 文本结构匹配（多语言对）+ MO/2s 自愈；匹配失败静默隐藏不报错 |
| 4 | `.credentials.yaml` 解析格式变化 | 双路：env 保底；解析失败时 rpc 返回 unknown，徽标灰态 |
| 5 | key 安全 | 只在服务端进程内；rpc 回复仅 percentage/nextResetTime/fetchedAt |
| 6 | 与 tab-kit（未来的第三个 tab）共存 | 徽标 append 在行尾，不碰插槽条目；tab 增删不影响定位逻辑 |

## 8. 分期

- **P0（约半天）**：服务端轮询+缓存+rpc；客户端 tab 行徽标（定位/注入/显示条件/双主题）；手动刷新点。
- **P1**：打开期间 60s 自动刷新；hover 重置倒计时；阈值变色打磨；composer seat 槽位探明后（若有）转正规注册。
- **P2**：点徽标弹明细浮层（周配额 / 工具月度 / 重置时间），对齐 pi-zai-usage 的 /usage。

## 9. 验证清单（每轮发版过一遍）（每轮发版过一遍）

- [ ] 选中 glm 模型：tab 行右侧出现徽标，数值与 open.bigmodel.cn 控制台一致（±1%）
- [ ] 切到非 GLM 模型（如 openai/gpt-4o）：徽标隐藏
- [ ] 断网/改坏 key：徽标变灰并保留上次数值，不报错不闪烁
- [ ] 明暗主题切换：徽标双主题可读
- [ ] 桌面 + 手机（安卓壳 / PWA）三端显示与换行正常
- [ ] dsh 重启后 5 min 内出现数据；轮询期间 CPU/网络无可感知开销
- [ ] tab-kit 未来上线后徽标仍在行尾且不与第三个 tab 重叠

## 10. 参考

- pi-zai-usage：https://github.com/Feng-H/pi-zai-usage （npm `pi-zai-usage@0.1.0`，MIT）
- Z.AI Devpack FAQ：https://docs.z.ai/devpack/faq
- dsh 插件机制：`dsh-repair/dsh-tab-kit.md` §1（slots/renderSlot 契约）、web-kit `scripts/install.sh`（部署注册先例）
