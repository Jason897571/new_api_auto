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

// TestSyncPerTargetIndependence 验证 sync 到多个目标时，一个目标失败不会影响另一个目标成功写入。
func TestSyncPerTargetIndependence(t *testing.T) {
	src := startFakeSite(t, `{"gpt-4o":3}`)
	defer src.Close()
	good := startFakeSite(t, `{"gpt-4o":2.5}`)
	defer good.Close()

	// broken 目标：GET 可用，但连接在同步前就被关闭，导致 PUT/GET 都失败。
	broken := startFakeSite(t, `{"gpt-4o":2.5}`)
	broken.Close()

	st, _ := store.Open(":memory:")
	srcID, _ := st.CreateSite(store.Site{Name: "src", BaseURL: src.URL, Token: "t", UserID: "1"})
	goodID, _ := st.CreateSite(store.Site{Name: "good", BaseURL: good.URL, Token: "t", UserID: "1"})
	brokenID, _ := st.CreateSite(store.Site{Name: "broken", BaseURL: broken.URL, Token: "t", UserID: "1"})
	r := NewRouter(st)

	body, _ := json.Marshal(map[string]any{
		"source_id":  srcID,
		"target_ids": []int64{goodID, brokenID},
		"selections": []map[string]any{
			{"model": "gpt-4o", "field": "ModelRatio"},
		},
	})
	req := httptest.NewRequest("POST", "/api/sync", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("sync status %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Targets []struct {
			TargetID int64  `json:"target_id"`
			Error    string `json:"error,omitempty"`
		} `json:"targets"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v: %s", err, w.Body.String())
	}
	if len(resp.Targets) != 2 {
		t.Fatalf("expected 2 target results, got %d: %s", len(resp.Targets), w.Body.String())
	}

	var goodRes, brokenRes *struct {
		TargetID int64  `json:"target_id"`
		Error    string `json:"error,omitempty"`
	}
	for i := range resp.Targets {
		switch resp.Targets[i].TargetID {
		case goodID:
			goodRes = &resp.Targets[i]
		case brokenID:
			brokenRes = &resp.Targets[i]
		}
	}
	if goodRes == nil || brokenRes == nil {
		t.Fatalf("missing target result: %s", w.Body.String())
	}
	if goodRes.Error != "" {
		t.Fatalf("good target should succeed, got error: %s", goodRes.Error)
	}
	if brokenRes.Error == "" {
		t.Fatalf("broken target should have an error")
	}
}
