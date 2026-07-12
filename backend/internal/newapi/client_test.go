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
