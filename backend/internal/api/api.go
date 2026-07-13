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
		r.Get("/sites/{id}/pricing", s.getPricing)
		r.Put("/sites/{id}/pricing", s.putPricing)
		r.Post("/validate-expr", s.validateExpr)
		r.Post("/diff", s.postDiff)
		r.Post("/sync/preview", s.postSyncPreview)
		r.Post("/sync", s.postSync)
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
