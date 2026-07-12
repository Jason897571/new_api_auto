package pricing

import (
	"encoding/json"
	"testing"
)

func TestApplyEditsRatio(t *testing.T) {
	cur := OptionSet{KeyModelRatio: `{"gpt-4o":2.5,"other":1}`}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "gpt-4o", Field: FieldModelRatio, Value: "3.0"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 1 {
		t.Fatalf("expected 1 changed key, got %d", len(changed))
	}
	var m map[string]float64
	json.Unmarshal([]byte(changed[KeyModelRatio]), &m)
	if m["gpt-4o"] != 3.0 || m["other"] != 1 {
		t.Fatalf("merge wrong: %+v", m)
	}
}

func TestApplyEditsDelete(t *testing.T) {
	cur := OptionSet{KeyModelPrice: `{"dall-e-3":0.04,"veo":0.6}`}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "dall-e-3", Field: FieldModelPrice, Delete: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]float64
	json.Unmarshal([]byte(changed[KeyModelPrice]), &m)
	if _, ok := m["dall-e-3"]; ok {
		t.Fatal("dall-e-3 should be deleted")
	}
	if m["veo"] != 0.6 {
		t.Fatal("veo should remain")
	}
}

func TestApplyEditsTiered(t *testing.T) {
	cur := OptionSet{}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "claude-x", Field: FieldBillingMode, Value: "tiered_expr"},
		{Model: "claude-x", Field: FieldBillingExpr, Value: `tier("base", p*3)`},
	})
	if err != nil {
		t.Fatal(err)
	}
	var mode map[string]string
	json.Unmarshal([]byte(changed[KeyBillingMode]), &mode)
	if mode["claude-x"] != "tiered_expr" {
		t.Fatalf("mode wrong: %+v", mode)
	}
	var expr map[string]string
	json.Unmarshal([]byte(changed[KeyBillingExpr]), &expr)
	if expr["claude-x"] != `tier("base", p*3)` {
		t.Fatalf("expr wrong: %+v", expr)
	}
}

func TestApplyEditsNoopWhenSame(t *testing.T) {
	cur := OptionSet{KeyModelRatio: `{"gpt-4o":2.5}`}
	changed, err := ApplyEdits(cur, []Edit{
		{Model: "gpt-4o", Field: FieldModelRatio, Value: "2.5"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 0 {
		t.Fatalf("expected no change, got %+v", changed)
	}
}
