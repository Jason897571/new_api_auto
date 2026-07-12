package editsvc

import (
	"context"
	"testing"

	"newapiauto/internal/pricing"
	"newapiauto/internal/store"
)

type fakeRW struct {
	opts pricing.OptionSet
	puts map[string]string
}

func (f *fakeRW) GetOptions(ctx context.Context) (pricing.OptionSet, error) { return f.opts, nil }
func (f *fakeRW) PutOption(ctx context.Context, key, value string) error {
	f.puts[key] = value
	f.opts[key] = value
	return nil
}

func TestApplyRatioSnapshotsOldValue(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{pricing.KeyModelRatio: `{"gpt-4o":2.5}`}, puts: map[string]string{}}
	res, err := Apply(context.Background(), st, 1, "sg", rw,
		[]pricing.Edit{{Model: "gpt-4o", Field: pricing.FieldModelRatio, Value: "3"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.ChangedKeys) != 1 || rw.puts[pricing.KeyModelRatio] == "" {
		t.Fatalf("expected 1 put, got %+v", rw.puts)
	}
	snap, _ := st.GetSnapshot(res.SnapshotID)
	if snap.Payload[pricing.KeyModelRatio] != `{"gpt-4o":2.5}` {
		t.Fatalf("snapshot should hold OLD value, got %q", snap.Payload[pricing.KeyModelRatio])
	}
}

func TestApplyRejectsBadExpr(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{}, puts: map[string]string{}}
	_, err := Apply(context.Background(), st, 1, "sg", rw, []pricing.Edit{
		{Model: "claude-x", Field: pricing.FieldBillingExpr, Value: `tier("base", p*-1)`},
	})
	if err == nil {
		t.Fatal("expected validation error for negative expr")
	}
	if len(rw.puts) != 0 {
		t.Fatal("nothing should be written when validation fails")
	}
}

func TestApplyNoChangeNoSnapshot(t *testing.T) {
	st, _ := store.Open(":memory:")
	rw := &fakeRW{opts: pricing.OptionSet{pricing.KeyModelRatio: `{"gpt-4o":2.5}`}, puts: map[string]string{}}
	res, err := Apply(context.Background(), st, 1, "sg", rw,
		[]pricing.Edit{{Model: "gpt-4o", Field: pricing.FieldModelRatio, Value: "2.5"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.ChangedKeys) != 0 || len(rw.puts) != 0 || res.SnapshotID != 0 {
		t.Fatalf("expected no-op, got %+v puts=%+v", res, rw.puts)
	}
}
