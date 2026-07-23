# 同步/回滚预览弹窗

## 目标
- 同步：勾选后点「预览所选」弹出弹窗，列出每个目标站将改动的 `模型 · 维度 · 当前值 → 新值`；弹窗内「确认同步」执行、「取消」关闭。
- 回滚：History 页「回滚」弹出弹窗，显示 `当前值 → 回滚后值`；「确认回滚」执行、「取消」关闭（替换 window.confirm）。
- 均复用已做的价格显示与中文维度标签。

## 后端
- 新增 `POST /api/snapshots/{id}/preview` → `rollbackPreview`：
  1. 取快照 + 站点 client，载入当前 options。
  2. `restored` = 当前 options 覆盖上快照 payload 的旧值（空旧值写 "{}"，与 Rollback 一致）。
  3. `diff.Compute(parse(当前), parse(restored))` → 复用 FieldDiff（source=当前, target=回滚后, 带价格/label）。
  4. 返回 `{site_name, snapshot_id, models}`。
- 同步预览用现有 `POST /api/sync/preview`（仅做校验/错误捕获），改动清单内容由前端已算好的差异数据构建。

## 前端
- `components/Modal.jsx`：遮罩 + 居中卡片 + 标题 + body + footer（取消/确认，确认可 danger 态、busy 态）。
- `components/ChangeList.jsx`：渲染分组 `[{name,error,changes:[{model,label,before,after}]}]`，每组一张 before→after 小表；空改动显示「无改动」。
- `Sync.jsx`：`预览所选` → 调 sync/preview 校验 + 用 diff 行构建分组 → 开 Modal；`确认同步` → runSync → 关弹窗、显示结果。移除独立「确认同步」按钮。
- `History.jsx`：`回滚` → 调 snapshot preview → 单组 → 开 Modal → `确认回滚` → rollback。
- `api.js`：加 `snapshotPreview(id)`。

## 边界
- 目标站对某字段已与源站一致（diff 中缺该 target）→ 该项不进弹窗。
- 目标站不可达 → 该组显示 error，不显示改动。
- 回滚后清空（原先未设置）→ 显示 `X → 无`。
