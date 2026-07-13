package editsvc

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	"newapiauto/internal/pricing"
	"newapiauto/internal/store"
	"newapiauto/internal/validate"
)

// ErrClient marks errors caused by client-side input problems (validation,
// unparseable values, unknown fields) detected before any upstream network
// call is made. Callers should map these to HTTP 400 rather than 502.
var ErrClient = errors.New("client error")

type OptionRW interface {
	GetOptions(ctx context.Context) (pricing.OptionSet, error)
	PutOption(ctx context.Context, key, value string) error
}

type Result struct {
	ChangedKeys []string `json:"changed_keys"`
	SnapshotID  int64    `json:"snapshot_id"`
}

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

func Apply(ctx context.Context, st *store.Store, siteID int64, siteName string, rw OptionRW, edits []pricing.Edit) (Result, error) {
	unlock := lockSite(siteID)
	defer unlock()
	// 1. 校验所有阶梯表达式 edit
	for _, e := range edits {
		if e.Field == pricing.FieldBillingExpr && !e.Delete {
			if err := validate.Expr(e.Value); err != nil {
				return Result{}, fmt.Errorf("%w: model %s expr invalid: %v", ErrClient, e.Model, err)
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
		return Result{}, fmt.Errorf("%w: %v", ErrClient, err)
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
	st.AddAudit(store.AuditEntry{Action: "edit", TargetSite: siteName,
		Keys: changedKeys, Models: models, Result: "success"})
	return Result{ChangedKeys: changedKeys, SnapshotID: snapID}, nil
}

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
