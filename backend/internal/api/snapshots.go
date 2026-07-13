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
