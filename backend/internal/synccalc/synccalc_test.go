package synccalc

import (
	"testing"

	"newapiauto/internal/pricing"
)

func fp(v float64) *float64 { return &v }
func sp(s string) *string   { return &s }

func TestBuildEditsRatio(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"gpt-4o": {Model: "gpt-4o", ModelRatio: fp(3)}}
	edits := BuildEdits(src, []Selection{{Model: "gpt-4o", Field: pricing.FieldModelRatio}})
	if len(edits) != 1 || edits[0].Value != "3" || edits[0].Delete {
		t.Fatalf("expected ModelRatio=3 edit, got %+v", edits)
	}
}

func TestBuildEditsDeletesWhenSourceMissing(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"gpt-4o": {Model: "gpt-4o"}} // no ModelRatio
	edits := BuildEdits(src, []Selection{{Model: "gpt-4o", Field: pricing.FieldModelRatio}})
	if len(edits) != 1 || !edits[0].Delete {
		t.Fatalf("expected delete edit when source lacks field, got %+v", edits)
	}
}

func TestBuildEditsExpr(t *testing.T) {
	src := map[string]*pricing.ModelPricing{"c": {Model: "c", BillingMode: "tiered_expr", BillingExpr: sp(`tier("base", p*3)`)}}
	edits := BuildEdits(src, []Selection{
		{Model: "c", Field: pricing.FieldBillingExpr},
		{Model: "c", Field: pricing.FieldBillingMode},
	})
	var exprVal, modeVal string
	for _, e := range edits {
		if e.Field == pricing.FieldBillingExpr {
			exprVal = e.Value
		}
		if e.Field == pricing.FieldBillingMode {
			modeVal = e.Value
		}
	}
	if exprVal != `tier("base", p*3)` || modeVal != "tiered_expr" {
		t.Fatalf("wrong expr/mode edits: %+v", edits)
	}
}
