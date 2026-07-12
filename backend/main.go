package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"newapiauto/internal/api"
	"newapiauto/internal/store"
)

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	dbPath := flag.String("db", "./data/app.db", "sqlite db path")
	staticDir := flag.String("static", "./frontend/dist", "frontend dist dir")
	flag.Parse()

	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		log.Fatal(err)
	}
	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatal(err)
	}

	apiRouter := api.NewRouter(st)
	spa := api.SPAHandler(*staticDir)
	mux := http.NewServeMux()
	mux.Handle("/api/", apiRouter) // 所有 /api/* 交给 chi（其内部路由含 /api 前缀）
	mux.Handle("/", spa)           // 其余交给 SPA

	log.Printf("listening on %s (db=%s static=%s)", *addr, *dbPath, *staticDir)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
