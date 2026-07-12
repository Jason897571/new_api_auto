package editsvc

import (
	"context"
	"errors"
	"fmt"

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

func Apply(ctx context.Context, st *store.Store, siteID int64, siteName string, rw OptionRW, edits []pricing.Edit) (Result, error) {
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
