package pricing

// 价格化显示：把 new-api 的倍率换算成直观的真实价格（$/1M tokens）。
// 基准：输入价 = ModelRatio × 2；其余倍率都是相对输入的 per-token 倍率。
// 与前端 Editor.jsx 的换算表保持一致（见 docs/.../price-display-design.md）。

// InputPrice 返回输入价 = ModelRatio × 2；ModelRatio 未设置时返回 nil。
func InputPrice(m *ModelPricing) *float64 {
	if m == nil || m.ModelRatio == nil {
		return nil
	}
	v := *m.ModelRatio * 2
	return &v
}

// rel 返回 输入价 × ratio；输入价或 ratio 缺失时返回 nil。
func rel(m *ModelPricing, ratio *float64) *float64 {
	ip := InputPrice(m)
	if ip == nil || ratio == nil {
		return nil
	}
	v := *ip * *ratio
	return &v
}

// DisplayPrice 计算某字段在该模型上的显示价格（nil = 不可换算 / 无该字段）。
func DisplayPrice(m *ModelPricing, f Field) *float64 {
	if m == nil {
		return nil
	}
	switch f {
	case FieldModelRatio:
		return InputPrice(m)
	case FieldModelPrice:
		return m.ModelPrice // 本就是真实价格
	case FieldCompletionRatio:
		return rel(m, m.CompletionRatio)
	case FieldCacheRatio:
		return rel(m, m.CacheRatio)
	case FieldCreateCacheRatio:
		return rel(m, m.CreateCacheRatio)
	case FieldImageRatio:
		return rel(m, m.ImageRatio)
	case FieldAudioRatio:
		return rel(m, m.AudioRatio)
	case FieldAudioCompletionRatio:
		// 音频输出价 = 输入价 × AudioRatio × AudioCompletionRatio
		ip := InputPrice(m)
		if ip == nil || m.AudioRatio == nil || m.AudioCompletionRatio == nil {
			return nil
		}
		v := *ip * *m.AudioRatio * *m.AudioCompletionRatio
		return &v
	}
	return nil
}

// PriceLabel 返回字段的中文价格标签。
func PriceLabel(f Field) string {
	switch f {
	case FieldModelRatio:
		return "输入价"
	case FieldCompletionRatio:
		return "输出价"
	case FieldCacheRatio:
		return "缓存读价"
	case FieldCreateCacheRatio:
		return "缓存写价"
	case FieldImageRatio:
		return "图片价"
	case FieldAudioRatio:
		return "音频输入价"
	case FieldAudioCompletionRatio:
		return "音频输出价"
	case FieldModelPrice:
		return "按次价"
	case FieldBillingMode:
		return "计费模式"
	case FieldBillingExpr:
		return "阶梯表达式"
	}
	return string(f)
}
