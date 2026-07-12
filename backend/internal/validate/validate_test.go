package validate

import "testing"

func TestExprValid(t *testing.T) {
	if err := Expr(`tier("base", p*3 + c*15 + cr*0.3)`); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
}

func TestExprSyntaxError(t *testing.T) {
	if err := Expr(`tier("base", p*3 +`); err == nil {
		t.Fatal("expected compile error, got nil")
	}
}

func TestExprNegativeRejected(t *testing.T) {
	// 负系数会在样本向量下产生负值，必须被拒绝
	if err := Expr(`tier("base", p*-1)`); err == nil {
		t.Fatal("expected negative-result error, got nil")
	}
}
