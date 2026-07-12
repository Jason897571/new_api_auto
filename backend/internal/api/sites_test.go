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
