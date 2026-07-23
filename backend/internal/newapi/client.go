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
	// 仅作兜底上限，避免无 deadline 的调用永久挂起；实际时限由各调用方传入的
	// context 控制（diff 30s、edit 40s、sync 120s 等）。原先 20s 的硬超时比这些
	// context 更短，会在大站点/多站点场景下把较大的 option 响应从中间截断。
	return &Client{site: s, http: &http.Client{Timeout: 150 * time.Second}}
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
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		// 不能吞掉读错误：响应被截断（超时/断连）时若忽略，会退化成误导性的
		// “unexpected end of JSON input”，掩盖真实原因。
		return nil, fmt.Errorf("%s %s: read body (http %d): %w", method, path, resp.StatusCode, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s %s: http %d: %s", method, path, resp.StatusCode, string(b))
	}
	if len(b) == 0 {
		return nil, fmt.Errorf("%s %s: empty response body (http %d)", method, path, resp.StatusCode)
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
