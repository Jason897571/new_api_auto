package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"newapiauto/internal/store"
)

type server struct{ st *store.Store }

func NewRouter(st *store.Store) http.Handler {
	s := &server{st: st}
	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		r.Get("/sites", s.listSites)
		r.Post("/sites", s.createSite)
		r.Put("/sites/{id}", s.updateSite)
		r.Delete("/sites/{id}", s.deleteSite)
		r.Post("/sites/{id}/test", s.testSite)
		// r.Get("/sites/{id}/pricing", s.getPricing)     // Task 9
		// r.Put("/sites/{id}/pricing", s.putPricing)      // Task 9
		// r.Post("/validate-expr", s.validateExpr)        // Task 9
	})
	return r
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"success": false, "message": msg})
}
