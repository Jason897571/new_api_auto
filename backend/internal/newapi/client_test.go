package newapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

// 目标站响应被截断（声明的 Content-Length 大于实际写入后提前断连）时，
// 客户端应报出“读取截断”的真实原因，而不是误导的 JSON 解码错误。
func TestGetOptionsSurfacesTruncatedRead(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Fatal("hijack unsupported")
		}
		conn, bufrw, err := hj.Hijack()
		if err != nil {
			t.Fatal(err)
		}
		bufrw.WriteString("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n")
		bufrw.WriteString(`{"success":true,"data":[`) // 只写了一部分
		bufrw.Flush()
		conn.Close() // 提前断连 → 客户端读到 unexpected EOF
	}))
	defer srv.Close()

	c := New(Site{BaseURL: srv.URL, Token: "tk", UserID: "1"})
	_, err := c.GetOptions(context.Background())
	if err == nil {
		t.Fatal("expected error on truncated body")
	}
	if strings.Contains(err.Error(), "unexpected end of JSON input") {
		t.Fatalf("read failure masked as JSON decode error: %v", err)
	}
}

// 目标站返回 200 但 body 为空时，应给出明确的“空响应”错误。
func TestGetOptionsEmptyBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK) // 空 body
	}))
	defer srv.Close()

	c := New(Site{BaseURL: srv.URL, Token: "tk", UserID: "1"})
	_, err := c.GetOptions(context.Background())
	if err == nil {
		t.Fatal("expected error on empty body")
	}
	if strings.Contains(err.Error(), "unexpected end of JSON input") {
		t.Fatalf("empty body should give a clear error, got: %v", err)
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
