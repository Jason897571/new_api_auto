package api

import (
	"encoding/json"
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
