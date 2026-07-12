package newapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"newapiauto/internal/pricing"
)

type Site struct {
	BaseURL string
	Token   string
	UserID  string
}

type Client struct {
	site Site
	http *http.Client
}

func New(s Site) *Client {
	s.BaseURL = strings.TrimRight(s.BaseURL, "/")
	return &Client{site: s, http: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.site.BaseURL+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.site.Token)
	req.Header.Set("New-Api-User", c.site.UserID)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s %s: http %d: %s", method, path, resp.StatusCode, string(b))
	}
	return b, nil
}

type optionsResp struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"data"`
}

func (c *Client) GetOptions(ctx context.Context) (pricing.OptionSet, error) {
	b, err := c.do(ctx, http.MethodGet, "/api/option/", nil)
	if err != nil {
		return nil, err
	}
	var parsed optionsResp
	if err := json.Unmarshal(b, &parsed); err != nil {
		return nil, fmt.Errorf("decode options: %w", err)
	}
	if !parsed.Success {
		return nil, fmt.Errorf("get options: %s", parsed.Message)
	}
	managed := map[string]bool{}
	for _, k := range pricing.ManagedKeys {
		managed[k] = true
	}
	out := pricing.OptionSet{}
	for _, kv := range parsed.Data {
		if managed[kv.Key] {
			out[kv.Key] = kv.Value
		}
	}
	return out, nil
}

type putResp struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func (c *Client) PutOption(ctx context.Context, key, value string) error {
	body, _ := json.Marshal(map[string]string{"key": key, "value": value})
	b, err := c.do(ctx, http.MethodPut, "/api/option/", body)
	if err != nil {
		return err
	}
	var parsed putResp
	if err := json.Unmarshal(b, &parsed); err != nil {
		return fmt.Errorf("decode put resp: %w", err)
	}
	if !parsed.Success {
		return fmt.Errorf("put %s: %s", key, parsed.Message)
	}
	return nil
}
