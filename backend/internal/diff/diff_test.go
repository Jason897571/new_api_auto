package diff

import (
	"testing"

	"newapiauto/internal/pricing"
)

func fp(v float64) *float64 { return &v }
func sp(s string) *string   { return &s }

func TestComputeDetectsRatioDiff(t *testing.T) {
	src := map[string]*pricing.ModelPricing{
		"gpt-4o": {Model: "gpt-4o", BillingMode: "ratio", ModelRatio: fp(3)},
		"same":   {Model: "same", BillingMode: "ratio", ModelRatio: fp(1)},
	}
	tgt := map[string]*pricing.ModelPricing{
		"gpt-4o": {Model: "gpt-4o", BillingMode: "ratio", ModelRatio: fp(2.5)},
		"same":   {Model: "same", BillingMode: "ratio", ModelRatio: fp(1)},
	}
	got := Compute(src, tgt)
	if len(got) != 1 || got[0].Model != "gpt-4o" {
		t.Fatalf("expected only gpt-4o to differ, got %+v", got)
	}
	if len(got[0].Fields) != 1 || got[0].Fields[0].Field != pricing.FieldModelRatio {
		t.Fatalf("expected ModelRatio diff, got %+v", got[0].Fields)
	}
	if *got[0].Fields[0].Source != "3" || *got[0].Fields[0].Target != "2.5" {
		t.Fatalf("wrong values: %+v", got[0].Fields[0])
	}
}

func TestComputeModelOnlyInSource(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"new": {Model: "new", BillingMode: "ratio", ModelRatio: fp(5)}}
	tgt := map[string]*pricing.ModelPricing{}
	got := Compute(src, tgt)
	if len(got) != 1 || got[0].Fields[0].Source == nil || got[0].Fields[0].Target != nil {
		t.Fatalf("expected source-only diff, got %+v", got)
	}
}

func TestComputeTieredExprDiff(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "tiered_expr", BillingExpr: sp(`tier("base", p*3)`)}}
	tgt := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "tiered_expr", BillingExpr: sp(`tier("base", p*6)`)}}
	got := Compute(src, tgt)
	if len(got) != 1 {
		t.Fatalf("expected expr diff, got %+v", got)
	}
	foundExpr := false
	for _, f := range got[0].Fields {
		if f.Field == pricing.FieldBillingExpr {
			foundExpr = true
		}
	}
	if !foundExpr {
		t.Fatalf("expected BillingExpr diff, got %+v", got[0].Fields)
	}
}

func TestComputeBillingModeDiff(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "tiered_expr"}}
	tgt := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "ratio"}}
	got := Compute(src, tgt)
	if len(got) != 1 {
		t.Fatalf("expected a diff, got %+v", got)
	}
	found := false
	for _, f := range got[0].Fields {
		if f.Field == pricing.FieldBillingMode {
			found = true
			if f.Source == nil || f.Target == nil || *f.Source != "tiered_expr" || *f.Target != "ratio" {
				t.Fatalf("wrong mode diff: %+v", f)
			}
		}
	}
	if !found {
		t.Fatalf("expected BillingMode diff, got %+v", got[0].Fields)
	}
}
