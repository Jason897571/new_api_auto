# P1: 单站价格编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Go 后端 + React 前端，实现「管理多个 new-api 站点凭据」和「读取/编辑单个站点的模型价格与阶梯计价（带表达式校验、快照、写入）」，并在新加坡 daily 站验证跑通。

**Architecture:** Go 后端通过 new-api 官方 `GET/PUT /api/option/` 读写价格（不直连数据库），把 `options` 表的价格 JSON 解析为规范化的按模型结构；阶梯表达式用从 new-api 拷贝进本项目的 `billingexpr` 引擎做进程内 smoke test 校验；工具自身的站点/快照/审计存本地 SQLite。前端 React/Vite 提供站点管理与单站编辑页。

**Tech Stack:** Go 1.25（`net/http` + `github.com/go-chi/chi/v5`）、`modernc.org/sqlite`（纯 Go）、拷贝的 `billingexpr`（依赖 `github.com/expr-lang/expr`、`github.com/tidwall/gjson`）、React + Vite。

## Global Constraints

- 所有价格读写必须走 new-api 官方接口 `GET /api/option/` 与 `PUT /api/option/`，**禁止直连数据库**（保证内存缓存失效被触发）。
- 每次调用 new-api 管理接口必须带两个头：`Authorization: <token>` 和 `New-Api-User: <user_id>`。
- 覆盖的 option key 仅限：`ModelRatio`、`CompletionRatio`、`ModelPrice`、`CacheRatio`、`CreateCacheRatio`、`ImageRatio`、`AudioRatio`、`AudioCompletionRatio`、`billing_setting.billing_mode`、`billing_setting.billing_expr`。**不含** 任何 `GroupRatio`。
- 每个 option 的 value 是「一整张 JSON map」；写入前必须**快照**目标站被改动 key 的当前完整值。
- 推送/保存任何 `billing_setting.billing_expr` 前，必须先用本地 `billingexpr` 做 smoke test（编译 + 样本 token 向量 `0/1k/100k/1M` 跑通且结果非负）；不通过则中止。
- 阶梯表达式的 smoke test 逻辑必须与 new-api `setting/billing_setting/tiered_billing.go` 的 `smokeTestExpr` 一致（相同向量、相同两组 RequestInput、`result < 0` 视为失败）。
- Go module 路径：`newapiauto`（即 `import "newapiauto/internal/..."`）。
- 敏感值（站点 token）仅存本地 SQLite，不写日志。

---

### Task 1: 后端项目骨架 + 拷贝 billingexpr + 可编译

**Files:**
- Create: `backend/go.mod`
- Create: `backend/internal/billingexpr/` ← 从 `/Users/jason/Desktop/project/new-api/pkg/billingexpr/` 拷贝 5 个非测试文件：`compile.go`、`run.go`、`settle.go`、`round.go`、`types.go`
- Create: `backend/internal/billingexpr/smoke_check_test.go`

**Interfaces:**
- Produces: package `billingexpr`，公开函数 `RunExprWithRequest(exprStr string, params billingexpr.TokenParams, request billingexpr.RequestInput) (float64, billingexpr.TraceResult, error)`；类型 `billingexpr.TokenParams{P,C,Len,CR,CC,CC1h,Img,ImgO,AI,AO float64}`、`billingexpr.RequestInput{Headers map[string]string; Body []byte}`。

- [ ] **Step 1: 初始化 module 并拷贝 billingexpr**

```bash
mkdir -p backend/internal/billingexpr
cd backend
go mod init newapiauto
# 拷贝表达式引擎（仅非测试文件），改包内不需要改动，因为包名保持 billingexpr
cp /Users/jason/Desktop/project/new-api/pkg/billingexpr/compile.go internal/billingexpr/
cp /Users/jason/Desktop/project/new-api/pkg/billingexpr/run.go internal/billingexpr/
cp /Users/jason/Desktop/project/new-api/pkg/billingexpr/settle.go internal/billingexpr/
cp /Users/jason/Desktop/project/new-api/pkg/billingexpr/round.go internal/billingexpr/
cp /Users/jason/Desktop/project/new-api/pkg/billingexpr/types.go internal/billingexpr/
```

- [ ] **Step 2: 写一个冒烟测试确认拷贝的引擎能跑**

`backend/internal/billingexpr/smoke_check_test.go`:

```go
package billingexpr

import "testing"

func TestCopiedEngineRuns(t *testing.T) {
	got, _, err := RunExprWithRequest(`tier("base", p*2 + c*4)`,
		TokenParams{P: 1000, C: 1000}, RequestInput{})
	if err != nil {
		t.Fatalf("run failed: %v", err)
	}
	if got != 6000 {
		t.Fatalf("got %v, want 6000", got)
	}
}
```

- [ ] **Step 3: 拉依赖并运行测试**

Run:
```bash
cd backend && go mod tidy && go test ./internal/billingexpr/ -run TestCopiedEngineRuns -v
```
Expected: `go mod tidy` 自动加入 `github.com/expr-lang/expr` 与 `github.com/tidwall/gjson`；测试 PASS（输出 6000）。

- [ ] **Step 4: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/billingexpr/
git commit -m "chore: scaffold Go backend and vendor billingexpr engine"
```

---

### Task 2: 表达式校验包 validate

**Files:**
- Create: `backend/internal/validate/validate.go`
- Create: `backend/internal/validate/validate_test.go`

**Interfaces:**
- Consumes: `billingexpr.RunExprWithRequest`, `billingexpr.TokenParams`, `billingexpr.RequestInput`.
- Produces: `func Expr(exprStr string) error` — 表达式合法且所有样本向量结果非负时返回 nil，否则返回带向量信息的 error。

- [ ] **Step 1: 写失败测试**

`backend/internal/validate/validate_test.go`:

```go
package validate

import "testing"

func TestExprValid(t *testing.T) {
	if err := Expr(`tier("base", p*3 + c*15 + cr*0.3)`); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
}

func TestExprSyntaxError(t *testing.T) {
	if err := Expr(`tier("base", p*3 +`); err == nil {
		t.Fatal("expected compile error, got nil")
	}
}

func TestExprNegativeRejected(t *testing.T) {
	// 负系数会在样本向量下产生负值，必须被拒绝
	if err := Expr(`tier("base", p*-1)`); err == nil {
		t.Fatal("expected negative-result error, got nil")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/validate/ -v`
Expected: FAIL（`Expr` 未定义 / 编译不过）。

- [ ] **Step 3: 实现（复刻 new-api 的 smokeTestExpr）**

`backend/internal/validate/validate.go`:

```go
package validate

import (
	"fmt"

	"newapiauto/internal/billingexpr"
)

// Expr 复刻 new-api setting/billing_setting/tiered_billing.go 的 smokeTestExpr：
// 用固定样本向量编译并运行表达式，任一运行失败或结果为负都判为非法。
func Expr(exprStr string) error {
	vectors := []billingexpr.TokenParams{
		{P: 0, C: 0, Len: 0},
		{P: 1000, C: 1000, Len: 1000},
		{P: 100000, C: 100000, Len: 100000},
		{P: 1000000, C: 1000000, Len: 1000000},
	}
	requests := []billingexpr.RequestInput{
		{},
		{
			Headers: map[string]string{"anthropic-beta": "fast-mode-2026-02-01"},
			Body:    []byte(`{"service_tier":"fast","stream_options":{"include_usage":true},"messages":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21]}`),
		},
	}
	for _, v := range vectors {
		for _, req := range requests {
			result, _, err := billingexpr.RunExprWithRequest(exprStr, v, req)
			if err != nil {
				return fmt.Errorf("vector {p=%g, c=%g}: run failed: %w", v.P, v.C, err)
			}
			if result < 0 {
				return fmt.Errorf("vector {p=%g, c=%g}: result %f < 0", v.P, v.C, result)
			}
		}
	}
	return nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/validate/ -v`
Expected: 三个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/validate/
git commit -m "feat: add tiered expression validator (smoke test parity)"
```

---

### Task 3: 规范化价格模型 pricing — 类型与 Parse

**Files:**
- Create: `backend/internal/pricing/pricing.go`
- Create: `backend/internal/pricing/parse_test.go`

**Interfaces:**
- Produces:
  - 常量 `KeyModelRatio, KeyCompletionRatio, KeyModelPrice, KeyCacheRatio, KeyCreateCacheRatio, KeyImageRatio, KeyAudioRatio, KeyAudioCompletionRatio, KeyBillingMode="billing_setting.billing_mode", KeyBillingExpr="billing_setting.billing_expr"`
  - `var RatioKeys []string`（8 个 float 型 key）、`var ManagedKeys []string`（全部 10 个）
  - `type OptionSet map[string]string`（option key → 原始 JSON 值字符串）
  - `type ModelPricing struct{...}`（见下）
  - `func Parse(opts OptionSet) (map[string]*ModelPricing, error)`

- [ ] **Step 1: 写失败测试**

`backend/internal/pricing/parse_test.go`:

```go
package pricing

import "testing"

func f(v float64) *float64 { return &v }

func TestParseRatioAndTiered(t *testing.T) {
	opts := OptionSet{
		KeyModelRatio:      `{"gpt-4o":2.5,"claude-x":3}`,
		KeyCompletionRatio: `{"gpt-4o":4}`,
		KeyBillingMode:     `{"claude-x":"tiered_expr"}`,
		KeyBillingExpr:     `{"claude-x":"tier(\"base\", p*3)"}`,
	}
	got, err := Parse(opts)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got["gpt-4o"].BillingMode != "ratio" {
		t.Errorf("gpt-4o mode = %q, want ratio", got["gpt-4o"].BillingMode)
	}
	if got["gpt-4o"].ModelRatio == nil || *got["gpt-4o"].ModelRatio != 2.5 {
		t.Errorf("gpt-4o ModelRatio wrong: %+v", got["gpt-4o"].ModelRatio)
	}
	if got["gpt-4o"].CompletionRatio == nil || *got["gpt-4o"].CompletionRatio != 4 {
		t.Errorf("gpt-4o CompletionRatio wrong")
	}
	if got["claude-x"].BillingMode != "tiered_expr" {
		t.Errorf("claude-x mode = %q, want tiered_expr", got["claude-x"].BillingMode)
	}
	if got["claude-x"].BillingExpr == nil || *got["claude-x"].BillingExpr != `tier("base", p*3)` {
		t.Errorf("claude-x expr wrong: %v", got["claude-x"].BillingExpr)
	}
}

func TestParseInvalidJSON(t *testing.T) {
	if _, err := Parse(OptionSet{KeyModelRatio: `{bad`}); err == nil {
		t.Fatal("expected error on bad JSON")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/pricing/ -v`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现类型与 Parse**

`backend/internal/pricing/pricing.go`:

```go
package pricing

import (
	"encoding/json"
	"fmt"
)

const (
	KeyModelRatio           = "ModelRatio"
	KeyCompletionRatio      = "CompletionRatio"
	KeyModelPrice           = "ModelPrice"
	KeyCacheRatio           = "CacheRatio"
	KeyCreateCacheRatio     = "CreateCacheRatio"
	KeyImageRatio           = "ImageRatio"
	KeyAudioRatio           = "AudioRatio"
	KeyAudioCompletionRatio = "AudioCompletionRatio"
	KeyBillingMode          = "billing_setting.billing_mode"
	KeyBillingExpr          = "billing_setting.billing_expr"
)

// RatioKeys 是 value 为 map[string]float64 的 option key。
var RatioKeys = []string{
	KeyModelRatio, KeyCompletionRatio, KeyModelPrice, KeyCacheRatio,
	KeyCreateCacheRatio, KeyImageRatio, KeyAudioRatio, KeyAudioCompletionRatio,
}

// ManagedKeys 是本工具读写的全部 option key。
var ManagedKeys = append(append([]string{}, RatioKeys...), KeyBillingMode, KeyBillingExpr)

// OptionSet: option key -> 原始 JSON 值字符串（new-api 返回的形式）。
type OptionSet map[string]string

type ModelPricing struct {
	Model                string   `json:"model"`
	BillingMode          string   `json:"billing_mode"` // "ratio" | "tiered_expr"
	ModelRatio           *float64 `json:"model_ratio,omitempty"`
	CompletionRatio      *float64 `json:"completion_ratio,omitempty"`
	ModelPrice           *float64 `json:"model_price,omitempty"`
	CacheRatio           *float64 `json:"cache_ratio,omitempty"`
	CreateCacheRatio     *float64 `json:"create_cache_ratio,omitempty"`
	ImageRatio           *float64 `json:"image_ratio,omitempty"`
	AudioRatio           *float64 `json:"audio_ratio,omitempty"`
	AudioCompletionRatio *float64 `json:"audio_completion_ratio,omitempty"`
	BillingExpr          *string  `json:"billing_expr,omitempty"`
}

// ratioFieldSetters 把 ratio key 映射到 ModelPricing 上对应字段的写入器。
func ratioFieldSetter(mp *ModelPricing, key string) func(float64) {
	switch key {
	case KeyModelRatio:
		return func(v float64) { mp.ModelRatio = &v }
	case KeyCompletionRatio:
		return func(v float64) { mp.CompletionRatio = &v }
	case KeyModelPrice:
		return func(v float64) { mp.ModelPrice = &v }
	case KeyCacheRatio:
		return func(v float64) { mp.CacheRatio = &v }
	case KeyCreateCacheRatio:
		return func(v float64) { mp.CreateCacheRatio = &v }
	case KeyImageRatio:
		return func(v float64) { mp.ImageRatio = &v }
	case KeyAudioRatio:
		return func(v float64) { mp.AudioRatio = &v }
	case KeyAudioCompletionRatio:
		return func(v float64) { mp.AudioCompletionRatio = &v }
	}
	return nil
}

func ensure(m map[string]*ModelPricing, model string) *ModelPricing {
	if m[model] == nil {
		m[model] = &ModelPricing{Model: model, BillingMode: "ratio"}
	}
	return m[model]
}

// Parse 把原始 OptionSet 解析为 model -> *ModelPricing。
func Parse(opts OptionSet) (map[string]*ModelPricing, error) {
	out := make(map[string]*ModelPricing)

	for _, key := range RatioKeys {
		raw, ok := opts[key]
		if !ok || raw == "" {
			continue
		}
		var m map[string]float64
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			return nil, fmt.Errorf("parse %s: %w", key, err)
		}
		for model, v := range m {
			ratioFieldSetter(ensure(out, model), key)(v)
		}
	}

	if raw := opts[KeyBillingMode]; raw != "" {
		var m map[string]string
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			return nil, fmt.Errorf("parse %s: %w", KeyBillingMode, err)
		}
		for model, mode := range m {
			ensure(out, model).BillingMode = mode
		}
	}
	if raw := opts[KeyBillingExpr]; raw != "" {
		var m map[string]string
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			return nil, fmt.Errorf("parse %s: %w", KeyBillingExpr, err)
		}
		for model, expr := range m {
			e := expr
			ensure(out, model).BillingExpr = &e
		}
	}
	return out, nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/pricing/ -v`
Expected: 两个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/pricing/pricing.go backend/internal/pricing/parse_test.go
git commit -m "feat: pricing model types and Parse"
```

---

### Task 4: pricing — Edit 与 ApplyEdits

**Files:**
- Create: `backend/internal/pricing/edit.go`
- Create: `backend/internal/pricing/edit_test.go`

**Interfaces:**
- Consumes: `OptionSet`, 常量 keys（Task 3）。
- Produces:
  - `type Field string` 及常量 `FieldModelRatio, FieldCompletionRatio, FieldModelPrice, FieldCacheRatio, FieldCreateCacheRatio, FieldImageRatio, FieldAudioRatio, FieldAudioCompletionRatio, FieldBillingMode, FieldBillingExpr`
  - `type Edit struct{ Model string; Field Field; Value string; Delete bool }`
  - `func ApplyEdits(current OptionSet, edits []Edit) (changed map[string]string, err error)` — 仅返回值发生变化的 option key → 新的完整 JSON 字符串。

- [ ] **Step 1: 写失败测试**

`backend/internal/pricing/edit_test.go`:

```go
package pricing

import (
	"encoding/json"
	"testing"
)

func TestApplyEditsRatio(t *testing.T) {
	cur := OptionSet{KeyModelRatio: `{"gpt-4o":2.5,"other":1}`}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "gpt-4o", Field: FieldModelRatio, Value: "3.0"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 1 {
		t.Fatalf("expected 1 changed key, got %d", len(changed))
	}
	var m map[string]float64
	json.Unmarshal([]byte(changed[KeyModelRatio]), &m)
	if m["gpt-4o"] != 3.0 || m["other"] != 1 {
		t.Fatalf("merge wrong: %+v", m)
	}
}

func TestApplyEditsDelete(t *testing.T) {
	cur := OptionSet{KeyModelPrice: `{"dall-e-3":0.04,"veo":0.6}`}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "dall-e-3", Field: FieldModelPrice, Delete: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]float64
	json.Unmarshal([]byte(changed[KeyModelPrice]), &m)
	if _, ok := m["dall-e-3"]; ok {
		t.Fatal("dall-e-3 should be deleted")
	}
	if m["veo"] != 0.6 {
		t.Fatal("veo should remain")
	}
}

func TestApplyEditsTiered(t *testing.T) {
	cur := OptionSet{}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "claude-x", Field: FieldBillingMode, Value: "tiered_expr"},
		{Model: "claude-x", Field: FieldBillingExpr, Value: `tier("base", p*3)`},
	})
	if err != nil {
		t.Fatal(err)
	}
	var mode map[string]string
	json.Unmarshal([]byte(changed[KeyBillingMode]), &mode)
	if mode["claude-x"] != "tiered_expr" {
		t.Fatalf("mode wrong: %+v", mode)
	}
	var expr map[string]string
	json.Unmarshal([]byte(changed[KeyBillingExpr]), &expr)
	if expr["claude-x"] != `tier("base", p*3)` {
		t.Fatalf("expr wrong: %+v", expr)
	}
}

func TestApplyEditsNoopWhenSame(t *testing.T) {
	cur := OptionSet{KeyModelRatio: `{"gpt-4o":2.5}`}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "gpt-4o", Field: FieldModelRatio, Value: "2.5"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 0 {
		t.Fatalf("expected no change, got %+v", changed)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/pricing/ -run TestApplyEdits -v`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现**

`backend/internal/pricing/edit.go`:

```go
package pricing

import (
	"encoding/json"
	"fmt"
	"strconv"
)

type Field string

const (
	FieldModelRatio           Field = "ModelRatio"
	FieldCompletionRatio      Field = "CompletionRatio"
	FieldModelPrice           Field = "ModelPrice"
	FieldCacheRatio           Field = "CacheRatio"
	FieldCreateCacheRatio     Field = "CreateCacheRatio"
	FieldImageRatio           Field = "ImageRatio"
	FieldAudioRatio           Field = "AudioRatio"
	FieldAudioCompletionRatio Field = "AudioCompletionRatio"
	FieldBillingMode          Field = "BillingMode"
	FieldBillingExpr          Field = "BillingExpr"
)

// fieldToKey 把编辑字段映射到 option key，并标明是否为 float 型 map。
func fieldToKey(f Field) (key string, isFloat bool, ok bool) {
	switch f {
	case FieldModelRatio:
		return KeyModelRatio, true, true
	case FieldCompletionRatio:
		return KeyCompletionRatio, true, true
	case FieldModelPrice:
		return KeyModelPrice, true, true
	case FieldCacheRatio:
		return KeyCacheRatio, true, true
	case FieldCreateCacheRatio:
		return KeyCreateCacheRatio, true, true
	case FieldImageRatio:
		return KeyImageRatio, true, true
	case FieldAudioRatio:
		return KeyAudioRatio, true, true
	case FieldAudioCompletionRatio:
		return KeyAudioCompletionRatio, true, true
	case FieldBillingMode:
		return KeyBillingMode, false, true
	case FieldBillingExpr:
		return KeyBillingExpr, false, true
	}
	return "", false, false
}

type Edit struct {
	Model  string `json:"model"`
	Field  Field  `json:"field"`
	Value  string `json:"value"`
	Delete bool   `json:"delete"`
}

// ApplyEdits 把 edits 合并进 current，返回值发生变化的 option key -> 新完整 JSON。
// 未被任何 edit 触及的 key 不会出现在返回值里。
func ApplyEdits(current OptionSet, edits []Edit) (map[string]string, error) {
	// 按 key 分组待改动的 float / string map，惰性从 current 反序列化。
	floatMaps := map[string]map[string]float64{}
	strMaps := map[string]map[string]string{}
	touched := map[string]bool{}

	loadFloat := func(key string) (map[string]float64, error) {
		if m, ok := floatMaps[key]; ok {
			return m, nil
		}
		m := map[string]float64{}
		if raw := current[key]; raw != "" {
			if err := json.Unmarshal([]byte(raw), &m); err != nil {
				return nil, fmt.Errorf("load %s: %w", key, err)
			}
		}
		floatMaps[key] = m
		return m, nil
	}
	loadStr := func(key string) (map[string]string, error) {
		if m, ok := strMaps[key]; ok {
			return m, nil
		}
		m := map[string]string{}
		if raw := current[key]; raw != "" {
			if err := json.Unmarshal([]byte(raw), &m); err != nil {
				return nil, fmt.Errorf("load %s: %w", key, err)
			}
		}
		strMaps[key] = m
		return m, nil
	}

	for _, e := range edits {
		key, isFloat, ok := fieldToKey(e.Field)
		if !ok {
			return nil, fmt.Errorf("unknown field %q", e.Field)
		}
		touched[key] = true
		if isFloat {
			m, err := loadFloat(key)
			if err != nil {
				return nil, err
			}
			if e.Delete {
				delete(m, e.Model)
				continue
			}
			v, err := strconv.ParseFloat(e.Value, 64)
			if err != nil {
				return nil, fmt.Errorf("model %s field %s: %q not a number", e.Model, e.Field, e.Value)
			}
			m[e.Model] = v
		} else {
			m, err := loadStr(key)
			if err != nil {
				return nil, err
			}
			if e.Delete {
				delete(m, e.Model)
				continue
			}
			m[e.Model] = e.Value
		}
	}

	changed := map[string]string{}
	for key := range touched {
		var newRaw []byte
		var err error
		if m, ok := floatMaps[key]; ok {
			newRaw, err = json.Marshal(m)
		} else {
			newRaw, err = json.Marshal(strMaps[key])
		}
		if err != nil {
			return nil, err
		}
		// 与原值比较：语义相等则不算改动（避免 no-op 写入 + 快照）。
		if equalJSON(current[key], string(newRaw), key) {
			continue
		}
		changed[key] = string(newRaw)
	}
	return changed, nil
}

// equalJSON 判断两个 map JSON 是否语义相等（忽略 key 顺序）。
func equalJSON(a, b, key string) bool {
	isFloat := false
	for _, k := range RatioKeys {
		if k == key {
			isFloat = true
			break
		}
	}
	if isFloat {
		var ma, mb map[string]float64
		if a == "" {
			ma = map[string]float64{}
		} else if json.Unmarshal([]byte(a), &ma) != nil {
			return false
		}
		if json.Unmarshal([]byte(b), &mb) != nil {
			return false
		}
		if len(ma) != len(mb) {
			return false
		}
		for k, v := range ma {
			if mb[k] != v {
				return false
			}
		}
		return true
	}
	var ma, mb map[string]string
	if a == "" {
		ma = map[string]string{}
	} else if json.Unmarshal([]byte(a), &ma) != nil {
		return false
	}
	if json.Unmarshal([]byte(b), &mb) != nil {
		return false
	}
	if len(ma) != len(mb) {
		return false
	}
	for k, v := range ma {
		if mb[k] != v {
			return false
		}
	}
	return true
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/pricing/ -v`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/pricing/edit.go backend/internal/pricing/edit_test.go
git commit -m "feat: pricing ApplyEdits merge logic"
```

---

### Task 5: 本地存储 store（sites / snapshots / audit）

**Files:**
- Create: `backend/internal/store/store.go`
- Create: `backend/internal/store/store_test.go`

**Interfaces:**
- Produces:
  - `func Open(path string) (*Store, error)`（`path` 为 sqlite 文件路径，`":memory:"` 用于测试）
  - `type Site struct{ ID int64; Name, BaseURL, Token, UserID string; CreatedAt, UpdatedAt int64 }`
  - `CreateSite(s Site)(int64,error)`, `ListSites()([]Site,error)`, `GetSite(id int64)(Site,error)`, `UpdateSite(s Site)error`, `DeleteSite(id int64)error`
  - `type Snapshot struct{ ID, SiteID, CreatedAt int64; Reason string; Payload map[string]string }`
  - `CreateSnapshot(siteID int64, reason string, payload map[string]string)(int64,error)`, `ListSnapshots(siteID int64)([]Snapshot,error)`, `GetSnapshot(id int64)(Snapshot,error)`
  - `type AuditEntry struct{ ID, TS int64; Action, SourceSite, TargetSite string; Keys, Models []string; Result string }`
  - `AddAudit(a AuditEntry)(int64,error)`, `ListAudit(limit int)([]AuditEntry,error)`

- [ ] **Step 1: 写失败测试**

`backend/internal/store/store_test.go`:

```go
package store

import "testing"

func TestSiteCRUD(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	id, err := st.CreateSite(Site{Name: "sg", BaseURL: "http://x", Token: "tk", UserID: "1"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := st.GetSite(id)
	if err != nil || got.Name != "sg" || got.Token != "tk" {
		t.Fatalf("get wrong: %+v err=%v", got, err)
	}
	got.Name = "sg2"
	if err := st.UpdateSite(got); err != nil {
		t.Fatal(err)
	}
	list, _ := st.ListSites()
	if len(list) != 1 || list[0].Name != "sg2" {
		t.Fatalf("list wrong: %+v", list)
	}
	if err := st.DeleteSite(id); err != nil {
		t.Fatal(err)
	}
	list, _ = st.ListSites()
	if len(list) != 0 {
		t.Fatalf("expected empty after delete")
	}
}

func TestSnapshotRoundTrip(t *testing.T) {
	st, _ := Open(":memory:")
	payload := map[string]string{"ModelRatio": `{"a":1}`}
	id, err := st.CreateSnapshot(7, "manual edit", payload)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := st.GetSnapshot(id)
	if err != nil {
		t.Fatal(err)
	}
	if snap.SiteID != 7 || snap.Payload["ModelRatio"] != `{"a":1}` {
		t.Fatalf("snapshot wrong: %+v", snap)
	}
}

func TestAudit(t *testing.T) {
	st, _ := Open(":memory:")
	_, err := st.AddAudit(AuditEntry{Action: "edit", TargetSite: "sg", Keys: []string{"ModelRatio"}, Models: []string{"gpt-4o"}, Result: "success"})
	if err != nil {
		t.Fatal(err)
	}
	list, _ := st.ListAudit(10)
	if len(list) != 1 || list[0].Keys[0] != "ModelRatio" {
		t.Fatalf("audit wrong: %+v", list)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/store/ -v`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现**

`backend/internal/store/store.go`:

```go
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // sqlite：串行化写，避免 :memory: 多连接各自建表
	schema := `
CREATE TABLE IF NOT EXISTS sites(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT,
  token TEXT, user_id TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, created_at INTEGER,
  reason TEXT, payload_json TEXT);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, action TEXT,
  source_site TEXT, target_site TEXT, keys_json TEXT, models_json TEXT, result TEXT);`
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

type Site struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	BaseURL   string `json:"base_url"`
	Token     string `json:"token"`
	UserID    string `json:"user_id"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func now() int64 // 由 Task 5 Step 3b 补充（用 time.Now().Unix()）
```

> 说明：把 `now()` 直接实现进文件（不要留空声明）。完整写法：

```go
// 放在 store.go 顶部 import 加入 "time"，并实现：
func now() int64 { return time.Now().Unix() }

func (s *Store) CreateSite(site Site) (int64, error) {
	t := now()
	res, err := s.db.Exec(`INSERT INTO sites(name,base_url,token,user_id,created_at,updated_at)
		VALUES(?,?,?,?,?,?)`, site.Name, site.BaseURL, site.Token, site.UserID, t, t)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func scanSite(row interface{ Scan(...interface{}) error }) (Site, error) {
	var s Site
	err := row.Scan(&s.ID, &s.Name, &s.BaseURL, &s.Token, &s.UserID, &s.CreatedAt, &s.UpdatedAt)
	return s, err
}

func (s *Store) GetSite(id int64) (Site, error) {
	row := s.db.QueryRow(`SELECT id,name,base_url,token,user_id,created_at,updated_at FROM sites WHERE id=?`, id)
	return scanSite(row)
}

func (s *Store) ListSites() ([]Site, error) {
	rows, err := s.db.Query(`SELECT id,name,base_url,token,user_id,created_at,updated_at FROM sites ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Site
	for rows.Next() {
		st, err := scanSite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) UpdateSite(site Site) error {
	_, err := s.db.Exec(`UPDATE sites SET name=?,base_url=?,token=?,user_id=?,updated_at=? WHERE id=?`,
		site.Name, site.BaseURL, site.Token, site.UserID, now(), site.ID)
	return err
}

func (s *Store) DeleteSite(id int64) error {
	_, err := s.db.Exec(`DELETE FROM sites WHERE id=?`, id)
	return err
}

type Snapshot struct {
	ID        int64             `json:"id"`
	SiteID    int64             `json:"site_id"`
	CreatedAt int64             `json:"created_at"`
	Reason    string            `json:"reason"`
	Payload   map[string]string `json:"payload"`
}

func (s *Store) CreateSnapshot(siteID int64, reason string, payload map[string]string) (int64, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	res, err := s.db.Exec(`INSERT INTO snapshots(site_id,created_at,reason,payload_json) VALUES(?,?,?,?)`,
		siteID, now(), reason, string(b))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) GetSnapshot(id int64) (Snapshot, error) {
	var snap Snapshot
	var payload string
	err := s.db.QueryRow(`SELECT id,site_id,created_at,reason,payload_json FROM snapshots WHERE id=?`, id).
		Scan(&snap.ID, &snap.SiteID, &snap.CreatedAt, &snap.Reason, &payload)
	if err != nil {
		return snap, err
	}
	if err := json.Unmarshal([]byte(payload), &snap.Payload); err != nil {
		return snap, fmt.Errorf("decode snapshot payload: %w", err)
	}
	return snap, nil
}

func (s *Store) ListSnapshots(siteID int64) ([]Snapshot, error) {
	rows, err := s.db.Query(`SELECT id,site_id,created_at,reason,payload_json FROM snapshots WHERE site_id=? ORDER BY id DESC`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Snapshot
	for rows.Next() {
		var snap Snapshot
		var payload string
		if err := rows.Scan(&snap.ID, &snap.SiteID, &snap.CreatedAt, &snap.Reason, &payload); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(payload), &snap.Payload)
		out = append(out, snap)
	}
	return out, rows.Err()
}

type AuditEntry struct {
	ID         int64    `json:"id"`
	TS         int64    `json:"ts"`
	Action     string   `json:"action"`
	SourceSite string   `json:"source_site"`
	TargetSite string   `json:"target_site"`
	Keys       []string `json:"keys"`
	Models     []string `json:"models"`
	Result     string   `json:"result"`
}

func (s *Store) AddAudit(a AuditEntry) (int64, error) {
	kb, _ := json.Marshal(a.Keys)
	mb, _ := json.Marshal(a.Models)
	res, err := s.db.Exec(`INSERT INTO audit(ts,action,source_site,target_site,keys_json,models_json,result)
		VALUES(?,?,?,?,?,?,?)`, now(), a.Action, a.SourceSite, a.TargetSite, string(kb), string(mb), a.Result)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) ListAudit(limit int) ([]AuditEntry, error) {
	rows, err := s.db.Query(`SELECT id,ts,action,source_site,target_site,keys_json,models_json,result FROM audit ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var a AuditEntry
		var kb, mb string
		if err := rows.Scan(&a.ID, &a.TS, &a.Action, &a.SourceSite, &a.TargetSite, &kb, &mb, &a.Result); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(kb), &a.Keys)
		json.Unmarshal([]byte(mb), &a.Models)
		out = append(out, a)
	}
	return out, rows.Err()
}
```

> 实现时把上面两段合并为一个 `store.go`（`import` 需含 `database/sql`、`encoding/json`、`fmt`、`time`、`modernc.org/sqlite`），删掉占位的 `func now() int64` 声明行，只保留带 body 的版本。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go mod tidy && go test ./internal/store/ -v`
Expected: `go mod tidy` 拉入 `modernc.org/sqlite`；三个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/store/
git commit -m "feat: sqlite store for sites, snapshots, audit"
```

---

### Task 6: new-api 客户端 newapi

**Files:**
- Create: `backend/internal/newapi/client.go`
- Create: `backend/internal/newapi/client_test.go`

**Interfaces:**
- Consumes: `pricing.OptionSet`, `pricing.ManagedKeys`。
- Produces:
  - `type Site struct{ BaseURL, Token, UserID string }`
  - `func New(s Site) *Client`
  - `func (c *Client) GetOptions(ctx context.Context) (pricing.OptionSet, error)` — GET `/api/option/`，解析 `{data:[{key,value}]}`，只保留 `pricing.ManagedKeys`。
  - `func (c *Client) PutOption(ctx context.Context, key, value string) error` — PUT `/api/option/`，body `{key,value}`；new-api 返回 `{success:false}` 时报错。

- [ ] **Step 1: 写失败测试（用 httptest 模拟 new-api）**

`backend/internal/newapi/client_test.go`:

```go
package newapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"newapiauto/internal/pricing"
)

func TestGetOptionsFiltersManaged(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "tk" || r.Header.Get("New-Api-User") != "1" {
			t.Errorf("missing auth headers: %v", r.Header)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"data": []map[string]string{
				{"key": "ModelRatio", "value": `{"gpt-4o":2.5}`},
				{"key": "SMTPServer", "value": "smtp"}, // 非受管 key，应被过滤
			},
		})
	}))
	defer srv.Close()

	c := New(Site{BaseURL: srv.URL, Token: "tk", UserID: "1"})
	opts, err := c.GetOptions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if opts[pricing.KeyModelRatio] != `{"gpt-4o":2.5}` {
		t.Fatalf("ModelRatio wrong: %q", opts[pricing.KeyModelRatio])
	}
	if _, ok := opts["SMTPServer"]; ok {
		t.Fatal("non-managed key should be filtered out")
	}
}

func TestPutOptionError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var req map[string]any
		json.Unmarshal(b, &req)
		if req["key"] != "ModelRatio" {
			t.Errorf("key wrong: %v", req["key"])
		}
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "boom"})
	}))
	defer srv.Close()

	c := New(Site{BaseURL: srv.URL, Token: "tk", UserID: "1"})
	err := c.PutOption(context.Background(), "ModelRatio", `{"a":1}`)
	if err == nil {
		t.Fatal("expected error from success:false")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/newapi/ -v`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现**

`backend/internal/newapi/client.go`:

```go
package newapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"newapiauto/internal/pricing"
)

type Site struct {
	BaseURL string
	Token   string
	UserID  string
}

type Client struct {
	site Site
	http *http.Client
}

func New(s Site) *Client {
	s.BaseURL = strings.TrimRight(s.BaseURL, "/")
	return &Client{site: s, http: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.site.BaseURL+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.site.Token)
	req.Header.Set("New-Api-User", c.site.UserID)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s %s: http %d: %s", method, path, resp.StatusCode, string(b))
	}
	return b, nil
}

type optionsResp struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"data"`
}

func (c *Client) GetOptions(ctx context.Context) (pricing.OptionSet, error) {
	b, err := c.do(ctx, http.MethodGet, "/api/option/", nil)
	if err != nil {
		return nil, err
	}
	var parsed optionsResp
	if err := json.Unmarshal(b, &parsed); err != nil {
		return nil, fmt.Errorf("decode options: %w", err)
	}
	if !parsed.Success {
		return nil, fmt.Errorf("get options: %s", parsed.Message)
	}
	managed := map[string]bool{}
	for _, k := range pricing.ManagedKeys {
		managed[k] = true
	}
	out := pricing.OptionSet{}
	for _, kv := range parsed.Data {
		if managed[kv.Key] {
			out[kv.Key] = kv.Value
		}
	}
	return out, nil
}

type putResp struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func (c *Client) PutOption(ctx context.Context, key, value string) error {
	body, _ := json.Marshal(map[string]string{"key": key, "value": value})
	b, err := c.do(ctx, http.MethodPut, "/api/option/", body)
	if err != nil {
		return err
	}
	var parsed putResp
	if err := json.Unmarshal(b, &parsed); err != nil {
		return fmt.Errorf("decode put resp: %w", err)
	}
	if !parsed.Success {
		return fmt.Errorf("put %s: %s", key, parsed.Message)
	}
	return nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/newapi/ -v`
Expected: 两个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/newapi/
git commit -m "feat: new-api admin API client (GetOptions/PutOption)"
```

---

### Task 7: 编辑服务 editsvc（校验 + 快照 + 写入，编排层）

**Files:**
- Create: `backend/internal/editsvc/editsvc.go`
- Create: `backend/internal/editsvc/editsvc_test.go`

**Interfaces:**
- Consumes: `pricing.ApplyEdits`, `pricing.Edit`, `pricing.OptionSet`, `pricing.KeyBillingExpr`, `validate.Expr`, `store.Store`, `store.AuditEntry`。
- Produces:
  - 接口 `type OptionRW interface{ GetOptions(ctx context.Context)(pricing.OptionSet,error); PutOption(ctx context.Context, key, value string) error }`（`*newapi.Client` 满足它，便于测试注入 fake）
  - `type Result struct{ ChangedKeys []string; SnapshotID int64 }`
  - `func Apply(ctx context.Context, st *store.Store, siteID int64, siteName string, rw OptionRW, edits []pricing.Edit) (Result, error)`

  流程：校验所有 BillingExpr edit → 拉当前 options → ApplyEdits 得 changed → 若空则直接返回 → 快照 changed key 的旧值 → 逐 key PutOption（失败即停并记 audit=partial）→ 记 audit=success。

- [ ] **Step 1: 写失败测试（fake OptionRW）**

`backend/internal/editsvc/editsvc_test.go`:

```go
package editsvc

import (
	"context"
	"testing"

	"newapiauto/internal/pricing"
	"newapiauto/internal/store"
)

type fakeRW struct {
	opts pricing.OptionSet
	puts map[string]string
}

func (f *fakeRW) GetOptions(ctx context.Context) (pricing.OptionSet, error) { return f.opts, nil }
func (f *fakeRW) PutOption(ctx context.Context, key, value string) error {
	f.puts[key] = value
	f.opts[key] = value
	return nil
}

func TestApplyRatioSnapshotsOldValue(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{pricing.KeyModelRatio: `{"gpt-4o":2.5}`}, puts: map[string]string{}}
	res, err := Apply(context.Background(), st, 1, "sg", rw,
		[]pricing.Edit{{Model: "gpt-4o", Field: pricing.FieldModelRatio, Value: "3"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.ChangedKeys) != 1 || rw.puts[pricing.KeyModelRatio] == "" {
		t.Fatalf("expected 1 put, got %+v", rw.puts)
	}
	snap, _ := st.GetSnapshot(res.SnapshotID)
	if snap.Payload[pricing.KeyModelRatio] != `{"gpt-4o":2.5}` {
		t.Fatalf("snapshot should hold OLD value, got %q", snap.Payload[pricing.KeyModelRatio])
	}
}

func TestApplyRejectsBadExpr(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{}, puts: map[string]string{}}
	_, err := Apply(context.Background(), st, 1, "sg", rw, []pricing.Edit{
		{Model: "claude-x", Field: pricing.FieldBillingExpr, Value: `tier("base", p*-1)`},
	})
	if err == nil {
		t.Fatal("expected validation error for negative expr")
	}
	if len(rw.puts) != 0 {
		t.Fatal("nothing should be written when validation fails")
	}
}

func TestApplyNoChangeNoSnapshot(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{pricing.KeyModelRatio: `{"gpt-4o":2.5}`}, puts: map[string]string{}}
	res, err := Apply(context.Background(), st, 1, "sg", rw,
		[]pricing.Edit{{Model: "gpt-4o", Field: pricing.FieldModelRatio, Value: "2.5"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.ChangedKeys) != 0 || len(rw.puts) != 0 || res.SnapshotID != 0 {
		t.Fatalf("expected no-op, got %+v puts=%+v", res, rw.puts)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/editsvc/ -v`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现**

`backend/internal/editsvc/editsvc.go`:

```go
package editsvc

import (
	"context"
	"fmt"

	"newapiauto/internal/pricing"
	"newapiauto/internal/store"
	"newapiauto/internal/validate"
)

type OptionRW interface {
	GetOptions(ctx context.Context) (pricing.OptionSet, error)
	PutOption(ctx context.Context, key, value string) error
}

type Result struct {
	ChangedKeys []string `json:"changed_keys"`
	SnapshotID  int64    `json:"snapshot_id"`
}

func Apply(ctx context.Context, st *store.Store, siteID int64, siteName string, rw OptionRW, edits []pricing.Edit) (Result, error) {
	// 1. 校验所有阶梯表达式 edit
	for _, e := range edits {
		if e.Field == pricing.FieldBillingExpr && !e.Delete {
			if err := validate.Expr(e.Value); err != nil {
				return Result{}, fmt.Errorf("model %s expr invalid: %w", e.Model, err)
			}
		}
	}
	// 2. 拉当前 options
	current, err := rw.GetOptions(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("fetch current options: %w", err)
	}
	// 3. 合并
	changed, err := pricing.ApplyEdits(current, edits)
	if err != nil {
		return Result{}, err
	}
	if len(changed) == 0 {
		return Result{}, nil
	}
	// 4. 快照旧值
	oldPayload := map[string]string{}
	changedKeys := make([]string, 0, len(changed))
	for key := range changed {
		oldPayload[key] = current[key] // 可能为 ""，表示原先没有该 option
		changedKeys = append(changedKeys, key)
	}
	models := modelsFromEdits(edits)
	snapID, err := st.CreateSnapshot(siteID, "manual edit", oldPayload)
	if err != nil {
		return Result{}, fmt.Errorf("snapshot: %w", err)
	}
	// 5. 逐 key 写入，失败即停
	written := []string{}
	for key, val := range changed {
		if err := rw.PutOption(ctx, key, val); err != nil {
			st.AddAudit(store.AuditEntry{Action: "edit", TargetSite: siteName,
				Keys: written, Models: models, Result: "partial: " + err.Error()})
			return Result{ChangedKeys: written, SnapshotID: snapID},
				fmt.Errorf("write %s failed (already wrote %v): %w", key, written, err)
		}
		written = append(written, key)
	}
	st.AddAudit(store.AuditEntry{Action: "edit", TargetSite: siteName,
		Keys: changedKeys, Models: models, Result: "success"})
	return Result{ChangedKeys: changedKeys, SnapshotID: snapID}, nil
}

func modelsFromEdits(edits []pricing.Edit) []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range edits {
		if !seen[e.Model] {
			seen[e.Model] = true
			out = append(out, e.Model)
		}
	}
	return out
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/editsvc/ -v`
Expected: 三个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/editsvc/
git commit -m "feat: edit orchestration (validate + snapshot + write)"
```

---

### Task 8: HTTP API — 站点 CRUD + 测试连接

**Files:**
- Create: `backend/internal/api/api.go`
- Create: `backend/internal/api/sites.go`
- Create: `backend/internal/api/sites_test.go`

**Interfaces:**
- Consumes: `store.Store`, `store.Site`, `newapi.New`, `newapi.Site`。
- Produces:
  - `func NewRouter(st *store.Store) http.Handler`（chi 路由，挂载所有 `/api/*`）
  - 路由：
    - `GET /api/sites` → `[]store.Site`
    - `POST /api/sites` body `{name,base_url,token,user_id}` → 创建，返回 `{id}`
    - `PUT /api/sites/{id}` → 更新
    - `DELETE /api/sites/{id}`
    - `POST /api/sites/{id}/test` → 用该站凭据调 `GetOptions`，成功返回 `{success:true,count:<受管key数>}`

- [ ] **Step 1: 写失败测试**

`backend/internal/api/sites_test.go`:

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

func newTestRouter(t *testing.T) http.Handler {
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	return NewRouter(st)
}

func TestCreateAndListSites(t *testing.T) {
	r := newTestRouter(t)

	body, _ := json.Marshal(map[string]string{"name": "sg", "base_url": "http://x", "token": "tk", "user_id": "1"})
	req := httptest.NewRequest("POST", "/api/sites", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("create status %d: %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest("GET", "/api/sites", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var sites []store.Site
	json.Unmarshal(w.Body.Bytes(), &sites)
	if len(sites) != 1 || sites[0].Name != "sg" {
		t.Fatalf("list wrong: %s", w.Body.String())
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/api/ -v`
Expected: FAIL（`NewRouter` 未定义）。

- [ ] **Step 3: 实现**

`backend/internal/api/api.go`:

```go
package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"newapiauto/internal/store"
)

type server struct{ st *store.Store }

func NewRouter(st *store.Store) http.Handler {
	s := &server{st: st}
	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		r.Get("/sites", s.listSites)
		r.Post("/sites", s.createSite)
		r.Put("/sites/{id}", s.updateSite)
		r.Delete("/sites/{id}", s.deleteSite)
		r.Post("/sites/{id}/test", s.testSite)
		r.Get("/sites/{id}/pricing", s.getPricing)     // Task 9
		r.Put("/sites/{id}/pricing", s.putPricing)      // Task 9
		r.Post("/validate-expr", s.validateExpr)        // Task 9
	})
	return r
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"success": false, "message": msg})
}
```

`backend/internal/api/sites.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"newapiauto/internal/newapi"
	"newapiauto/internal/store"
)

func idParam(r *http.Request) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
}

func (s *server) listSites(w http.ResponseWriter, r *http.Request) {
	sites, err := s.st.ListSites()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if sites == nil {
		sites = []store.Site{}
	}
	writeJSON(w, 200, sites)
}

func (s *server) createSite(w http.ResponseWriter, r *http.Request) {
	var site store.Site
	if err := json.NewDecoder(r.Body).Decode(&site); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	id, err := s.st.CreateSite(site)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"id": id})
}

func (s *server) updateSite(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	var site store.Site
	if err := json.NewDecoder(r.Body).Decode(&site); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	site.ID = id
	if err := s.st.UpdateSite(site); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}

func (s *server) deleteSite(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	if err := s.st.DeleteSite(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}

func (s *server) clientForSite(id int64) (*newapi.Client, store.Site, error) {
	site, err := s.st.GetSite(id)
	if err != nil {
		return nil, site, err
	}
	return newapi.New(newapi.Site{BaseURL: site.BaseURL, Token: site.Token, UserID: site.UserID}), site, nil
}

func (s *server) testSite(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	c, _, err := s.clientForSite(id)
	if err != nil {
		writeErr(w, 404, "site not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	opts, err := c.GetOptions(ctx)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "count": len(opts)})
}
```

> 注：`getPricing`/`putPricing`/`validateExpr` 在 Task 9 实现。为让本任务能编译，Task 9 前这三个方法暂不存在会导致 `api.go` 引用未定义——因此本任务的 `NewRouter` 里先**注释掉**这三行路由，Task 9 再取消注释。提交本任务时保持这三行注释。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go mod tidy && go test ./internal/api/ -v`
Expected: `go-chi/chi/v5` 被拉入；`TestCreateAndListSites` PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/api/
git commit -m "feat: HTTP API for site CRUD and connection test"
```

---

### Task 9: HTTP API — 读取价格 / 校验表达式 / 编辑价格

**Files:**
- Create: `backend/internal/api/pricing.go`
- Modify: `backend/internal/api/api.go`（取消 Task 8 中三行路由的注释）
- Create: `backend/internal/api/pricing_test.go`

**Interfaces:**
- Consumes: `newapi.Client.GetOptions`, `pricing.Parse`, `pricing.Edit`, `validate.Expr`, `editsvc.Apply`。
- Produces:
  - `GET /api/sites/{id}/pricing` → `{models: []*pricing.ModelPricing}`（按 model 名排序）
  - `POST /api/validate-expr` body `{expr}` → `{valid:bool, error?:string}`
  - `PUT /api/sites/{id}/pricing` body `{edits: []pricing.Edit}` → `editsvc.Result`

- [ ] **Step 1: 写失败测试**

`backend/internal/api/pricing_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateExprEndpoint(t *testing.T) {
	r := newTestRouter(t)

	body, _ := json.Marshal(map[string]string{"expr": `tier("base", p*3)`})
	req := httptest.NewRequest("POST", "/api/validate-expr", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var ok map[string]any
	json.Unmarshal(w.Body.Bytes(), &ok)
	if ok["valid"] != true {
		t.Fatalf("expected valid, got %s", w.Body.String())
	}

	body, _ = json.Marshal(map[string]string{"expr": `tier("base", p*-1)`})
	req = httptest.NewRequest("POST", "/api/validate-expr", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var bad map[string]any
	json.Unmarshal(w.Body.Bytes(), &bad)
	if bad["valid"] != false {
		t.Fatalf("expected invalid, got %s", w.Body.String())
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && go test ./internal/api/ -run TestValidateExprEndpoint -v`
Expected: FAIL（路由/方法未定义）。

- [ ] **Step 3: 实现 + 取消注释路由**

在 `api.go` 的 `NewRouter` 中取消 Task 8 里被注释的三行路由。

`backend/internal/api/pricing.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"newapiauto/internal/editsvc"
	"newapiauto/internal/pricing"
	"newapiauto/internal/validate"
)

func (s *server) getPricing(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	c, _, err := s.clientForSite(id)
	if err != nil {
		writeErr(w, 404, "site not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	opts, err := c.GetOptions(ctx)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	byModel, err := pricing.Parse(opts)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	models := make([]*pricing.ModelPricing, 0, len(byModel))
	for _, mp := range byModel {
		models = append(models, mp)
	}
	sort.Slice(models, func(i, j int) bool { return models[i].Model < models[j].Model })
	writeJSON(w, 200, map[string]any{"models": models})
}

func (s *server) validateExpr(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Expr string `json:"expr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	if err := validate.Expr(req.Expr); err != nil {
		writeJSON(w, 200, map[string]any{"valid": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"valid": true})
}

func (s *server) putPricing(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	var req struct {
		Edits []pricing.Edit `json:"edits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	c, site, err := s.clientForSite(id)
	if err != nil {
		writeErr(w, 404, "site not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	res, err := editsvc.Apply(ctx, s.st, id, site.Name, c, req.Edits)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, res)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && go test ./internal/api/ -v`
Expected: `TestCreateAndListSites` 与 `TestValidateExprEndpoint` 均 PASS。

- [ ] **Step 5: 全量测试 + Commit**

Run: `cd backend && go test ./... -v`
Expected: 所有包测试 PASS。

```bash
git add backend/internal/api/
git commit -m "feat: pricing read, expr validate, and edit endpoints"
```

---

### Task 10: main.go — 组装、静态托管、启动参数

**Files:**
- Create: `backend/main.go`
- Create: `backend/internal/api/static.go`

**Interfaces:**
- Consumes: `store.Open`, `api.NewRouter`。
- Produces: 可执行后端。flag：`-addr`（默认 `:8787`）、`-db`（默认 `./data/app.db`）、`-static`（默认 `./frontend/dist`）。`/api/*` 走 API，其余路径回退到静态文件（SPA：找不到文件时返回 `index.html`）。

- [ ] **Step 1: 实现静态回退 handler**

`backend/internal/api/static.go`:

```go
package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// SPAHandler 提供静态文件；非 /api 且文件不存在时回退到 index.html。
func SPAHandler(dir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		clean := filepath.Clean(r.URL.Path)
		full := filepath.Join(dir, clean)
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			http.ServeFile(w, r, full)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	}
}
```

- [ ] **Step 2: 实现 main.go**

`backend/main.go`:

```go
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"newapiauto/internal/api"
	"newapiauto/internal/store"
)

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	dbPath := flag.String("db", "./data/app.db", "sqlite db path")
	staticDir := flag.String("static", "./frontend/dist", "frontend dist dir")
	flag.Parse()

	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		log.Fatal(err)
	}
	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatal(err)
	}

	apiRouter := api.NewRouter(st)
	root := chi.NewRouter()
	root.Mount("/api", http.StripPrefix("", apiRouter)) // apiRouter 内部已带 /api 前缀
	root.NotFound(api.SPAHandler(*staticDir))

	log.Printf("listening on %s (db=%s static=%s)", *addr, *dbPath, *staticDir)
	log.Fatal(http.ListenAndServe(*addr, root))
}
```

> 注意：`api.NewRouter` 返回的路由已经带 `/api` 前缀。为避免双前缀，改为：`root.Mount("/", apiRouter)` 并让 `SPAHandler` 作为 apiRouter 的 NotFound。更简单的做法见下一步修正。

- [ ] **Step 3: 修正装配（把静态回退接到 api 路由的 NotFound）**

改 `api.go` 的 `NewRouter` 增加一个可选的 fallback 参数会破坏 Task 8 测试签名。改为在 `main.go` 用一个组合 handler：

`backend/main.go`（替换 `root` 部分）:

```go
	apiRouter := api.NewRouter(st)
	spa := api.SPAHandler(*staticDir)
	mux := http.NewServeMux()
	mux.Handle("/api/", apiRouter) // 所有 /api/* 交给 chi（其内部路由含 /api 前缀）
	mux.Handle("/", spa)           // 其余交给 SPA

	log.Printf("listening on %s (db=%s static=%s)", *addr, *dbPath, *staticDir)
	log.Fatal(http.ListenAndServe(*addr, mux))
```

删除前一步 `root`/`chi.NewRouter()`/多余 import（`chi`）。

- [ ] **Step 4: 编译并冒烟启动**

Run:
```bash
cd backend && go build ./... && go vet ./...
mkdir -p frontend/dist && echo '<!doctype html><title>ok</title>placeholder' > frontend/dist/index.html
go run . -addr :8787 -db ./data/app.db &
sleep 1
curl -s localhost:8787/api/sites
curl -s localhost:8787/ | head -c 40
kill %1
```
Expected: `/api/sites` 返回 `[]`；`/` 返回 placeholder HTML。

- [ ] **Step 5: Commit**

```bash
git add backend/main.go backend/internal/api/static.go
git commit -m "feat: server assembly with SPA static hosting"
```

---

### Task 11: 前端脚手架（Vite + React）

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.js`, `frontend/index.html`, `frontend/src/main.jsx`, `frontend/src/App.jsx`, `frontend/src/api.js`

**Interfaces:**
- Produces:
  - `frontend/src/api.js` 导出 `getSites()`, `createSite(s)`, `updateSite(id,s)`, `deleteSite(id)`, `testSite(id)`, `getPricing(id)`, `putPricing(id, edits)`, `validateExpr(expr)`（均返回 Promise，基于 `fetch('/api/...')`）。
  - 开发期 vite 代理 `/api` → `http://localhost:8787`。

- [ ] **Step 1: 初始化 Vite React 项目**

```bash
cd /Users/jason/Desktop/自动化工具/new_api_auto
npm create vite@latest frontend -- --template react
cd frontend && npm install
```

- [ ] **Step 2: 配置 dev 代理**

`frontend/vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { outDir: 'dist' },
})
```

- [ ] **Step 3: 写 api.js**

`frontend/src/api.js`:

```js
async function req(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`)
  return data
}

export const getSites = () => req('GET', '/api/sites')
export const createSite = (s) => req('POST', '/api/sites', s)
export const updateSite = (id, s) => req('PUT', `/api/sites/${id}`, s)
export const deleteSite = (id) => req('DELETE', `/api/sites/${id}`)
export const testSite = (id) => req('POST', `/api/sites/${id}/test`)
export const getPricing = (id) => req('GET', `/api/sites/${id}/pricing`)
export const putPricing = (id, edits) => req('PUT', `/api/sites/${id}/pricing`, { edits })
export const validateExpr = (expr) => req('POST', '/api/validate-expr', { expr })
```

- [ ] **Step 4: 最小 App 外壳（两个 Tab）**

`frontend/src/App.jsx`:

```jsx
import { useState } from 'react'
import Sites from './pages/Sites'
import Editor from './pages/Editor'

export default function App() {
  const [tab, setTab] = useState('sites')
  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 1100, margin: '0 auto', padding: 20 }}>
      <h1>new-api 价格管理</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('sites')} disabled={tab === 'sites'}>站点</button>
        <button onClick={() => setTab('editor')} disabled={tab === 'editor'}>单站编辑</button>
      </div>
      {tab === 'sites' ? <Sites /> : <Editor />}
    </div>
  )
}
```

> `main.jsx` 保留 Vite 默认（渲染 `<App/>`）。删除模板自带的 `App.css`/`index.css` 引用中会引起干扰的样式可保留不管。此步骤先建 `frontend/src/pages/` 空目录占位，`Sites.jsx`/`Editor.jsx` 在 Task 12/13 创建。为让本步编译通过，先创建最小占位组件（见下）。

`frontend/src/pages/Sites.jsx`（占位）:

```jsx
export default function Sites() { return <div>sites</div> }
```

`frontend/src/pages/Editor.jsx`（占位）:

```jsx
export default function Editor() { return <div>editor</div> }
```

- [ ] **Step 5: 构建冒烟 + Commit**

Run: `cd frontend && npm run build`
Expected: 生成 `frontend/dist/index.html` 等，无报错。

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/index.html frontend/src/
git commit -m "feat: frontend scaffold with api client and app shell"
```

---

### Task 12: 前端 — 站点管理页

**Files:**
- Modify: `frontend/src/pages/Sites.jsx`

**Interfaces:**
- Consumes: `getSites, createSite, updateSite, deleteSite, testSite`（`../api`）。
- Produces: 站点列表 + 新增/编辑表单 + 「测试连接」按钮，测试结果内联显示。

- [ ] **Step 1: 实现 Sites 页**

`frontend/src/pages/Sites.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { getSites, createSite, updateSite, deleteSite, testSite } from '../api'

const empty = { name: '', base_url: '', token: '', user_id: '' }

export default function Sites() {
  const [sites, setSites] = useState([])
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [msg, setMsg] = useState('')

  const load = () => getSites().then(setSites).catch((e) => setMsg(e.message))
  useEffect(() => { load() }, [])

  const submit = async () => {
    try {
      if (editId) await updateSite(editId, form)
      else await createSite(form)
      setForm(empty); setEditId(null); setMsg('已保存'); load()
    } catch (e) { setMsg(e.message) }
  }

  const test = async (id) => {
    setMsg('测试中...')
    try { const r = await testSite(id); setMsg(`连接成功，读到 ${r.count} 个价格配置项`) }
    catch (e) { setMsg('连接失败: ' + e.message) }
  }

  return (
    <div>
      {msg && <div style={{ padding: 8, background: '#eef', marginBottom: 12 }}>{msg}</div>}
      <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th>名称</th><th>URL</th><th>用户ID</th><th>操作</th></tr></thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td><td>{s.base_url}</td><td>{s.user_id}</td>
              <td>
                <button onClick={() => test(s.id)}>测试连接</button>{' '}
                <button onClick={() => { setForm(s); setEditId(s.id) }}>编辑</button>{' '}
                <button onClick={() => deleteSite(s.id).then(load)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{editId ? '编辑站点' : '新增站点'}</h3>
      {['name', 'base_url', 'token', 'user_id'].map((k) => (
        <div key={k} style={{ marginBottom: 6 }}>
          <label style={{ display: 'inline-block', width: 90 }}>{k}</label>
          <input value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            style={{ width: 400 }} />
        </div>
      ))}
      <button onClick={submit}>保存</button>{' '}
      {editId && <button onClick={() => { setForm(empty); setEditId(null) }}>取消</button>}
    </div>
  )
}
```

- [ ] **Step 2: 手动验证（前后端联调）**

Run（两个终端）:
```bash
# 终端1
cd backend && go run . -addr :8787
# 终端2
cd frontend && npm run dev
```
在浏览器打开 vite 提示的地址：新增一个站点（填新加坡 daily 的 URL/token/userID）→ 点「测试连接」，应显示「连接成功，读到 N 个价格配置项」。
Expected: 站点出现在列表；测试连接成功。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Sites.jsx
git commit -m "feat: site management page"
```

---

### Task 13: 前端 — 单站价格编辑页

**Files:**
- Modify: `frontend/src/pages/Editor.jsx`

**Interfaces:**
- Consumes: `getSites, getPricing, putPricing, validateExpr`（`../api`）。
- Produces: 选站 → 加载价格表（可编辑 ModelRatio/CompletionRatio/ModelPrice/子费率）；对 tiered_expr 模型显示表达式并可编辑，编辑时调 `validateExpr` 实时校验；「保存」收集改动为 edits 数组调 `putPricing`。

- [ ] **Step 1: 实现 Editor 页**

`frontend/src/pages/Editor.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { getSites, getPricing, putPricing, validateExpr } from '../api'

// 前端字段 -> 后端 Field 名 与 ModelPricing 属性名
const RATIO_FIELDS = [
  ['ModelRatio', 'model_ratio'],
  ['CompletionRatio', 'completion_ratio'],
  ['ModelPrice', 'model_price'],
  ['CacheRatio', 'cache_ratio'],
  ['CreateCacheRatio', 'create_cache_ratio'],
  ['ImageRatio', 'image_ratio'],
  ['AudioRatio', 'audio_ratio'],
  ['AudioCompletionRatio', 'audio_completion_ratio'],
]

export default function Editor() {
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [models, setModels] = useState([])
  const [edits, setEdits] = useState({}) // key `${model}|${field}` -> value string
  const [exprErr, setExprErr] = useState({}) // model -> error string
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => { getSites().then(setSites) }, [])

  const load = async (id) => {
    setSiteId(id); setEdits({}); setExprErr({}); setMsg('加载中...')
    try { const r = await getPricing(id); setModels(r.models || []); setMsg('') }
    catch (e) { setMsg(e.message) }
  }

  const setEdit = (model, field, value) =>
    setEdits((p) => ({ ...p, [`${model}|${field}`]: value }))

  const editVal = (model, field, fallback) => {
    const k = `${model}|${field}`
    return k in edits ? edits[k] : (fallback ?? '')
  }

  const checkExpr = async (model, expr) => {
    if (!expr) { setExprErr((p) => ({ ...p, [model]: '' })); return }
    try {
      const r = await validateExpr(expr)
      setExprErr((p) => ({ ...p, [model]: r.valid ? '' : r.error }))
    } catch (e) { setExprErr((p) => ({ ...p, [model]: e.message })) }
  }

  const save = async () => {
    // 若有表达式错误，阻止保存
    const errs = Object.values(exprErr).filter(Boolean)
    if (errs.length) { setMsg('存在无效表达式，无法保存'); return }
    const payload = Object.entries(edits)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const [model, field] = k.split('|')
        return { model, field, value: String(v) }
      })
    if (!payload.length) { setMsg('没有改动'); return }
    setMsg('保存中...')
    try {
      const r = await putPricing(siteId, payload)
      setMsg(`已保存，改动 ${r.changed_keys?.length || 0} 个配置项（快照 #${r.snapshot_id}）`)
      load(siteId)
    } catch (e) { setMsg('保存失败: ' + e.message) }
  }

  const shown = models.filter((m) => m.model.includes(filter))

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <select value={siteId} onChange={(e) => load(Number(e.target.value))}>
          <option value="">选择站点...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>{' '}
        <input placeholder="过滤模型名" value={filter} onChange={(e) => setFilter(e.target.value)} />{' '}
        <button onClick={save} disabled={!siteId}>保存改动</button>
      </div>
      {msg && <div style={{ padding: 8, background: '#eef', marginBottom: 12 }}>{msg}</div>}

      <table border="1" cellPadding="4" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th>模型</th><th>模式</th>
            {RATIO_FIELDS.map(([f]) => <th key={f}>{f}</th>)}
            <th>阶梯表达式</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.model}>
              <td>{m.model}</td>
              <td>{m.billing_mode}</td>
              {RATIO_FIELDS.map(([field, prop]) => (
                <td key={field}>
                  <input style={{ width: 70 }}
                    value={editVal(m.model, field, m[prop] != null ? String(m[prop]) : '')}
                    onChange={(e) => setEdit(m.model, field, e.target.value)} />
                </td>
              ))}
              <td>
                {m.billing_mode === 'tiered_expr' || editVal(m.model, 'BillingExpr', m.billing_expr) ? (
                  <div>
                    <textarea rows={2} style={{ width: 320 }}
                      value={editVal(m.model, 'BillingExpr', m.billing_expr)}
                      onChange={(e) => setEdit(m.model, 'BillingExpr', e.target.value)}
                      onBlur={(e) => checkExpr(m.model, e.target.value)} />
                    {exprErr[m.model] && <div style={{ color: 'red' }}>{exprErr[m.model]}</div>}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: 手动验证（只读加载）**

在 dev 环境选择新加坡 daily → 价格表应加载出几百个模型；Claude 系模型「模式」列显示 `tiered_expr` 且阶梯表达式可见。
Expected: 价格正确展示；表达式框显示实库中的 `tier(...)` 内容。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Editor.jsx
git commit -m "feat: single-site pricing editor with live expr validation"
```

---

### Task 14: 集成验证（新加坡 daily 真写 + 快照回滚往返）

> **前置条件（需用户提供）：** 新加坡 daily 站的 `base_url`、管理员 `token`（Authorization）、管理员 `user_id`（New-Api-User）。若暂无，跳过写测试，仅做只读验证并在此标注 TODO。

**Files:**
- Create: `backend/scripts/integration_readme.md`（记录手动验证步骤与结果）

- [ ] **Step 1: 只读验证**

在 UI 新增新加坡 daily 站 → 测试连接成功 → 编辑页加载价格 → 核对 Claude 模型显示 tiered_expr。
Expected: 与实库一致（约 300+ 模型，13 个 Claude tiered）。

- [ ] **Step 2: 真写 + 校验 + 回滚（选一个安全的测试模型）**

选一个明显是测试用途或影响面小的模型（例如自建的 `test` 模型；**不要**动线上主力模型），把它的 `ModelRatio` 改一个易识别值（如 `9.999`）→ 保存 → 记下返回的快照 ID。
用 curl 直接核对目标站已生效：
```bash
curl -s -H "Authorization: <token>" -H "New-Api-User: <uid>" <base_url>/api/option/ \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print([o['value'] for o in d['data'] if o['key']=='ModelRatio'][0][:200])"
```
Expected: 输出的 ModelRatio JSON 中该模型值为 `9.999`。

- [ ] **Step 3: 用快照回滚（P1 手动方式）**

> P1 暂无回滚 UI（属于 P3）。本步用快照数据手动验证可回滚：从 `data/app.db` 读出该快照的旧值，手动 PUT 回去，确认还原。回滚 UI 在 P3 实现。

```bash
cd backend
# 取快照旧值
python3 - <<'PY'
import sqlite3, json
db = sqlite3.connect('data/app.db')
row = db.execute('SELECT payload_json FROM snapshots ORDER BY id DESC LIMIT 1').fetchone()
print(json.loads(row[0]))
PY
```
把打印出的 `ModelRatio` 旧值，用 `PUT /api/option/`（curl，带认证头）写回目标站；再次读取确认该模型恢复原值。
Expected: 模型 ModelRatio 恢复到修改前的值。

- [ ] **Step 4: 记录结果并 Commit**

在 `backend/scripts/integration_readme.md` 记录以上三步的实际输出（连接项数、改前/改后/回滚后的值）。

```bash
git add backend/scripts/integration_readme.md
git commit -m "test: P1 integration verification on singapore daily"
```

---

## Self-Review

**1. Spec coverage（对照 spec 各节）：**
- §2 调研结论 → 内建于各任务的实现（option keys、API、认证头、smoke test）。✅
- §3 技术栈（Go/chi/modernc sqlite/拷贝 billingexpr）→ Task 1/5/8。✅
- §4 项目结构 → 各任务文件路径一致。✅
- §5 数据模型（sites/snapshots/audit）→ Task 5。✅
- §6 规范化价格模型 → Task 3。✅
- §7 数据流（读/编辑写）→ Task 6/7/9。✅（同步写入的「多目标/diff」属 P2，本计划不含。）
- §8 安全流程（写前校验 + 快照 + 失败即停 + 审计）→ Task 7。✅（预览 diff 的完整 UI 属 P2；单站编辑通过「保存前展示改动数 + 快照」覆盖 P1 范围。）
- §9 HTTP 接口 → sites/test/pricing/validate-expr 已实现（Task 8/9）；diff/sync/snapshots/rollback/audit 属 P2/P3。✅（范围内齐全）
- §10 前端页面 → Sites（Task 12）、Editor（Task 13）；Sync/History 属 P2/P3。✅
- §11 测试计划 → pricing/validate/store/newapi/editsvc 单测 + 集成验证（Task 14）。✅
- §13 风险「CompletionRatio 硬编码可能被忽略」→ P1 未在 UI 特别提示；**补充说明**：P1 允许写入 CompletionRatio，若目标站忽略，集成验证会发现（值未变）。P2 diff 阶段再加显式提示。可接受。

**2. Placeholder scan：** Task 5 与 Task 10 中出现「占位 → 修正」的写法（`now()` 占位声明、`root` 装配的修正步骤），均在同任务内给出完整最终代码，不留 TBD。Task 14 的回滚为手动步骤（P3 出 UI），已明确标注。无 "TODO/待补充" 残留。

**3. Type consistency：** `pricing.Edit{Model,Field,Value,Delete}`、`pricing.Field` 常量、`pricing.OptionSet`、`editsvc.OptionRW`（`GetOptions`/`PutOption` 与 `newapi.Client` 方法签名一致）、`editsvc.Result{ChangedKeys,SnapshotID}`、`store` 各方法签名，在定义任务与消费任务间一致。前端 `putPricing(id, edits)` 发送 `{edits:[{model,field,value}]}`，与后端 `putPricing` 的 `req.Edits []pricing.Edit` 对齐（JSON tag `model/field/value`）。✅

（P2 同步、P3 历史/回滚将在 P1 落地后各出独立 plan。）
