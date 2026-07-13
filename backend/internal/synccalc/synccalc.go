package synccalc

import (
	"strconv"

	"newapiauto/internal/pricing"
)

type Selection struct {
	Model string        `json:"model"`
	Field pricing.Field `json:"field"`
}

func fmtFloat(p *float64) (string, bool) {
	if p == nil {
		return "", false
	}
	return strconv.FormatFloat(*p, 'f', -1, 64), true
}

// sourceValue 返回源站某模型某字段的字符串值与是否存在。
func sourceValue(m *pricing.ModelPricing, f pricing.Field) (string, bool) {
	if m == nil {
		return "", false
	}
	switch f {
	case pricing.FieldModelRatio:
		return fmtFloat(m.ModelRatio)
	case pricing.FieldCompletionRatio:
		return fmtFloat(m.CompletionRatio)
	case pricing.FieldModelPrice:
		return fmtFloat(m.ModelPrice)
	case pricing.FieldCacheRatio:
		return fmtFloat(m.CacheRatio)
	case pricing.FieldCreateCacheRatio:
		return fmtFloat(m.CreateCacheRatio)
	case pricing.FieldImageRatio:
		return fmtFloat(m.ImageRatio)
	case pricing.FieldAudioRatio:
		return fmtFloat(m.AudioRatio)
	case pricing.FieldAudioCompletionRatio:
		return fmtFloat(m.AudioCompletionRatio)
	case pricing.FieldBillingMode:
		if m.BillingMode == "" {
			return "", false
		}
		return m.BillingMode, true
	case pricing.FieldBillingExpr:
		if m.BillingExpr == nil {
			return "", false
		}
		return *m.BillingExpr, true
	}
	return "", false
}

// BuildEdits 把勾选项转成写目标站的 edits：取源站该模型该字段的值；源站无该值则生成删除。
func BuildEdits(source map[string]*pricing.ModelPricing, sels []Selection) []pricing.Edit {
	var edits []pricing.Edit
	for _, s := range sels {
		val, ok := sourceValue(source[s.Model], s.Field)
		if !ok {
			edits = append(edits, pricing.Edit{Model: s.Model, Field: s.Field, Delete: true})
			continue
		}
		edits = append(edits, pricing.Edit{Model: s.Model, Field: s.Field, Value: val})
	}
	return edits
}
