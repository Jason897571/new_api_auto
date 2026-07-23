package pricing

import "testing"

func fptr(v float64) *float64 { return &v }

func TestDisplayPrice(t *testing.T) {
	m := &ModelPricing{
		Model:                "gpt-x",
		ModelRatio:           fptr(1.25), // 输入价 = 2.5
		CompletionRatio:      fptr(4),    // 输出价 = 2.5 × 4 = 10
		CacheRatio:           fptr(0.5),  // 缓存读价 = 2.5 × 0.5 = 1.25
		ImageRatio:           fptr(2),    // 图片价 = 5
		AudioRatio:           fptr(10),   // 音频输入价 = 25
		AudioCompletionRatio: fptr(2),    // 音频输出价 = 25 × 2 = 50
		ModelPrice:           fptr(0.04), // 按次价保持
	}
	cases := []struct {
		f    Field
		want float64
	}{
		{FieldModelRatio, 2.5},
		{FieldCompletionRatio, 10},
		{FieldCacheRatio, 1.25},
		{FieldImageRatio, 5},
		{FieldAudioRatio, 25},
		{FieldAudioCompletionRatio, 50},
		{FieldModelPrice, 0.04},
	}
	for _, c := range cases {
		got := DisplayPrice(m, c.f)
		if got == nil {
			t.Fatalf("%s: got nil, want %v", c.f, c.want)
		}
		if *got != c.want {
			t.Errorf("%s: got %v, want %v", c.f, *got, c.want)
		}
	}
}

func TestDisplayPriceUnsetInput(t *testing.T) {
	// 输入价缺失时，相对价格不可换算，应返回 nil（而非 panic 或 0）。
	m := &ModelPricing{Model: "x", CompletionRatio: fptr(4)}
	if got := DisplayPrice(m, FieldCompletionRatio); got != nil {
		t.Errorf("expected nil output price when input unset, got %v", *got)
	}
	if got := DisplayPrice(m, FieldModelRatio); got != nil {
		t.Errorf("expected nil input price when ModelRatio unset, got %v", *got)
	}
}
