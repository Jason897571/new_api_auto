package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// SPAHandler 提供静态文件；非 /api 且文件不存在时回退到 index.html。
func SPAHandler(dir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		clean := filepath.Clean(r.URL.Path)
		full := filepath.Join(dir, clean)
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			http.ServeFile(w, r, full)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	}
}
