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
	TargetID   int64    `json:"target_id"`
	TargetName string   `json:"target_name"`
	SnapshotID int64    `json:"snapshot_id,omitempty"`
	Changed    []string `json:"changed_keys,omitempty"`
	Error      string   `json:"error,omitempty"`
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
