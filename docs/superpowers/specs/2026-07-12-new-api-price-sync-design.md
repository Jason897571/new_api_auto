# new-api 多站价格管理与同步工具 — 设计文档

日期：2026-07-12
状态：待评审

## 1. 背景与目标

用户运营多个 [new-api](https://github.com/QuantumNous/new-api)（LLM API 网关，one-api 的分支）站点。需要一套自建的前后端工具，用于：

1. **编辑单个站点的模型价格**，包括基础价与**阶梯计价（tiered pricing）**表达式。
2. **在不同站点之间同步价格**。用户不信任 new-api 自带的价格同步（`ratio_sync`），要求自己重新实现。

新加坡 daily 站（`.env` 中标注 `#新加坡daily`）作为测试库/测试站。

### 非目标（本期不做）

- 分组倍率同步（`GroupRatio` / `GroupGroupRatio` / `group_ratio_setting.*`）——属于各站独立的商务配置，不跨站同步。
- 渠道（channel）、令牌（token）、用户等非价格配置的管理。
- 工具自身的登录/多用户权限（仅本地/内网使用，后续可加）。

## 2. 关键调研结论（new-api 价格系统）

> 以下均已在 new-api 源码（`/Users/jason/Desktop/project/new-api`）与新加坡 daily 实库中核实。

### 2.1 价格全部存在 `options` 表

new-api 把所有价格存在**单一 key/value 表 `options`** 里，每个价格维度是一整行 JSON 字符串。没有 per-model / per-channel 的价格列。

- 结构体 `Option`（`model/option.go:18`）：`Key`（主键）、`Value`（JSON 字符串）。
- 写入入口 `UpdateOption(key, value)`（`model/option.go:205`）：先写库，再更新内存 map，并对分层配置触发缓存失效。

### 2.2 两套并存的计价体系

**(A) Ratio 模式（默认）** —— 扁平的 `{model: number}` map：

| option key | 含义 | 本期覆盖 |
|---|---|---|
| `ModelRatio` | 输入价格倍率 | ✅ |
| `CompletionRatio` | 输出 = 输入 × 此值 | ✅ |
| `ModelPrice` | 按次固定价（图片/视频类） | ✅ |
| `CacheRatio` | 缓存读取折扣 | ✅ |
| `CreateCacheRatio` | 缓存写入倍率 | ✅ |
| `ImageRatio` | 图片 token 倍率 | ✅ |
| `AudioRatio` | 音频输入倍率 | ✅ |
| `AudioCompletionRatio` | 音频输出倍率 | ✅ |
| `GroupRatio` / `GroupGroupRatio` | 分组倍率 | ❌ 不同步 |

**(B) Tiered 模式（阶梯计价）** —— 表达式 DSL，逐模型：

- `billing_setting.billing_mode` —— `{model: "tiered_expr" | "ratio"}`，激活阶梯计价。
- `billing_setting.billing_expr` —— `{model: "<表达式>"}`。
- 表达式引擎在 `pkg/billingexpr`。变量：`p`（输入）、`c`（输出）、`cr`/`cc`/`cc1h`（缓存）、`img`/`img_o`/`ai`/`ao`（图片/音频）、`len`（输入上下文总长，用于阶梯条件判断）。函数：`tier()`、`param()`、`header()`、`hour()`、`max/min/ceil/floor` 等。系数是真实 $/1M token 价格。
- 示例（Claude 200k 分档）：
  ```
  len <= 200000
    ? tier("standard",     p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6)
    : tier("long_context", p * 6 + c * 22.5 + cr * 0.6 + cc * 7.5 + cc1h * 12)
  ```
- 新加坡 daily 实库已有约 13 个 Claude 模型处于 `tiered_expr`。

### 2.3 管理 API（本工具的读写通道）

走 new-api 官方接口，**不直连数据库**——这样写入会同时更新库、内存缓存并触发缓存失效（`InvalidatePricingCache` / `InvalidateExposedDataCache`），避免直连库时缓存不生效的问题。

- `GET /api/option/`（RootAuth）—— 返回全部 options（价格 key 不被脱敏）。
- `PUT /api/option/`（RootAuth）—— body `{ "key": "<key>", "value": <string|map> }`，更新单个 option（走 `UpdateOption`）。
- 认证头（两者都需要）：
  - `Authorization: <管理员系统访问令牌>`
  - `New-Api-User: <管理员用户 id>`

### 2.4 重要约束：阶梯表达式没有服务端校验

`PUT /api/option/` 对 `billing_setting.billing_expr` **不做校验**——`handleConfigUpdate`（`model/option.go`）只做 JSON 反序列化 + 缓存失效，`SmokeTestExpr` 未接入任何 HTTP 路由。

→ **校验责任在本工具**。推送/编辑表达式前，必须自行做与 new-api 一致的 smoke test（编译 + 用样本 token 向量 0/1k/100k/1M 跑一遍，确保结果非负）。

### 2.5 写入的粒度

每个 option 的 value 是**一整张 JSON map**。改动少数模型也必须提交整张表。因此同步/回滚都以「整个 option key 的完整 map」为单位快照与写回。

## 3. 技术栈

- **后端：** Go（`net/http` + `chi` 路由）。
- **工具自身存储：** `modernc.org/sqlite`（纯 Go，无 cgo，跨平台易编译）。存站点注册表、快照、审计日志。
- **表达式校验：** **拷贝** new-api 的 `pkg/billingexpr`（5 个文件：compile/run/settle/round/types.go）到 `backend/internal/billingexpr/`，进程内调用 `SmokeTestExpr`。自包含、可移植、可部署到服务器；不依赖 new-api 源码路径。引擎升级时手动再同步一次（该包很小且稳定）。依赖 `github.com/expr-lang/expr` 与 `github.com/tidwall/gjson`。
- **前端：** React + Vite。
- **部署形态：** 后端提供 `/api/*` JSON 接口，并托管打包后的前端静态文件（单进程）。

## 4. 项目结构

```
new_api_auto/
  backend/
    main.go
    go.mod
    internal/
      billingexpr/   # 从 new-api 拷贝的表达式引擎（校验用）
      newapi/        # new-api 管理 API 客户端（GET/PUT option，带认证头）
      pricing/       # option key <-> 规范化模型价格结构 的解析/序列化（纯函数）
      diff/          # 两站差异计算（纯函数）
      sync/          # 合并选中项 -> 快照 -> 顺序推送 -> 审计
      store/         # sqlite：sites / snapshots / audit
      validate/      # 包装 billingexpr.SmokeTestExpr
      api/           # HTTP handlers
  frontend/
    src/pages/{Sites, Editor, Sync, History}
  data/              # sqlite 文件（运行时生成）
```

## 5. 数据模型（工具自身的 SQLite）

```sql
sites(
  id INTEGER PK, name TEXT, base_url TEXT, token TEXT, user_id TEXT,
  created_at INTEGER, updated_at INTEGER
)
snapshots(
  id INTEGER PK, site_id INTEGER, created_at INTEGER,
  reason TEXT,            -- 例如 "sync from 新加坡daily" / "manual edit"
  payload_json TEXT       -- {optionKey: 旧的完整value字符串, ...}
)
audit(
  id INTEGER PK, ts INTEGER, action TEXT,
  source_site TEXT, target_site TEXT,
  keys_json TEXT,         -- 涉及的 option keys
  models_json TEXT,       -- 涉及的模型名
  result TEXT             -- success / partial / failed + 详情
)
```

站点 token 为敏感信息，存本地 SQLite（工具仅本地/内网运行）。

## 6. 规范化价格模型（内部结构）

`pricing` 包把关注的 option key 解析成按模型聚合的结构，便于展示与 diff：

```
ModelPricing {
  Model            string
  BillingMode      string   // "ratio" | "tiered_expr"
  // ratio 模式字段
  ModelRatio       *float64
  CompletionRatio  *float64
  ModelPrice       *float64
  CacheRatio       *float64
  CreateCacheRatio *float64
  ImageRatio       *float64
  AudioRatio       *float64
  AudioCompletionRatio *float64
  // tiered 模式字段
  BillingExpr      *string
}
```

指针/可选：区分「未设置」与「设为 0」。序列化时把选中改动合并回各自的 option map。

## 7. 数据流

**读取：** 前端 → 后端 `GET /api/option/`（每站）→ `pricing` 解析为 `map[model]ModelPricing` → 前端展示。

**同步写入：**
1. 读源站 + 目标站，解析。
2. `diff` 计算逐模型、逐维度差异（含「一站 ratio、另一站 tiered」的模式差异）。
3. 用户在差异表勾选要同步的模型/维度。
4. **预览**：逐 option key 展示 before/after 的完整 JSON。
5. 用户确认。
6. 读目标站当前相关 option map → 合并选中改动。
7. **写入前，对涉及的 `billing_expr` 逐条 smoke test**；任一不通过则中止并报告。
8. **快照**目标站被改动的 option key 当前值 → 存 `snapshots`。
9. 逐 key `PUT /api/option/`；单 key 失败即停，报告已写入/未写入。
10. 写 `audit`。

**回滚：** 从某条 snapshot 取旧值 → 逐 key `PUT` 还原 → 写 audit。

## 8. 安全流程

预览 diff → 确认 → 写前 smoke test → 自动快照 → 顺序写入（失败即停）→ 结果页 → 可一键回滚。所有写操作进审计。

## 9. HTTP 接口（后端 `/api/*`）

- `GET  /api/sites` / `POST /api/sites` / `PUT /api/sites/:id` / `DELETE /api/sites/:id`
- `POST /api/sites/:id/test` —— 测试连接（调目标站 `GET /api/option/`）
- `GET  /api/sites/:id/pricing` —— 该站规范化价格
- `POST /api/validate-expr` —— 校验单条阶梯表达式（body: `{expr}`）
- `PUT  /api/sites/:id/pricing` —— 编辑单站价格（内含 smoke test + 快照 + 写入）
- `POST /api/diff` —— body `{source_id, target_id}`，返回差异
- `POST /api/sync` —— body `{source_id, target_ids, selections}`，执行同步（含预览确认后的实际写入）
- `GET  /api/sites/:id/snapshots` / `POST /api/snapshots/:id/rollback`
- `GET  /api/audit`

## 10. 前端页面

- **站点管理（Sites）**：站点列表；增删改；「测试连接」。
- **单站编辑（Editor）**：某站模型价格表（可编辑基础价/子费率）；阶梯表达式编辑器，带实时校验（调 `/api/validate-expr`）。
- **同步（Sync）**：选源站 + 目标站 → 差异表（按模型分行，列出各维度 source vs target，差异高亮，可勾选）→ 预览 → 确认推送 → 结果。
- **历史/回滚（History）**：快照与审计列表；一键回滚。

## 11. 测试计划

- **单元测试（Go 表驱动）**：
  - `pricing`：option JSON ↔ 规范化结构 往返。
  - `diff`：各类差异场景（值不同、缺失、ratio↔tiered 模式差异）。
  - `sync`：合并逻辑（改动正确合并回整张 map，未选中项不动）；快照 payload 正确。
  - `validate`：合法/非法表达式（编译错误、负值）。
- **集成测试（打新加坡 daily）**：
  - 读 options → 生成 diff → 干跑（不写）。
  - 真实写入往返：改一个测试模型价格 → 校验目标站生效 → 用快照回滚 → 校验还原。

## 12. 实施阶段

1. **P1 单站只读 + 编辑**：站点管理、读取解析、单站价格展示与编辑（含表达式校验、快照、写入）。先在新加坡 daily 跑通。
2. **P2 同步**：diff 引擎、同步流程（预览/确认/快照/写入/审计）。
3. **P3 历史/回滚**：快照列表、审计、回滚。

## 13. 待确认/风险

- **多站版本差异**：不同站可能跑不同 new-api 版本，表达式引擎或 option key 集合可能略有差异。本期以拷贝的 `billingexpr` 为准；跨版本同步表达式时若目标站引擎更旧，可能出现兼容问题——同步前的 smoke test 用本地引擎，不能 100% 保证目标站运行时行为。
- **只读凭据**：`.env` 中多数站点为只读账号；API 写入需要各站管理员令牌，由用户提供。
- **`CompletionRatio` 部分硬编码且可 Locked**：new-api 有部分 completion ratio 硬编码且不可覆盖（`getHardcodedCompletionModelRatio`）。对这类模型的 `CompletionRatio` 写入可能被忽略——需在 diff/预览中提示。
