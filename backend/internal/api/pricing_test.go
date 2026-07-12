package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestValidateExprEndpoint(t *testing.T) {
	r := newTestRouter(t)

	body, _ := json.Marshal(map[string]string{"expr": `tier("base", p*3)`})
	req := httptest.NewRequest("POST", "/api/validate-expr", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var ok map[string]any
	json.Unmarshal(w.Body.Bytes(), &ok)
	if ok["valid"] != true {
		t.Fatalf("expected valid, got %s", w.Body.String())
	}

	body, _ = json.Marshal(map[string]string{"expr": `tier("base", p*-1)`})
	req = httptest.NewRequest("POST", "/api/validate-expr", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var bad map[string]any
	json.Unmarshal(w.Body.Bytes(), &bad)
	if bad["valid"] != false {
		t.Fatalf("expected invalid, got %s", w.Body.String())
	}
}
