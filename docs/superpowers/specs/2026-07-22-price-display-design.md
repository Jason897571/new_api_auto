# 价格化显示（输入价/输出价 而非 ratio）

## 目标
单站编辑与同步页把 new-api 的倍率（ratio）统一显示为直观的**真实价格**（$/1M tokens）。
用户看到「输入价 / 输出价 / 缓存价 …」而不是 ModelRatio / CompletionRatio。

## 换算模型（已核对 new-api service/quota.go 与 price.go）
基准：`输入价 = ModelRatio × 2`（price.ts 约定）。其余倍率都是相对输入的 per-token 倍率：

| 显示价（$/1M） | 计算 | 反算 ratio |
|---|---|---|
| 输入价 | ModelRatio × 2 | ModelRatio = 输入价 / 2 |
| 输出价 | 输入价 × CompletionRatio | CompletionRatio = 输出价 / 输入价 |
| 缓存读价 | 输入价 × CacheRatio | CacheRatio = 缓存读价 / 输入价 |
| 缓存写价 | 输入价 × CreateCacheRatio | CreateCacheRatio = 缓存写价 / 输入价 |
| 图片价 | 输入价 × ImageRatio | ImageRatio = 图片价 / 输入价 |
| 音频输入价 | 输入价 × AudioRatio | AudioRatio = 音频输入价 / 输入价 |
| 音频输出价 | 音频输入价 × AudioCompletionRatio | AudioCompletionRatio = 音频输出价 / 音频输入价 |
| 按次价 | ModelPrice（本就是价格） | 不变 |

阶梯表达式（BillingExpr）与计费模式（BillingMode）保持原样。

## 决策（已与用户确认）
- **编辑语义**：两个（所有）独立价格 —— 所见即所存。改「输入价」保持其它价格不变、自动重算它们的倍率。
- **同步深度**：轻量 —— 同步页展示价格；底层仍按字段复制原始 ratio。输入价+输出价一起同步即达成两站一致。
- **字段范围**：全部倍率转成价格。

## 实现
### 后端
- `internal/pricing/price_display.go`（新）：`DisplayPrice(m, field) *float64` + `PriceLabel(field) string`，作为价格换算单一真源（Go 侧）。
- `internal/diff`：`FieldDiff` 增加 `source_price` / `target_price` / `label`，由各站自己的输入价算出（用于同步页展示）。同步机制（synccalc/editsvc）不变。

### 前端
- `Editor.jsx`：列改为价格；`edits` 按价格字段暂存；`save()` 对每个改动过的模型，用当前显示价重算全部 ratio、只写回变化字段（复用现有 raw-field PUT）。`输入价=0/空` 时跳过相对倍率换算，避免误写。
- `Sync.jsx`：差异表 维度列显示中文价格标签，值列显示 `source_price`/`target_price`（BillingMode/Expr 回退原值）。

## 边界
- 输入价为 0 或空：相对价格不可反算 → 该模型相对价格列显示为空，保存跳过其倍率。
- 浮点噪声：统一 `fmtNum`（保留 6 位、去尾零）。
- 公式落两处（JS 编辑 + Go 同步 diff），均注释指向本表。
