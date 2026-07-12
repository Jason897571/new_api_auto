package pricing

import (
	"encoding/json"
	"fmt"
)

const (
	KeyModelRatio           = "ModelRatio"
	KeyCompletionRatio      = "CompletionRatio"
	KeyModelPrice           = "ModelPrice"
	KeyCacheRatio           = "CacheRatio"
	KeyCreateCacheRatio     = "CreateCacheRatio"
	KeyImageRatio           = "ImageRatio"
	KeyAudioRatio           = "AudioRatio"
	KeyAudioCompletionRatio = "AudioCompletionRatio"
	KeyBillingMode          = "billing_setting.billing_mode"
	KeyBillingExpr          = "billing_setting.billing_expr"
)

// RatioKeys 是 value 为 map[string]float64 的 option key。
var RatioKeys = []string{
	KeyModelRatio, KeyCompletionRatio, KeyModelPrice, KeyCacheRatio,
	KeyCreateCacheRatio, KeyImageRatio, KeyAudioRatio, KeyAudioCompletionRatio,
}

// ManagedKeys 是本工具读写的全部 option key。
var ManagedKeys = append(append([]string{}, RatioKeys...), KeyBillingMode, KeyBillingExpr)

// OptionSet: option key -> 原始 JSON 值字符串（new-api 返回的形式）。
type OptionSet map[string]string

type ModelPricing struct {
	Model                string   `json:"model"`
	BillingMode          string   `json:"billing_mode"` // "ratio" | "tiered_expr"
	ModelRatio           *float64 `json:"model_ratio,omitempty"`
	CompletionRatio      *float64 `json:"completion_ratio,omitempty"`
	ModelPrice           *float64 `json:"model_price,omitempty"`
	CacheRatio           *float64 `json:"cache_ratio,omitempty"`
	CreateCacheRatio     *float64 `json:"create_cache_ratio,omitempty"`
	ImageRatio           *float64 `json:"image_ratio,omitempty"`
	AudioRatio           *float64 `json:"audio_ratio,omitempty"`
	AudioCompletionRatio *float64 `json:"audio_completion_ratio,omitempty"`
	BillingExpr          *string  `json:"billing_expr,omitempty"`
}

// ratioFieldSetter 把 ratio key 映射到 ModelPricing 上对应字段的写入器。
func ratioFieldSetter(mp *ModelPricing, key string) func(float64) {
	switch key {
	case KeyModelRatio:
		return func(v float64) { mp.ModelRatio = &v }
	case KeyCompletionRatio:
		return func(v float64) { mp.CompletionRatio = &v }
	case KeyModelPrice:
		return func(v float64) { mp.ModelPrice = &v }
	case KeyCacheRatio:
		return func(v float64) { mp.CacheRatio = &v }
	case KeyCreateCacheRatio:
		return func(v float64) { mp.CreateCacheRatio = &v }
	case KeyImageRatio:
		return func(v float64) { mp.ImageRatio = &v }
	case KeyAudioRatio:
		return func(v float64) { mp.AudioRatio = &v }
	case KeyAudioCompletionRatio:
		return func(v float64) { mp.AudioCompletionRatio = &v }
	}
	return nil
}

func ensure(m map[string]*ModelPricing, model string) *ModelPricing {
	if m[model] == nil {
		m[model] = &ModelPricing{Model: model, BillingMode: "ratio"}
	}
	return m[model]
}

// Parse 把原始 OptionSet 解析为 model -> *ModelPricing。
func Parse(opts OptionSet) (map[string]*ModelPricing, error) {
	out := make(map[string]*ModelPricing)

	for _, key := range RatioKeys {
		raw, ok := opts[key]
		if !ok || raw == "" {
			continue
		}
		var m map[string]float64
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			return nil, fmt.Errorf("parse %s: %w", key, err)
		}
		for model, v := range m {
			ratioFieldSetter(ensure(out, model), key)(v)
		}
	}

	if raw := opts[KeyBillingMode]; raw != "" {
		var m map[string]string
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			return nil, fmt.Errorf("parse %s: %w", KeyBillingMode, err)
		}
		for model, mode := range m {
			ensure(out, model).BillingMode = mode
		}
	}
	if raw := opts[KeyBillingExpr]; raw != "" {
		var m map[string]string
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			return nil, fmt.Errorf("parse %s: %w", KeyBillingExpr, err)
		}
		for model, expr := range m {
			e := expr
			ensure(out, model).BillingExpr = &e
		}
	}
	return out, nil
}
