package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // sqlite：串行化写，避免 :memory: 多连接各自建表
	schema := `
CREATE TABLE IF NOT EXISTS sites(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT,
  token TEXT, user_id TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, created_at INTEGER,
  reason TEXT, payload_json TEXT);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, action TEXT,
  source_site TEXT, target_site TEXT, keys_json TEXT, models_json TEXT, result TEXT);`
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

type Site struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	BaseURL   string `json:"base_url"`
	Token     string `json:"token"`
	UserID    string `json:"user_id"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func now() int64 { return time.Now().Unix() }

func (s *Store) CreateSite(site Site) (int64, error) {
	t := now()
	res, err := s.db.Exec(`INSERT INTO sites(name,base_url,token,user_id,created_at,updated_at)
		VALUES(?,?,?,?,?,?)`, site.Name, site.BaseURL, site.Token, site.UserID, t, t)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func scanSite(row interface{ Scan(...interface{}) error }) (Site, error) {
	var s Site
	err := row.Scan(&s.ID, &s.Name, &s.BaseURL, &s.Token, &s.UserID, &s.CreatedAt, &s.UpdatedAt)
	return s, err
}

func (s *Store) GetSite(id int64) (Site, error) {
	row := s.db.QueryRow(`SELECT id,name,base_url,token,user_id,created_at,updated_at FROM sites WHERE id=?`, id)
	return scanSite(row)
}

func (s *Store) ListSites() ([]Site, error) {
	rows, err := s.db.Query(`SELECT id,name,base_url,token,user_id,created_at,updated_at FROM sites ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Site
	for rows.Next() {
		st, err := scanSite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) UpdateSite(site Site) error {
	_, err := s.db.Exec(`UPDATE sites SET name=?,base_url=?,token=?,user_id=?,updated_at=? WHERE id=?`,
		site.Name, site.BaseURL, site.Token, site.UserID, now(), site.ID)
	return err
}

func (s *Store) DeleteSite(id int64) error {
	_, err := s.db.Exec(`DELETE FROM sites WHERE id=?`, id)
	return err
}

type Snapshot struct {
	ID        int64             `json:"id"`
	SiteID    int64             `json:"site_id"`
	CreatedAt int64             `json:"created_at"`
	Reason    string            `json:"reason"`
	Payload   map[string]string `json:"payload"`
}

func (s *Store) CreateSnapshot(siteID int64, reason string, payload map[string]string) (int64, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	res, err := s.db.Exec(`INSERT INTO snapshots(site_id,created_at,reason,payload_json) VALUES(?,?,?,?)`,
		siteID, now(), reason, string(b))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) GetSnapshot(id int64) (Snapshot, error) {
	var snap Snapshot
	var payload string
	err := s.db.QueryRow(`SELECT id,site_id,created_at,reason,payload_json FROM snapshots WHERE id=?`, id).
		Scan(&snap.ID, &snap.SiteID, &snap.CreatedAt, &snap.Reason, &payload)
	if err != nil {
		return snap, err
	}
	if err := json.Unmarshal([]byte(payload), &snap.Payload); err != nil {
		return snap, fmt.Errorf("decode snapshot payload: %w", err)
	}
	return snap, nil
}

func (s *Store) ListSnapshots(siteID int64) ([]Snapshot, error) {
	rows, err := s.db.Query(`SELECT id,site_id,created_at,reason,payload_json FROM snapshots WHERE site_id=? ORDER BY id DESC`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Snapshot
	for rows.Next() {
		var snap Snapshot
		var payload string
		if err := rows.Scan(&snap.ID, &snap.SiteID, &snap.CreatedAt, &snap.Reason, &payload); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(payload), &snap.Payload)
		out = append(out, snap)
	}
	return out, rows.Err()
}

type AuditEntry struct {
	ID         int64    `json:"id"`
	TS         int64    `json:"ts"`
	Action     string   `json:"action"`
	SourceSite string   `json:"source_site"`
	TargetSite string   `json:"target_site"`
	Keys       []string `json:"keys"`
	Models     []string `json:"models"`
	Result     string   `json:"result"`
}

func (s *Store) AddAudit(a AuditEntry) (int64, error) {
	kb, _ := json.Marshal(a.Keys)
	mb, _ := json.Marshal(a.Models)
	res, err := s.db.Exec(`INSERT INTO audit(ts,action,source_site,target_site,keys_json,models_json,result)
		VALUES(?,?,?,?,?,?,?)`, now(), a.Action, a.SourceSite, a.TargetSite, string(kb), string(mb), a.Result)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) ListAudit(limit int) ([]AuditEntry, error) {
	rows, err := s.db.Query(`SELECT id,ts,action,source_site,target_site,keys_json,models_json,result FROM audit ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var a AuditEntry
		var kb, mb string
		if err := rows.Scan(&a.ID, &a.TS, &a.Action, &a.SourceSite, &a.TargetSite, &kb, &mb, &a.Result); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(kb), &a.Keys)
		json.Unmarshal([]byte(mb), &a.Models)
		out = append(out, a)
	}
	return out, rows.Err()
}
