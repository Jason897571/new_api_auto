package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
)

func TestValidateExprEndpoint(t *testing.T) {
	r := newTestRouter(t)

	body, _ := json.Marshal(map[string]string{"expr": `tier("base", p*3)`})
	req := httptest.NewRequest("POST", "/api/validate-expr", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	var ok map[string]any
	json.Unmarshal(w.Body.Bytes(), &ok)
	if ok["valid"] != true {
		t.Fatalf("expected valid, got %s", w.Body.String())
	}

	body, _ = json.Marshal(map[string]string{"expr": `tier("base", p*-1)`})
	req = httptest.NewRequest("POST", "/api/validate-expr", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	var bad map[string]any
	json.Unmarshal(w.Body.Bytes(), &bad)
	if bad["valid"] != false {
		t.Fatalf("expected invalid, got %s", w.Body.String())
	}
}

func TestPutPricingBadNumberReturns400(t *testing.T) {
	r := newTestRouter(t)

	body, _ := json.Marshal(map[string]string{"name": "sg", "base_url": "http://x", "token": "tk", "user_id": "1"})
	req := httptest.NewRequest("POST", "/api/sites", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("create status %d: %s", w.Code, w.Body.String())
	}
	var site struct {
		ID int64 `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &site)

	body, _ = json.Marshal(map[string]any{
		"edits": []map[string]string{
			{"model": "m", "field": "BillingExpr", "value": `tier("base", p*-1)`},
		},
	})
	req = httptest.NewRequest("PUT", fmt.Sprintf("/api/sites/%d/pricing", site.ID), bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}
