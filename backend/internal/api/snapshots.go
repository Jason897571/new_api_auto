package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"newapiauto/internal/diff"
	"newapiauto/internal/editsvc"
	"newapiauto/internal/pricing"
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

// rollbackPreview 返回回滚将带来的改动：当前值 → 回滚后值（复用 diff + 价格）。
func (s *server) rollbackPreview(w http.ResponseWriter, r *http.Request) {
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
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, 404, "site not found")
		} else {
			writeErr(w, 500, err.Error())
		}
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	current, err := c.GetOptions(ctx)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	// restored = 当前 options 覆盖上快照旧值（空旧值 = 清空为 "{}"，与 Rollback 一致）。
	restored := pricing.OptionSet{}
	for k, v := range current {
		restored[k] = v
	}
	for k, v := range snap.Payload {
		if v == "" {
			v = "{}"
		}
		restored[k] = v
	}
	before, err := pricing.Parse(current)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	after, err := pricing.Parse(restored)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"site_name":   site.Name,
		"snapshot_id": snapID,
		"models":      diff.Compute(before, after), // source=当前, target=回滚后
	})
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
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, 404, "site not found")
		} else {
			writeErr(w, 500, err.Error())
		}
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
