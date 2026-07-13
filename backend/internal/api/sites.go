package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"newapiauto/internal/newapi"
	"newapiauto/internal/store"
)

func idParam(r *http.Request) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
}

func (s *server) listSites(w http.ResponseWriter, r *http.Request) {
	sites, err := s.st.ListSites()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if sites == nil {
		sites = []store.Site{}
	}
	writeJSON(w, 200, sites)
}

func (s *server) createSite(w http.ResponseWriter, r *http.Request) {
	var site store.Site
	if err := json.NewDecoder(r.Body).Decode(&site); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	id, err := s.st.CreateSite(site)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"id": id})
}

func (s *server) updateSite(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	var site store.Site
	if err := json.NewDecoder(r.Body).Decode(&site); err != nil {
		writeErr(w, 400, "bad body")
		return
	}
	site.ID = id
	if err := s.st.UpdateSite(site); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}

func (s *server) deleteSite(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	if err := s.st.DeleteSite(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}

func (s *server) clientForSite(id int64) (*newapi.Client, store.Site, error) {
	site, err := s.st.GetSite(id)
	if err != nil {
		return nil, site, err
	}
	return newapi.New(newapi.Site{BaseURL: site.BaseURL, Token: site.Token, UserID: site.UserID}), site, nil
}

func (s *server) testSite(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	c, _, err := s.clientForSite(id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, 404, "site not found")
		} else {
			writeErr(w, 500, err.Error())
		}
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	opts, err := c.GetOptions(ctx)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "count": len(opts)})
}
