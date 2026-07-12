package billingexpr

import "testing"

func TestCopiedEngineRuns(t *testing.T) {
	got, _, err := RunExprWithRequest(`tier("base", p*2 + c*4)`,
		TokenParams{P: 1000, C: 1000}, RequestInput{})
	if err != nil {
		t.Fatalf("run failed: %v", err)
	}
	if got != 6000 {
		t.Fatalf("got %v, want 6000", got)
	}
}
