package pricing

import "testing"

func f(v float64) *float64 { return &v }

func TestParseRatioAndTiered(t *testing.T) {
	opts := OptionSet{
		KeyModelRatio:      `{"gpt-4o":2.5,"claude-x":3}`,
		KeyCompletionRatio: `{"gpt-4o":4}`,
		KeyBillingMode:     `{"claude-x":"tiered_expr"}`,
		KeyBillingExpr:     `{"claude-x":"tier(\"base\", p*3)"}`,
	}
	got, err := Parse(opts)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got["gpt-4o"].BillingMode != "ratio" {
		t.Errorf("gpt-4o mode = %q, want ratio", got["gpt-4o"].BillingMode)
	}
	if got["gpt-4o"].ModelRatio == nil || *got["gpt-4o"].ModelRatio != 2.5 {
		t.Errorf("gpt-4o ModelRatio wrong: %+v", got["gpt-4o"].ModelRatio)
	}
	if got["gpt-4o"].CompletionRatio == nil || *got["gpt-4o"].CompletionRatio != 4 {
		t.Errorf("gpt-4o CompletionRatio wrong")
	}
	if got["claude-x"].BillingMode != "tiered_expr" {
		t.Errorf("claude-x mode = %q, want tiered_expr", got["claude-x"].BillingMode)
	}
	if got["claude-x"].BillingExpr == nil || *got["claude-x"].BillingExpr != `tier("base", p*3)` {
		t.Errorf("claude-x expr wrong: %v", got["claude-x"].BillingExpr)
	}
}

func TestParseInvalidJSON(t *testing.T) {
	if _, err := Parse(OptionSet{KeyModelRatio: `{bad`}); err == nil {
		t.Fatal("expected error on bad JSON")
	}
}
