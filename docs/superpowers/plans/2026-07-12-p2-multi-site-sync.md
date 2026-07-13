# P2: 多站价格同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P1 单站编辑基础上，实现多站价格同步：选源站+目标站 → 计算差异 → 勾选要同步的模型/维度 → 预览 → 确认 → 逐目标站快照并写入 → 结果与回滚。

**Architecture:** 复用 P1 的 `newapi`/`pricing`/`editsvc`/`store`。新增 `diff`（两站规范化价格对比，纯函数）与 `synccalc`（从源站值+勾选项推导 `[]pricing.Edit`，纯函数）。同步执行复用 `editsvc.Apply`（每目标站：校验→快照→写入）。同时落地终审提出的两个前置项——确定性写入顺序（`billing_expr` 先于 `billing_mode`）和每站写锁——并补一个回滚端点（与写顺序耦合，保证部分失败可恢复）。

**Tech Stack:** Go（`net/http`+chi、`modernc.org/sqlite`、拷贝的 `billingexpr`）、React+Vite。与 P1 相同。

## Global Constraints

- 所有价格读写只走 new-api 官方接口 `GET/PUT /api/option/`，禁止直连数据库。
- 每次 new-api 请求带头 `Authorization: <token>` 与 `New-Api-User: <user_id>`。
- 覆盖的 option key 仅限这 10 个：`ModelRatio`、`CompletionRatio`、`ModelPrice`、`CacheRatio`、`CreateCacheRatio`、`ImageRatio`、`AudioRatio`、`AudioCompletionRatio`、`billing_setting.billing_mode`、`billing_setting.billing_expr`。不含任何 `GroupRatio`。
- 写入前必须：(a) 校验所有 `billing_expr`（本地 `validate.Expr`）；(b) 快照目标站被改动 key 的旧值。
- **写入顺序确定性**：同一次写入涉及多个 key 时，`billing_setting.billing_expr` 必须在 `billing_setting.billing_mode` 之前写入（表达式先就位，模式再激活）；其余 key 顺序稳定（按 key 名排序）。
- **每站写锁**：对同一站点的写入串行化，避免并发 read-modify-write 丢更新。
- Go module 路径 `newapiauto`（`import "newapiauto/internal/..."`）。
- 同步的语义：把**源站**某模型某维度的值，写到**目标站**同一模型同一维度；源站缺该维度而目标站有 → 生成删除该维度的 edit。
- 敏感值（站点 token）仅存本地 SQLite，不写日志。

---

### Task 1: editsvc 硬化 — 确定性写入顺序 + 每站写锁

**Files:**
- Modify: `backend/internal/editsvc/editsvc.go`
- Modify: `backend/internal/editsvc/editsvc_test.go`

**Interfaces:**
- Consumes: existing `Apply`, `pricing.KeyBillingMode`, `pricing.KeyBillingExpr`.
- Produces:
  - `func orderedKeys(changed map[string]string) []string` — 返回写入顺序：先所有非 billing_mode 的 key（其中 billing_expr 优先，其余按字母序），最后 billing_mode。
  - `Apply` 内部改为按 `orderedKeys` 顺序写入。
  - 每站写锁：包级 `var siteLocks sync.Map`（siteID→*sync.Mutex），`Apply` 开头对 `siteID` 加锁、defer 解锁。

- [ ] **Step 1: 写失败测试（顺序 + 并发）**

在 `editsvc_test.go` 追加：

```go
func TestApplyWritesExprBeforeMode(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{}, puts: map[string]string{}, order: []string{}}
	_, err := Apply(context.Background(), st, 1, "sg", rw, []pricing.Edit{
		{Model: "claude-x", Field: pricing.FieldBillingMode, Value: "tiered_expr"},
		{Model: "claude-x", Field: pricing.FieldBillingExpr, Value: `tier("base", p*3)`},
	})
	if err != nil {
		t.Fatal(err)
	}
	// billing_expr 必须在 billing_mode 之前写
	iExpr, iMode := -1, -1
	for i, k := range rw.order {
		if k == pricing.KeyBillingExpr {
			iExpr = i
		}
		if k == pricing.KeyBillingMode {
			iMode = i
		}
	}
	if iExpr == -1 || iMode == -1 || iExpr > iMode {
		t.Fatalf("expr must be written before mode, order=%v", rw.order)
	}
}
```

在 `editsvc_test.go` 现有的 `fakeRW` 上增加顺序记录字段：找到 `type fakeRW struct{...}`，加 `order []string`；在其 `PutOption` 方法体首行加 `f.order = append(f.order, key)`。（若 `fakeRW` 未初始化 `order`，nil append 也可用。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/editsvc/ -run TestApplyWritesExprBeforeMode -v`
Expected: FAIL（当前按 map 随机序，偶尔通过——多跑几次或因 orderedKeys 未定义而编译失败）。

- [ ] **Step 3: 实现顺序 + 写锁**

在 `editsvc.go` 顶部 import 加 `"sort"` 和 `"sync"`。加：

```go
var siteLocks sync.Map // siteID(int64) -> *sync.Mutex

func lockSite(siteID int64) func() {
	m, _ := siteLocks.LoadOrStore(siteID, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// orderedKeys 返回稳定写入顺序：billing_expr 最先，其余非 billing_mode 的 key 按字母序，
// billing_mode 最后（表达式先就位、模式后激活）。
func orderedKeys(changed map[string]string) []string {
	var head []string // 非 billing_mode
	hasMode := false
	for k := range changed {
		if k == pricing.KeyBillingMode {
			hasMode = true
			continue
		}
		head = append(head, k)
	}
	sort.Slice(head, func(i, j int) bool {
		if head[i] == pricing.KeyBillingExpr {
			return true
		}
		if head[j] == pricing.KeyBillingExpr {
			return false
		}
		return head[i] < head[j]
	})
	if hasMode {
		head = append(head, pricing.KeyBillingMode)
	}
	return head
}
```

在 `Apply` 函数体最开头（校验循环之前）加写锁：

```go
	unlock := lockSite(siteID)
	defer unlock()
```

把 `Apply` 里的写入循环从 `for key, val := range changed {` 改为按顺序：

```go
	written := []string{}
	for _, key := range orderedKeys(changed) {
		val := changed[key]
		if err := rw.PutOption(ctx, key, val); err != nil {
			st.AddAudit(store.AuditEntry{Action: "edit", TargetSite: siteName,
				Keys: written, Models: models, Result: "partial: " + err.Error()})
			return Result{ChangedKeys: written, SnapshotID: snapID},
				fmt.Errorf("write %s failed (already wrote %v): %w", key, written, err)
		}
		written = append(written, key)
	}
```

（`changedKeys` 用于成功审计的那份保持不变。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/editsvc/ -v`
Expected: 全部 PASS（含新 `TestApplyWritesExprBeforeMode` 与 P1 原有 3 个）。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/editsvc/
git commit -m "feat(editsvc): deterministic write order (expr before mode) and per-site write lock"
```

---

### Task 2: editsvc 回滚 — Rollback

**Files:**
- Modify: `backend/internal/editsvc/editsvc.go`
- Modify: `backend/internal/editsvc/editsvc_test.go`

**Interfaces:**
- Consumes: `store.GetSnapshot`, `OptionRW.PutOption`, `orderedKeys`, `lockSite`, `store.AddAudit`.
- Produces:
  - `func Rollback(ctx context.Context, st *store.Store, siteID int64, siteName string, rw OptionRW, snapshotID int64) (Result, error)` — 读取快照，按 `orderedKeys` 顺序把每个 key 的旧值 PUT 回目标站（快照里空字符串的 key 表示原先不存在该 option——P2 仍原样 PUT 空串或跳过；本任务：**跳过空串 key**，因为写空串会破坏该 option。记 audit `action:"rollback"`）。加每站写锁。

- [ ] **Step 1: 写失败测试**

在 `editsvc_test.go` 追加：

```go
func TestRollbackRestoresOldValues(t *testing.T) {
	st, _ := store.Open(":memory:")
	// 模拟一次改动后的状态：目标站当前是新值，快照存了旧值
	rw := &fakeRW{opts: pricing.OptionSet{pricing.KeyModelRatio: `{"gpt-4o":9.999}`}, puts: map[string]string{}, order: []string{}}
	snapID, _ := st.CreateSnapshot(1, "manual edit", map[string]string{pricing.KeyModelRatio: `{"gpt-4o":2.5}`})
	res, err := Rollback(context.Background(), st, 1, "sg", rw, snapID)
	if err != nil {
		t.Fatal(err)
	}
	if rw.puts[pricing.KeyModelRatio] != `{"gpt-4o":2.5}` {
		t.Fatalf("rollback should restore old value, got %q", rw.puts[pricing.KeyModelRatio])
	}
	if len(res.ChangedKeys) != 1 {
		t.Fatalf("expected 1 restored key, got %v", res.ChangedKeys)
	}
}

func TestRollbackSkipsEmptyOldValue(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{}, puts: map[string]string{}, order: []string{}}
	// 旧值为空串（原先该 option 不存在）→ 跳过，不写空串
	snapID, _ := st.CreateSnapshot(1, "manual edit", map[string]string{pricing.KeyModelRatio: ""})
	_, err := Rollback(context.Background(), st, 1, "sg", rw, snapID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rw.puts) != 0 {
		t.Fatalf("empty old value should be skipped, got %v", rw.puts)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/editsvc/ -run TestRollback -v`
Expected: FAIL（`Rollback` 未定义）。

- [ ] **Step 3: 实现**

在 `editsvc.go` 加：

```go
// Rollback 把某快照里保存的旧值写回目标站。空串旧值（原先不存在该 option）跳过。
func Rollback(ctx context.Context, st *store.Store, siteID int64, siteName string, rw OptionRW, snapshotID int64) (Result, error) {
	unlock := lockSite(siteID)
	defer unlock()

	snap, err := st.GetSnapshot(snapshotID)
	if err != nil {
		return Result{}, fmt.Errorf("load snapshot: %w", err)
	}
	if snap.SiteID != siteID {
		return Result{}, fmt.Errorf("snapshot %d does not belong to site %d", snapshotID, siteID)
	}
	// 只写非空旧值
	toWrite := map[string]string{}
	for k, v := range snap.Payload {
		if v != "" {
			toWrite[k] = v
		}
	}
	written := []string{}
	for _, key := range orderedKeys(toWrite) {
		if err := rw.PutOption(ctx, key, toWrite[key]); err != nil {
			st.AddAudit(store.AuditEntry{Action: "rollback", TargetSite: siteName,
				Keys: written, Result: "partial: " + err.Error()})
			return Result{ChangedKeys: written}, fmt.Errorf("rollback write %s failed: %w", key, err)
		}
		written = append(written, key)
	}
	st.AddAudit(store.AuditEntry{Action: "rollback", TargetSite: siteName, Keys: written, Result: "success"})
	return Result{ChangedKeys: written}, nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/editsvc/ -v`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/editsvc/
git commit -m "feat(editsvc): add Rollback to restore a snapshot's old values"
```

---

### Task 3: diff 包 — 两站规范化价格对比

**Files:**
- Create: `backend/internal/diff/diff.go`
- Create: `backend/internal/diff/diff_test.go`

**Interfaces:**
- Consumes: `pricing.ModelPricing`, `pricing.Field` 及其常量。
- Produces:
  - `type FieldDiff struct{ Field pricing.Field ` + "`json:\"field\"`" + `; Source *string ` + "`json:\"source\"`" + `; Target *string ` + "`json:\"target\"`" + ` }`（nil 表示该侧无此维度；值用字符串表示，数字用 strconv.FormatFloat）
  - `type ModelDiff struct{ Model string ` + "`json:\"model\"`" + `; Fields []FieldDiff ` + "`json:\"fields\"`" + ` }`
  - `func Compute(source, target map[string]*pricing.ModelPricing) []ModelDiff` — 对源∪目标的每个模型，逐维度比较（8 个 ratio 字段 + BillingMode + BillingExpr），仅收集**有差异**的维度；仅收集含≥1 差异维度的模型；结果按 model 名排序。

- [ ] **Step 1: 写失败测试**

`backend/internal/diff/diff_test.go`:

```go
package diff

import (
	"testing"

	"newapiauto/internal/pricing"
)

func fp(v float64) *float64 { return &v }
func sp(s string) *string   { return &s }

func TestComputeDetectsRatioDiff(t *testing.T) {
	src := map[string]*pricing.ModelPricing{
		"gpt-4o": {Model: "gpt-4o", BillingMode: "ratio", ModelRatio: fp(3)},
		"same":   {Model: "same", BillingMode: "ratio", ModelRatio: fp(1)},
	}
	tgt := map[string]*pricing.ModelPricing{
		"gpt-4o": {Model: "gpt-4o", BillingMode: "ratio", ModelRatio: fp(2.5)},
		"same":   {Model: "same", BillingMode: "ratio", ModelRatio: fp(1)},
	}
	got := Compute(src, tgt)
	if len(got) != 1 || got[0].Model != "gpt-4o" {
		t.Fatalf("expected only gpt-4o to differ, got %+v", got)
	}
	if len(got[0].Fields) != 1 || got[0].Fields[0].Field != pricing.FieldModelRatio {
		t.Fatalf("expected ModelRatio diff, got %+v", got[0].Fields)
	}
	if *got[0].Fields[0].Source != "3" || *got[0].Fields[0].Target != "2.5" {
		t.Fatalf("wrong values: %+v", got[0].Fields[0])
	}
}

func TestComputeModelOnlyInSource(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"new": {Model: "new", BillingMode: "ratio", ModelRatio: fp(5)}}
	tgt := map[string]*pricing.ModelPricing{}
	got := Compute(src, tgt)
	if len(got) != 1 || got[0].Fields[0].Source == nil || got[0].Fields[0].Target != nil {
		t.Fatalf("expected source-only diff, got %+v", got)
	}
}

func TestComputeTieredExprDiff(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "tiered_expr", BillingExpr: sp(`tier("base", p*3)`)}}
	tgt := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "tiered_expr", BillingExpr: sp(`tier("base", p*6)`)}}
	got := Compute(src, tgt)
	if len(got) != 1 {
		t.Fatalf("expected expr diff, got %+v", got)
	}
	foundExpr := false
	for _, f := range got[0].Fields {
		if f.Field == pricing.FieldBillingExpr {
			foundExpr = true
		}
	}
	if !foundExpr {
		t.Fatalf("expected BillingExpr diff, got %+v", got[0].Fields)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/diff/ -v`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现**

`backend/internal/diff/diff.go`:

```go
package diff

import (
	"sort"
	"strconv"

	"newapiauto/internal/pricing"
)

type FieldDiff struct {
	Field  pricing.Field `json:"field"`
	Source *string       `json:"source"`
	Target *string       `json:"target"`
}

type ModelDiff struct {
	Model  string      `json:"model"`
	Fields []FieldDiff `json:"fields"`
}

func fmtFloat(p *float64) *string {
	if p == nil {
		return nil
	}
	s := strconv.FormatFloat(*p, 'f', -1, 64)
	return &s
}

// ratioAccessor 返回某模型某 ratio 字段的字符串指针（nil=未设置）。
func ratioValue(m *pricing.ModelPricing, f pricing.Field) *string {
	if m == nil {
		return nil
	}
	switch f {
	case pricing.FieldModelRatio:
		return fmtFloat(m.ModelRatio)
	case pricing.FieldCompletionRatio:
		return fmtFloat(m.CompletionRatio)
	case pricing.FieldModelPrice:
		return fmtFloat(m.ModelPrice)
	case pricing.FieldCacheRatio:
		return fmtFloat(m.CacheRatio)
	case pricing.FieldCreateCacheRatio:
		return fmtFloat(m.CreateCacheRatio)
	case pricing.FieldImageRatio:
		return fmtFloat(m.ImageRatio)
	case pricing.FieldAudioRatio:
		return fmtFloat(m.AudioRatio)
	case pricing.FieldAudioCompletionRatio:
		return fmtFloat(m.AudioCompletionRatio)
	}
	return nil
}

func exprValue(m *pricing.ModelPricing) *string {
	if m == nil || m.BillingExpr == nil {
		return nil
	}
	return m.BillingExpr
}

func modeValue(m *pricing.ModelPricing) *string {
	if m == nil {
		return nil
	}
	s := m.BillingMode
	return &s
}

var ratioFields = []pricing.Field{
	pricing.FieldModelRatio, pricing.FieldCompletionRatio, pricing.FieldModelPrice,
	pricing.FieldCacheRatio, pricing.FieldCreateCacheRatio, pricing.FieldImageRatio,
	pricing.FieldAudioRatio, pricing.FieldAudioCompletionRatio,
}

func eqPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func Compute(source, target map[string]*pricing.ModelPricing) []ModelDiff {
	models := map[string]struct{}{}
	for m := range source {
		models[m] = struct{}{}
	}
	for m := range target {
		models[m] = struct{}{}
	}
	var out []ModelDiff
	for model := range models {
		s := source[model]
		t := target[model]
		var fields []FieldDiff
		for _, f := range ratioFields {
			sv, tv := ratioValue(s, f), ratioValue(t, f)
			if !eqPtr(sv, tv) {
				fields = append(fields, FieldDiff{Field: f, Source: sv, Target: tv})
			}
		}
		// BillingMode
		if sv, tv := modeValue(s), modeValue(t); !eqPtr(sv, tv) {
			fields = append(fields, FieldDiff{Field: pricing.FieldBillingMode, Source: sv, Target: tv})
		}
		// BillingExpr
		if sv, tv := exprValue(s), exprValue(t); !eqPtr(sv, tv) {
			fields = append(fields, FieldDiff{Field: pricing.FieldBillingExpr, Source: sv, Target: tv})
		}
		if len(fields) > 0 {
			out = append(out, ModelDiff{Model: model, Fields: fields})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Model < out[j].Model })
	return out
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/diff/ -v`
Expected: 3 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/diff/
git commit -m "feat: diff package comparing two sites' normalized pricing"
```

---

### Task 4: synccalc 包 — 从源站值+勾选项推导 edits

**Files:**
- Create: `backend/internal/synccalc/synccalc.go`
- Create: `backend/internal/synccalc/synccalc_test.go`

**Interfaces:**
- Consumes: `pricing.ModelPricing`, `pricing.Edit`, `pricing.Field` 常量，`diff.ratioValue`/`exprValue`/`modeValue`——但那些是 diff 包私有；因此在 synccalc 内自带一个从 `*ModelPricing` 取某字段字符串值的函数（与 diff 的逻辑一致，独立实现，避免跨包耦合）。
- Produces:
  - `type Selection struct{ Model string ` + "`json:\"model\"`" + `; Field pricing.Field ` + "`json:\"field\"`" + ` }`
  - `func BuildEdits(source map[string]*pricing.ModelPricing, sels []Selection) []pricing.Edit` — 对每个勾选项，取源站该模型该字段的值生成 `pricing.Edit`；源站无该值 → 生成 `Delete:true` 的 edit（把目标站该维度删掉，与源站对齐）。

- [ ] **Step 1: 写失败测试**

`backend/internal/synccalc/synccalc_test.go`:

```go
package synccalc

import (
	"testing"

	"newapiauto/internal/pricing"
)

func fp(v float64) *float64 { return &v }
func sp(s string) *string   { return &s }

func TestBuildEditsRatio(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"gpt-4o": {Model: "gpt-4o", ModelRatio: fp(3)}}
	edits := BuildEdits(src, []Selection{{Model: "gpt-4o", Field: pricing.FieldModelRatio}})
	if len(edits) != 1 || edits[0].Value != "3" || edits[0].Delete {
		t.Fatalf("expected ModelRatio=3 edit, got %+v", edits)
	}
}

func TestBuildEditsDeletesWhenSourceMissing(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"gpt-4o": {Model: "gpt-4o"}} // no ModelRatio
	edits := BuildEdits(src, []Selection{{Model: "gpt-4o", Field: pricing.FieldModelRatio}})
	if len(edits) != 1 || !edits[0].Delete {
		t.Fatalf("expected delete edit when source lacks field, got %+v", edits)
	}
}

func TestBuildEditsExpr(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "tiered_expr", BillingExpr: sp(`tier("base", p*3)`)}}
	edits := BuildEdits(src, []Selection{
		{Model: "c", Field: pricing.FieldBillingExpr},
		{Model: "c", Field: pricing.FieldBillingMode},
	})
	var exprVal, modeVal string
	for _, e := range edits {
		if e.Field == pricing.FieldBillingExpr {
			exprVal = e.Value
		}
		if e.Field == pricing.FieldBillingMode {
			modeVal = e.Value
		}
	}
	if exprVal != `tier("base", p*3)` || modeVal != "tiered_expr" {
		t.Fatalf("wrong expr/mode edits: %+v", edits)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/synccalc/ -v`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现**

`backend/internal/synccalc/synccalc.go`:

```go
package synccalc

import (
	"strconv"

	"newapiauto/internal/pricing"
)

type Selection struct {
	Model string        `json:"model"`
	Field pricing.Field `json:"field"`
}

func fmtFloat(p *float64) (string, bool) {
	if p == nil {
		return "", false
	}
	return strconv.FormatFloat(*p, 'f', -1, 64), true
}

// sourceValue 返回源站某模型某字段的字符串值与是否存在。
func sourceValue(m *pricing.ModelPricing, f pricing.Field) (string, bool) {
	if m == nil {
		return "", false
	}
	switch f {
	case pricing.FieldModelRatio:
		return fmtFloat(m.ModelRatio)
	case pricing.FieldCompletionRatio:
		return fmtFloat(m.CompletionRatio)
	case pricing.FieldModelPrice:
		return fmtFloat(m.ModelPrice)
	case pricing.FieldCacheRatio:
		return fmtFloat(m.CacheRatio)
	case pricing.FieldCreateCacheRatio:
		return fmtFloat(m.CreateCacheRatio)
	case pricing.FieldImageRatio:
		return fmtFloat(m.ImageRatio)
	case pricing.FieldAudioRatio:
		return fmtFloat(m.AudioRatio)
	case pricing.FieldAudioCompletionRatio:
		return fmtFloat(m.AudioCompletionRatio)
	case pricing.FieldBillingMode:
		if m.BillingMode == "" {
			return "", false
		}
		return m.BillingMode, true
	case pricing.FieldBillingExpr:
		if m.BillingExpr == nil {
			return "", false
		}
		return *m.BillingExpr, true
	}
	return "", false
}

// BuildEdits 把勾选项转成写目标站的 edits：取源站该模型该字段的值；源站无该值则生成删除。
func BuildEdits(source map[string]*pricing.ModelPricing, sels []Selection) []pricing.Edit {
	var edits []pricing.Edit
	for _, s := range sels {
		val, ok := sourceValue(source[s.Model], s.Field)
		if !ok {
			edits = append(edits, pricing.Edit{Model: s.Model, Field: s.Field, Delete: true})
			continue
		}
		edits = append(edits, pricing.Edit{Model: s.Model, Field: s.Field, Value: val})
	}
	return edits
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/synccalc/ -v`
Expected: 3 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/synccalc/
git commit -m "feat: synccalc builds edits from source values and selections"
```

---

### Task 5: HTTP API — diff / sync-preview / sync

**Files:**
- Create: `backend/internal/api/sync.go`
- Modify: `backend/internal/api/api.go`（注册 3 条新路由）
- Create: `backend/internal/api/sync_test.go`

**Interfaces:**
- Consumes: `newapi.Client.GetOptions`, `pricing.Parse`, `diff.Compute`, `synccalc.BuildEdits`/`Selection`, `pricing.ApplyEdits`, `editsvc.Apply`, existing `clientForSite`/`idParam`/`writeJSON`/`writeErr`.
- Produces:
  - `POST /api/diff` body `{source_id, target_id}` → `{models: []diff.ModelDiff}`
  - `POST /api/sync/preview` body `{source_id, target_ids, selections}` → 每目标站 `{target_id, target_name, changes: {key: {before, after}}}`（不写，用 `pricing.ApplyEdits` 算 changed，before 取目标当前值）
  - `POST /api/sync` body `{source_id, target_ids, selections}` → 每目标站 `editsvc.Result` 或错误（顺序执行；某目标失败不影响其他目标，各自结果单列）
  - 请求体结构：`type syncReq struct{ SourceID int64 ` + "`json:\"source_id\"`" + `; TargetIDs []int64 ` + "`json:\"target_ids\"`" + `; Selections []synccalc.Selection ` + "`json:\"selections\"`" + ` }`

- [ ] **Step 1: 写失败测试（validate-expr 已有；此处测 diff 路由 wiring 用 httptest 假站）**

`backend/internal/api/sync_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"newapiauto/internal/store"
)

// startFakeSite 返回一个模拟 new-api 的 server，GetOptions 返回给定 ModelRatio JSON。
func startFakeSite(t *testing.T, modelRatio string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"data":    []map[string]string{{"key": "ModelRatio", "value": modelRatio}},
		})
	}))
}

func TestDiffEndpoint(t *testing.T) {
	src := startFakeSite(t, `{"gpt-4o":3}`)
	defer src.Close()
	tgt := startFakeSite(t, `{"gpt-4o":2.5}`)
	defer tgt.Close()

	st, _ := store.Open(":memory:")
	srcID, _ := st.CreateSite(store.Site{Name: "src", BaseURL: src.URL, Token: "t", UserID: "1"})
	tgtID, _ := st.CreateSite(store.Site{Name: "tgt", BaseURL: tgt.URL, Token: "t", UserID: "1"})
	r := NewRouter(st)

	body, _ := json.Marshal(map[string]any{"source_id": srcID, "target_id": tgtID})
	req := httptest.NewRequest("POST", "/api/diff", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("diff status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Models []struct {
			Model  string `json:"model"`
			Fields []struct {
				Field  string  `json:"field"`
				Source *string `json:"source"`
				Target *string `json:"target"`
			} `json:"fields"`
		} `json:"models"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Models) != 1 || resp.Models[0].Model != "gpt-4o" {
		t.Fatalf("expected gpt-4o diff, got %s", w.Body.String())
	}
	if *resp.Models[0].Fields[0].Source != "3" || *resp.Models[0].Fields[0].Target != "2.5" {
		t.Fatalf("wrong diff values: %s", w.Body.String())
	}
}
```

（`NewRouter` 需要能拿到 `store`，与 P1 一致；这里直接用 `NewRouter(st)`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/api/ -run TestDiffEndpoint -v`
Expected: FAIL（`/api/diff` 未注册 → 404）。

- [ ] **Step 3: 实现路由 + handlers**

在 `api.go` 的 `NewRouter` 的 `/api` 组内追加：

```go
		r.Post("/diff", s.postDiff)
		r.Post("/sync/preview", s.postSyncPreview)
		r.Post("/sync", s.postSync)
```

`backend/internal/api/sync.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"newapiauto/internal/diff"
	"newapiauto/internal/editsvc"
	"newapiauto/internal/pricing"
	"newapiauto/internal/synccalc"
)

type syncReq struct {
	SourceID   int64                `json:"source_id"`
	TargetID   int64                `json:"target_id"`
	TargetIDs  []int64              `json:"target_ids"`
	Selections []synccalc.Selection `json:"selections"`
}

func (s *server) loadPricing(ctx context.Context, id int64) (map[string]*pricing.ModelPricing, error) {
	c, _, err := s.clientForSite(id)
	if err != nil {
		return nil, err
	}
	opts, err := c.GetOptions(ctx)
	if err != nil {
		return nil, err
	}
	return pricing.Parse(opts)
}

func (s *server) postDiff(w http.ResponseWriter, r *http.Request) {
	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	src, err := s.loadPricing(ctx, req.SourceID)
	if err != nil {
		writeErr(w, 502, "source: "+err.Error())
		return
	}
	tgt, err := s.loadPricing(ctx, req.TargetID)
	if err != nil {
		writeErr(w, 502, "target: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"models": diff.Compute(src, tgt)})
}

type previewChange struct {
	Before string `json:"before"`
	After  string `json:"after"`
}
type previewResult struct {
	TargetID   int64                    `json:"target_id"`
	TargetName string                   `json:"target_name"`
	Changes    map[string]previewChange `json:"changes"`
	Error      string                   `json:"error,omitempty"`
}

func (s *server) postSyncPreview(w http.ResponseWriter, r *http.Request) {
	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	src, err := s.loadPricing(ctx, req.SourceID)
	if err != nil {
		writeErr(w, 502, "source: "+err.Error())
		return
	}
	edits := synccalc.BuildEdits(src, req.Selections)

	var out []previewResult
	for _, tid := range req.TargetIDs {
		pr := previewResult{TargetID: tid, Changes: map[string]previewChange{}}
		c, site, err := s.clientForSite(tid)
		if err != nil {
			pr.Error = "site not found"
			out = append(out, pr)
			continue
		}
		pr.TargetName = site.Name
		cur, err := c.GetOptions(ctx)
		if err != nil {
			pr.Error = err.Error()
			out = append(out, pr)
			continue
		}
		changed, err := pricing.ApplyEdits(cur, edits)
		if err != nil {
			pr.Error = err.Error()
			out = append(out, pr)
			continue
		}
		for k, after := range changed {
			pr.Changes[k] = previewChange{Before: cur[k], After: after}
		}
		out = append(out, pr)
	}
	writeJSON(w, 200, map[string]any{"targets": out})
}

type syncResult struct {
	TargetID   int64  `json:"target_id"`
	TargetName string `json:"target_name"`
	SnapshotID int64  `json:"snapshot_id,omitempty"`
	Changed    []string `json:"changed_keys,omitempty"`
	Error      string `json:"error,omitempty"`
}

func (s *server) postSync(w http.ResponseWriter, r *http.Request) {
	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	src, err := s.loadPricing(ctx, req.SourceID)
	if err != nil {
		writeErr(w, 502, "source: "+err.Error())
		return
	}
	edits := synccalc.BuildEdits(src, req.Selections)

	var out []syncResult
	for _, tid := range req.TargetIDs {
		sr := syncResult{TargetID: tid}
		c, site, err := s.clientForSite(tid)
		if err != nil {
			sr.Error = "site not found"
			out = append(out, sr)
			continue
		}
		sr.TargetName = site.Name
		res, err := editsvc.Apply(ctx, s.st, tid, site.Name, c, edits)
		if err != nil {
			sr.Error = err.Error()
			sr.SnapshotID = res.SnapshotID
			sr.Changed = res.ChangedKeys
			out = append(out, sr)
			continue
		}
		sr.SnapshotID = res.SnapshotID
		sr.Changed = res.ChangedKeys
		out = append(out, sr)
	}
	writeJSON(w, 200, map[string]any{"targets": out})
}
```

- [ ] **Step 4: 运行测试确认通过 + 全量**

Run: `cd backend && go test ./internal/api/ -v && go test ./...`
Expected: `TestDiffEndpoint` 及既有测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/
git commit -m "feat(api): diff, sync preview, and sync endpoints"
```

---

### Task 6: HTTP API — 快照列表 / 回滚

**Files:**
- Modify: `backend/internal/api/api.go`（注册 2 条路由）
- Create: `backend/internal/api/snapshots.go`
- Create: `backend/internal/api/snapshots_test.go`

**Interfaces:**
- Consumes: `store.ListSnapshots`, `store.GetSnapshot`, `editsvc.Rollback`, `clientForSite`, `idParam`.
- Produces:
  - `GET /api/sites/{id}/snapshots` → `{snapshots: []store.Snapshot}`
  - `POST /api/snapshots/{id}/rollback` → `editsvc.Result`（用快照记录的 site_id 找站点凭据、执行 Rollback）

- [ ] **Step 1: 写失败测试**

`backend/internal/api/snapshots_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"newapiauto/internal/store"
)

func TestListSnapshotsEndpoint(t *testing.T) {
	st, _ := store.Open(":memory:")
	sid, _ := st.CreateSite(store.Site{Name: "s", BaseURL: "http://x", Token: "t", UserID: "1"})
	st.CreateSnapshot(sid, "manual edit", map[string]string{"ModelRatio": `{"a":1}`})
	r := NewRouter(st)

	req := httptest.NewRequest("GET", "/api/sites/1/snapshots", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Snapshots []store.Snapshot `json:"snapshots"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Snapshots) != 1 || resp.Snapshots[0].Reason != "manual edit" {
		t.Fatalf("expected 1 snapshot, got %s", w.Body.String())
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/api/ -run TestListSnapshotsEndpoint -v`
Expected: FAIL（404）。

- [ ] **Step 3: 实现路由 + handlers**

在 `api.go` 的 `/api` 组内追加：

```go
		r.Get("/sites/{id}/snapshots", s.listSnapshots)
		r.Post("/snapshots/{id}/rollback", s.rollbackSnapshot)
```

`backend/internal/api/snapshots.go`:

```go
package api

import (
	"context"
	"net/http"
	"time"

	"newapiauto/internal/editsvc"
	"newapiauto/internal/store"
)

func (s *server) listSnapshots(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	snaps, err := s.st.ListSnapshots(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if snaps == nil {
		snaps = []store.Snapshot{}
	}
	writeJSON(w, 200, map[string]any{"snapshots": snaps})
}

func (s *server) rollbackSnapshot(w http.ResponseWriter, r *http.Request) {
	snapID, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	snap, err := s.st.GetSnapshot(snapID)
	if err != nil {
		writeErr(w, 404, "snapshot not found")
		return
	}
	c, site, err := s.clientForSite(snap.SiteID)
	if err != nil {
		writeErr(w, 404, "site not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	res, err := editsvc.Rollback(ctx, s.st, snap.SiteID, site.Name, c, snapID)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, res)
}
```

- [ ] **Step 4: 运行测试确认通过 + 全量**

Run: `cd backend && go test ./internal/api/ -v && go test ./...`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/
git commit -m "feat(api): list snapshots and rollback endpoints"
```

---

### Task 7: 前端 api.js — 补同步/快照方法

**Files:**
- Modify: `frontend/src/api.js`

**Interfaces:**
- Produces（在现有导出基础上追加）：
  - `getDiff(sourceId, targetId)` → POST `/api/diff` `{source_id, target_id}`
  - `syncPreview(sourceId, targetIds, selections)` → POST `/api/sync/preview`
  - `runSync(sourceId, targetIds, selections)` → POST `/api/sync`
  - `getSnapshots(siteId)` → GET `/api/sites/:id/snapshots`
  - `rollbackSnapshot(snapshotId)` → POST `/api/snapshots/:id/rollback`

- [ ] **Step 1: 追加导出**

在 `frontend/src/api.js` 末尾追加：

```js
export const getDiff = (sourceId, targetId) =>
  req('POST', '/api/diff', { source_id: sourceId, target_id: targetId })
export const syncPreview = (sourceId, targetIds, selections) =>
  req('POST', '/api/sync/preview', { source_id: sourceId, target_ids: targetIds, selections })
export const runSync = (sourceId, targetIds, selections) =>
  req('POST', '/api/sync', { source_id: sourceId, target_ids: targetIds, selections })
export const getSnapshots = (siteId) => req('GET', `/api/sites/${siteId}/snapshots`)
export const rollbackSnapshot = (snapshotId) => req('POST', `/api/snapshots/${snapshotId}/rollback`)
```

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build`
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(frontend): api helpers for diff, sync, snapshots, rollback"
```

---

### Task 8: 前端 — 同步页

**Files:**
- Create: `frontend/src/pages/Sync.jsx`
- Modify: `frontend/src/App.jsx`（加"同步"tab）

**Interfaces:**
- Consumes: `getSites, getDiff, syncPreview, runSync`（`../api`）。
- Produces: 选源站 + 目标站（多选）→ 对每个目标站调 `getDiff(source, target)` 合并成一张表（行=有差异的 模型|维度；列=源值 + 各目标值）→ 勾选要同步的 (model,field) → "预览"（调 syncPreview 展示每目标站 before/after）→ "确认同步"（调 runSync）→ 结果。

- [ ] **Step 1: 实现 App tab**

在 `frontend/src/App.jsx`：import `Sync from './pages/Sync'`；在 tab 按钮区加一个 `<button onClick={() => setTab('sync')} disabled={tab === 'sync'}>同步</button>`；渲染区改为：

```jsx
      {tab === 'sites' && <Sites />}
      {tab === 'editor' && <Editor />}
      {tab === 'sync' && <Sync />}
```

（把原来的三元表达式改成上面三行。）

- [ ] **Step 2: 实现 Sync 页**

`frontend/src/pages/Sync.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { getSites, getDiff, syncPreview, runSync } from '../api'

export default function Sync() {
  const [sites, setSites] = useState([])
  const [sourceId, setSourceId] = useState('')
  const [targetIds, setTargetIds] = useState([])
  const [rows, setRows] = useState([]) // {model, field, source, targets: {tid: value|null}}
  const [sel, setSel] = useState({})   // `${model}|${field}` -> true
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => { getSites().then(setSites) }, [])

  const toggleTarget = (id) =>
    setTargetIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const loadDiff = async () => {
    setMsg('计算差异中...'); setRows([]); setSel({}); setPreview(null); setResult(null)
    try {
      // 对每个目标站拉 diff，按 model|field 合并
      const merged = {} // key -> {model, field, source, targets:{}}
      for (const tid of targetIds) {
        const d = await getDiff(Number(sourceId), tid)
        for (const m of d.models || []) {
          for (const f of m.fields) {
            const key = `${m.model}|${f.field}`
            if (!merged[key]) merged[key] = { model: m.model, field: f.field, source: f.source, targets: {} }
            merged[key].targets[tid] = f.target
          }
        }
      }
      setRows(Object.values(merged).sort((a, b) => (a.model + a.field).localeCompare(b.model + b.field)))
      setMsg('')
    } catch (e) { setMsg('差异计算失败: ' + e.message) }
  }

  const selections = () =>
    Object.keys(sel).filter((k) => sel[k]).map((k) => {
      const [model, field] = k.split('|')
      return { model, field }
    })

  const doPreview = async () => {
    const s = selections()
    if (!s.length) { setMsg('未勾选任何项'); return }
    setMsg('生成预览...')
    try { const p = await syncPreview(Number(sourceId), targetIds, s); setPreview(p.targets); setMsg('') }
    catch (e) { setMsg('预览失败: ' + e.message) }
  }

  const doSync = async () => {
    const s = selections()
    if (!s.length) return
    setMsg('同步中...')
    try {
      const r = await runSync(Number(sourceId), targetIds, s)
      setResult(r.targets); setMsg('同步完成'); setPreview(null)
    } catch (e) { setMsg('同步失败: ' + e.message) }
  }

  const nameOf = (id) => sites.find((x) => x.id === id)?.name || id

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <b>源站：</b>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">选择源站...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 10 }}>
        <b>目标站：</b>
        {sites.filter((s) => String(s.id) !== String(sourceId)).map((s) => (
          <label key={s.id} style={{ marginRight: 12 }}>
            <input type="checkbox" checked={targetIds.includes(s.id)}
              onChange={() => toggleTarget(s.id)} /> {s.name}
          </label>
        ))}
      </div>
      <button onClick={loadDiff} disabled={!sourceId || !targetIds.length}>计算差异</button>{' '}
      <button onClick={doPreview} disabled={!rows.length}>预览所选</button>{' '}
      <button onClick={doSync} disabled={!preview}>确认同步</button>
      {msg && <div style={{ padding: 8, background: '#eef', margin: '10px 0' }}>{msg}</div>}

      {rows.length > 0 && (
        <table border="1" cellPadding="4" style={{ borderCollapse: 'collapse', fontSize: 13, marginTop: 10 }}>
          <thead>
            <tr>
              <th>选</th><th>模型</th><th>维度</th><th>源值</th>
              {targetIds.map((tid) => <th key={tid}>{nameOf(tid)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.model}|${row.field}`
              return (
                <tr key={key}>
                  <td><input type="checkbox" checked={!!sel[key]}
                    onChange={(e) => setSel({ ...sel, [key]: e.target.checked })} /></td>
                  <td>{row.model}</td><td>{row.field}</td>
                  <td>{row.source ?? <i>无</i>}</td>
                  {targetIds.map((tid) => (
                    <td key={tid} style={{ color: row.targets[tid] === row.source ? '#888' : '#b00' }}>
                      {row.targets[tid] ?? <i>无</i>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <h3>预览（before → after）</h3>
          {preview.map((t) => (
            <div key={t.target_id} style={{ marginBottom: 8 }}>
              <b>{t.target_name || t.target_id}</b>{t.error && <span style={{ color: 'red' }}> {t.error}</span>}
              <ul>
                {Object.entries(t.changes || {}).map(([k, c]) => (
                  <li key={k}><code>{k}</code>: 改动已就绪（{Object.keys(t.changes).length} 个 option）</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          <h3>同步结果</h3>
          {result.map((t) => (
            <div key={t.target_id}>
              <b>{t.target_name || t.target_id}</b>：
              {t.error
                ? <span style={{ color: 'red' }}>失败 {t.error}（快照 #{t.snapshot_id || '-'}）</span>
                : <span style={{ color: 'green' }}>成功，改动 {t.changed_keys?.length || 0} 个 option（快照 #{t.snapshot_id}）</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npm run build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/Sync.jsx
git commit -m "feat(frontend): multi-site sync page (diff, select, preview, push)"
```

---

### Task 9: 前端 — 历史/回滚页

**Files:**
- Create: `frontend/src/pages/History.jsx`
- Modify: `frontend/src/App.jsx`（加"历史"tab）

**Interfaces:**
- Consumes: `getSites, getSnapshots, rollbackSnapshot`（`../api`）。
- Produces: 选站 → 列出该站快照（id、时间、reason、涉及的 option key）→ 每条"回滚"按钮（调 rollbackSnapshot，确认后执行）。

- [ ] **Step 1: 实现 App tab**

`App.jsx`：import `History from './pages/History'`；加按钮 `<button onClick={() => setTab('history')} disabled={tab === 'history'}>历史</button>`；渲染区加 `{tab === 'history' && <History />}`。

- [ ] **Step 2: 实现 History 页**

`frontend/src/pages/History.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { getSites, getSnapshots, rollbackSnapshot } from '../api'

export default function History() {
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [snaps, setSnaps] = useState([])
  const [msg, setMsg] = useState('')

  useEffect(() => { getSites().then(setSites) }, [])

  const load = async (id) => {
    setSiteId(id); setMsg('加载中...')
    try { const r = await getSnapshots(id); setSnaps(r.snapshots || []); setMsg('') }
    catch (e) { setMsg(e.message) }
  }

  const rollback = async (snapId) => {
    if (!window.confirm(`确认回滚到快照 #${snapId}？会把该站相关价格还原为快照时的旧值。`)) return
    setMsg('回滚中...')
    try {
      const r = await rollbackSnapshot(snapId)
      setMsg(`回滚成功，还原 ${r.changed_keys?.length || 0} 个 option`)
      load(siteId)
    } catch (e) { setMsg('回滚失败: ' + e.message) }
  }

  const fmtTime = (t) => new Date(t * 1000).toLocaleString()

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <select value={siteId} onChange={(e) => load(Number(e.target.value))}>
          <option value="">选择站点...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {msg && <div style={{ padding: 8, background: '#eef', marginBottom: 10 }}>{msg}</div>}
      <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead><tr><th>快照ID</th><th>时间</th><th>原因</th><th>涉及option</th><th>操作</th></tr></thead>
        <tbody>
          {snaps.map((s) => (
            <tr key={s.id}>
              <td>#{s.id}</td>
              <td>{fmtTime(s.created_at)}</td>
              <td>{s.reason}</td>
              <td>{Object.keys(s.payload || {}).join(', ')}</td>
              <td><button onClick={() => rollback(s.id)}>回滚</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npm run build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/History.jsx
git commit -m "feat(frontend): history page with per-snapshot rollback"
```

---

### Task 10: P1 遗留 Minor 清理

**Files:**
- Modify: `backend/internal/pricing/parse_test.go`（删除未用的 `f`）
- Modify: `backend/internal/store/store.go`（`ListSnapshots`/`ListAudit`/`AddAudit` 的 json 错误改为记 SysLog 而非静默丢弃；用标准库 `log`）
- Modify: `backend/internal/api/sites.go`（`clientForSite` 区分 not-found 与 DB error：not-found → 404，其余 → 500）
- Modify: `backend/internal/pricing/edit_test.go`（补两个测试：delete 不存在的模型、未知 field 报错）

**Interfaces:**
- Consumes: existing.
- Produces: 无新导出；仅健壮性与测试覆盖。

- [ ] **Step 1: 补 pricing 边界测试（先失败/先验证现状）**

在 `edit_test.go` 追加：

```go
func TestApplyEditsDeleteNonexistentModel(t *testing.T) {
	cur := OptionSet{KeyModelRatio: `{"gpt-4o":2.5}`}
	changed, err := ApplyEdits(cur, []Edit{{Model: "ghost", Field: FieldModelRatio, Delete: true}})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 0 {
		t.Fatalf("deleting a nonexistent model should be a no-op, got %+v", changed)
	}
}

func TestApplyEditsUnknownField(t *testing.T) {
	_, err := ApplyEdits(OptionSet{}, []Edit{{Model: "m", Field: Field("Bogus"), Value: "1"}})
	if err == nil {
		t.Fatal("expected error for unknown field")
	}
}
```

Run: `cd backend && go test ./internal/pricing/ -run 'TestApplyEditsDeleteNonexistentModel|TestApplyEditsUnknownField' -v`
Expected: PASS（现有实现已支持；这是补覆盖）。若某个 FAIL，说明实现有缺口——修实现使其通过。

- [ ] **Step 2: 删除未用 helper**

在 `backend/internal/pricing/parse_test.go` 删除未使用的 `func f(v float64) *float64 { return &v }`（若其他测试用到它则保留；确认 `grep -n "f(" parse_test.go` 无调用后再删）。

Run: `cd backend && go test ./internal/pricing/ -v`
Expected: 仍全部 PASS。

- [ ] **Step 3: store 记录 json 错误**

在 `backend/internal/store/store.go` 顶部 import 加 `"log"`。把 `ListSnapshots` 中 `json.Unmarshal([]byte(payload), &snap.Payload)` 改为：

```go
		if err := json.Unmarshal([]byte(payload), &snap.Payload); err != nil {
			log.Printf("store: bad snapshot payload id=%d: %v", snap.ID, err)
		}
```

`ListAudit` 中两处 `json.Unmarshal` 同理各加错误日志（`log.Printf("store: bad audit keys/models id=%d: %v", a.ID, err)`）。`AddAudit` 中 `kb, _ := json.Marshal(...)` 改为检查错误并 `log.Printf` （marshal []string 实际不会失败，但保持一致）。

Run: `cd backend && go test ./internal/store/ -v`
Expected: PASS（行为不变，仅加日志）。

- [ ] **Step 4: sites.go 区分 404/500**

在 `backend/internal/api/sites.go`，import 加 `"database/sql"` 和 `"errors"`。把 `clientForSite` 改为返回可区分的错误，并在调用点区分。最简做法：在 `testSite`/`getPricing`/`putPricing`/其它调用 `clientForSite` 的 handler 里，判断错误：

```go
	c, site, err := s.clientForSite(id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, 404, "site not found")
		} else {
			writeErr(w, 500, err.Error())
		}
		return
	}
```

把所有调用 `clientForSite` 后原来一律 404 的分支，统一改成上面这段（`testSite`、`getPricing`、`putPricing`，以及 sync.go 里 loadPricing 的调用点若直接暴露也同理——但 sync 的 target 错误走的是每目标结果，不改）。`clientForSite` 本身不变（它已把 `store.GetSite` 的错误原样返回，而 `GetSite` 用 `QueryRow().Scan` 在无行时返回 `sql.ErrNoRows`）。

Run: `cd backend && go test ./internal/api/ -v`
Expected: 既有测试仍 PASS（找不到站点仍是 404，因为 GetSite 返回 sql.ErrNoRows）。

- [ ] **Step 5: 全量 + Commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: 全绿。

```bash
git add backend/internal/pricing/ backend/internal/store/ backend/internal/api/
git commit -m "chore: address P1 deferred minors (test coverage, error logging, 404/500)"
```

---

### Task 11: 集成验证（新加坡 daily，需凭据）

> **前置条件（需用户提供）：** 新加坡 daily 的 `base_url` + 管理员 `token` + 管理员 `user_id`。若暂无，跳过实写，仅做只读 diff 验证并标注 TODO。

**Files:**
- Modify: `backend/scripts/integration_readme.md`（追加 P2 验证记录）

- [ ] **Step 1: 只读 diff 验证**

启动后端+前端，在站点页加两个站（可临时都用新加坡 daily 自己 vs 自己，diff 应为空；或新加坡 daily 作源、另一测试站作目标）。同步页选源+目标 → 计算差异 → 核对差异表内容与实库一致。
Expected: 自己 vs 自己无差异；不同站有差异且值正确。

- [ ] **Step 2: 单模型同步 + 快照 + 回滚往返**

选一个安全测试模型，勾选其 `ModelRatio` → 预览（before/after 正确）→ 确认同步 → 结果显示成功+快照ID。到历史页对该快照点"回滚" → 确认目标站该模型 ModelRatio 恢复原值。
用 curl 交叉核对目标站 `GET /api/option/` 中该模型的值在"同步后"和"回滚后"的变化。
Expected: 同步后为源站值；回滚后恢复原值。

- [ ] **Step 3: 记录并 Commit**

把 Step 1/2 的实际输出记入 `backend/scripts/integration_readme.md`。

```bash
git add backend/scripts/integration_readme.md
git commit -m "test: P2 sync integration verification on singapore daily"
```

---

## Self-Review

**1. Spec coverage（对照 spec §7-§9）：**
- §7 数据流（读→diff→合并→快照→逐key写→回滚）→ Task 3（diff）、Task 4（synccalc）、Task 5（sync）、Task 2/6（回滚）。✅
- §8 安全流程（预览+确认+快照+失败即停+审计+回滚）→ Task 5（sync 复用 editsvc.Apply 的校验+快照+失败即停）、Task 5 preview、Task 2/6 回滚。✅
- §9 接口 diff/sync/snapshots/rollback/audit → Task 5/6。（audit 列表 UI 未做——仅存储；P3 或按需再加，非本期阻塞。）✅
- P2-PREREQUISITES：确定性写序 + 每站写锁 → Task 1；回滚 → Task 2/6；P1 遗留 minor → Task 10。✅
- §10 前端 Sync/History 页 → Task 8/9。✅

**2. Placeholder scan：** 无 TBD/TODO 残留。Task 11 为需凭据的集成验证，已标注前置条件与降级路径。Task 10 Step 2 的删除动作附带了"确认无调用再删"的判据。无占位代码块。

**3. Type consistency：** `synccalc.Selection{Model,Field}` 与前端发送的 `{model,field}` 一致（JSON tag）；`diff.ModelDiff{Model,Fields:[]FieldDiff{Field,Source,Target}}` 与前端 Sync 页解析一致；sync/preview/rollback 的响应结构与前端解析字段（`target_id`/`target_name`/`changed_keys`/`snapshot_id`/`changes{before,after}`）一致；复用 P1 的 `editsvc.Apply`、`pricing.ApplyEdits`、`store.Snapshot`（含 `payload`/`created_at`/`reason` json tag，History 页据此渲染）。`editsvc.Apply` 现按 `orderedKeys` 写入（Task 1），sync 通过它获得确定性写序与写锁——无需在 sync 层重复。✅
