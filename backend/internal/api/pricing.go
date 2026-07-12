package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"

	"newapiauto/internal/editsvc"
	"newapiauto/internal/pricing"
	"newapiauto/internal/validate"
)

func (s *server) getPricing(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	c, _, err := s.clientForSite(id)
	if err != nil {
		writeErr(w, 404, "site not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	opts, err := c.GetOptions(ctx)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	byModel, err := pricing.Parse(opts)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	models := make([]*pricing.ModelPricing, 0, len(byModel))
	for _, mp := range byModel {
		models = append(models, mp)
	}
	sort.Slice(models, func(i, j int) bool { return models[i].Model < models[j].Model })
	writeJSON(w, 200, map[string]any{"models": models})
}

func (s *server) validateExpr(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Expr string `json:"expr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	if err := validate.Expr(req.Expr); err != nil {
		writeJSON(w, 200, map[string]any{"valid": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"valid": true})
}

func (s *server) putPricing(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	var req struct {
		Edits []pricing.Edit `json:"edits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	c, site, err := s.clientForSite(id)
	if err != nil {
		writeErr(w, 404, "site not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	res, err := editsvc.Apply(ctx, s.st, id, site.Name, c, req.Edits)
	if err != nil {
		if errors.Is(err, editsvc.ErrClient) {
			writeErr(w, 400, err.Error())
		} else {
			writeErr(w, 502, err.Error())
		}
		return
	}
	writeJSON(w, 200, res)
}
