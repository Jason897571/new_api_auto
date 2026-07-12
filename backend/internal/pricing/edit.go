package pricing

import (
	"encoding/json"
	"fmt"
	"strconv"
)

type Field string

const (
	FieldModelRatio           Field = "ModelRatio"
	FieldCompletionRatio      Field = "CompletionRatio"
	FieldModelPrice           Field = "ModelPrice"
	FieldCacheRatio           Field = "CacheRatio"
	FieldCreateCacheRatio     Field = "CreateCacheRatio"
	FieldImageRatio           Field = "ImageRatio"
	FieldAudioRatio           Field = "AudioRatio"
	FieldAudioCompletionRatio Field = "AudioCompletionRatio"
	FieldBillingMode          Field = "BillingMode"
	FieldBillingExpr          Field = "BillingExpr"
)

// fieldToKey 把编辑字段映射到 option key，并标明是否为 float 型 map。
func fieldToKey(f Field) (key string, isFloat bool, ok bool) {
	switch f {
	case FieldModelRatio:
		return KeyModelRatio, true, true
	case FieldCompletionRatio:
		return KeyCompletionRatio, true, true
	case FieldModelPrice:
		return KeyModelPrice, true, true
	case FieldCacheRatio:
		return KeyCacheRatio, true, true
	case FieldCreateCacheRatio:
		return KeyCreateCacheRatio, true, true
	case FieldImageRatio:
		return KeyImageRatio, true, true
	case FieldAudioRatio:
		return KeyAudioRatio, true, true
	case FieldAudioCompletionRatio:
		return KeyAudioCompletionRatio, true, true
	case FieldBillingMode:
		return KeyBillingMode, false, true
	case FieldBillingExpr:
		return KeyBillingExpr, false, true
	}
	return "", false, false
}

type Edit struct {
	Model  string `json:"model"`
	Field  Field  `json:"field"`
	Value  string `json:"value"`
	Delete bool   `json:"delete"`
}

// ApplyEdits 把 edits 合并进 current，返回值发生变化的 option key -> 新完整 JSON。
// 未被任何 edit 触及的 key 不会出现在返回值里。
func ApplyEdits(current OptionSet, edits []Edit) (map[string]string, error) {
	// 按 key 分组待改动的 float / string map，惰性从 current 反序列化。
	floatMaps := map[string]map[string]float64{}
	strMaps := map[string]map[string]string{}
	touched := map[string]bool{}

	loadFloat := func(key string) (map[string]float64, error) {
		if m, ok := floatMaps[key]; ok {
			return m, nil
		}
		m := map[string]float64{}
		if raw := current[key]; raw != "" {
			if err := json.Unmarshal([]byte(raw), &m); err != nil {
				return nil, fmt.Errorf("load %s: %w", key, err)
			}
		}
		floatMaps[key] = m
		return m, nil
	}
	loadStr := func(key string) (map[string]string, error) {
		if m, ok := strMaps[key]; ok {
			return m, nil
		}
		m := map[string]string{}
		if raw := current[key]; raw != "" {
			if err := json.Unmarshal([]byte(raw), &m); err != nil {
				return nil, fmt.Errorf("load %s: %w", key, err)
			}
		}
		strMaps[key] = m
		return m, nil
	}

	for _, e := range edits {
		key, isFloat, ok := fieldToKey(e.Field)
		if !ok {
			return nil, fmt.Errorf("unknown field %q", e.Field)
		}
		touched[key] = true
		if isFloat {
			m, err := loadFloat(key)
			if err != nil {
				return nil, err
			}
			if e.Delete {
				delete(m, e.Model)
				continue
			}
			v, err := strconv.ParseFloat(e.Value, 64)
			if err != nil {
				return nil, fmt.Errorf("model %s field %s: %q not a number", e.Model, e.Field, e.Value)
			}
			m[e.Model] = v
		} else {
			m, err := loadStr(key)
			if err != nil {
				return nil, err
			}
			if e.Delete {
				delete(m, e.Model)
				continue
			}
			m[e.Model] = e.Value
		}
	}

	changed := map[string]string{}
	for key := range touched {
		var newRaw []byte
		var err error
		if m, ok := floatMaps[key]; ok {
			newRaw, err = json.Marshal(m)
		} else {
			newRaw, err = json.Marshal(strMaps[key])
		}
		if err != nil {
			return nil, err
		}
		// 与原值比较：语义相等则不算改动（避免 no-op 写入 + 快照）。
		if equalJSON(current[key], string(newRaw), key) {
			continue
		}
		changed[key] = string(newRaw)
	}
	return changed, nil
}

// equalJSON 判断两个 map JSON 是否语义相等（忽略 key 顺序）。
func equalJSON(a, b, key string) bool {
	isFloat := false
	for _, k := range RatioKeys {
		if k == key {
			isFloat = true
			break
		}
	}
	if isFloat {
		var ma, mb map[string]float64
		if a == "" {
			ma = map[string]float64{}
		} else if json.Unmarshal([]byte(a), &ma) != nil {
			return false
		}
		if json.Unmarshal([]byte(b), &mb) != nil {
			return false
		}
		if len(ma) != len(mb) {
			return false
		}
		for k, v := range ma {
			if mb[k] != v {
				return false
			}
		}
		return true
	}
	var ma, mb map[string]string
	if a == "" {
		ma = map[string]string{}
	} else if json.Unmarshal([]byte(a), &ma) != nil {
		return false
	}
	if json.Unmarshal([]byte(b), &mb) != nil {
		return false
	}
	if len(ma) != len(mb) {
		return false
	}
	for k, v := range ma {
		if mb[k] != v {
			return false
		}
	}
	return true
}
