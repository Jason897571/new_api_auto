package diff

import (
	"sort"
	"strconv"

	"newapiauto/internal/pricing"
)

type FieldDiff struct {
	Field  pricing.Field `json:"field"`
	Source *string       `json:"source"`
	Target *string       `json:"target"`
}

type ModelDiff struct {
	Model  string      `json:"model"`
	Fields []FieldDiff `json:"fields"`
}

func fmtFloat(p *float64) *string {
	if p == nil {
		return nil
	}
	s := strconv.FormatFloat(*p, 'f', -1, 64)
	return &s
}

// ratioAccessor 返回某模型某 ratio 字段的字符串指针（nil=未设置）。
func ratioValue(m *pricing.ModelPricing, f pricing.Field) *string {
	if m == nil {
		return nil
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
	}
	return nil
}

func exprValue(m *pricing.ModelPricing) *string {
	if m == nil || m.BillingExpr == nil {
		return nil
	}
	return m.BillingExpr
}

func modeValue(m *pricing.ModelPricing) *string {
	if m == nil {
		return nil
	}
	s := m.BillingMode
	return &s
}

var ratioFields = []pricing.Field{
	pricing.FieldModelRatio, pricing.FieldCompletionRatio, pricing.FieldModelPrice,
	pricing.FieldCacheRatio, pricing.FieldCreateCacheRatio, pricing.FieldImageRatio,
	pricing.FieldAudioRatio, pricing.FieldAudioCompletionRatio,
}

func eqPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func Compute(source, target map[string]*pricing.ModelPricing) []ModelDiff {
	models := map[string]struct{}{}
	for m := range source {
		models[m] = struct{}{}
	}
	for m := range target {
		models[m] = struct{}{}
	}
	var out []ModelDiff
	for model := range models {
		s := source[model]
		t := target[model]
		var fields []FieldDiff
		for _, f := range ratioFields {
			sv, tv := ratioValue(s, f), ratioValue(t, f)
			if !eqPtr(sv, tv) {
				fields = append(fields, FieldDiff{Field: f, Source: sv, Target: tv})
			}
		}
		// BillingMode
		if sv, tv := modeValue(s), modeValue(t); !eqPtr(sv, tv) {
			fields = append(fields, FieldDiff{Field: pricing.FieldBillingMode, Source: sv, Target: tv})
		}
		// BillingExpr
		if sv, tv := exprValue(s), exprValue(t); !eqPtr(sv, tv) {
			fields = append(fields, FieldDiff{Field: pricing.FieldBillingExpr, Source: sv, Target: tv})
		}
		if len(fields) > 0 {
			out = append(out, ModelDiff{Model: model, Fields: fields})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Model < out[j].Model })
	return out
}
