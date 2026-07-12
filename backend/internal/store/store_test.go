package store

import "testing"

func TestSiteCRUD(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	id, err := st.CreateSite(Site{Name: "sg", BaseURL: "http://x", Token: "tk", UserID: "1"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := st.GetSite(id)
	if err != nil || got.Name != "sg" || got.Token != "tk" {
		t.Fatalf("get wrong: %+v err=%v", got, err)
	}
	got.Name = "sg2"
	if err := st.UpdateSite(got); err != nil {
		t.Fatal(err)
	}
	list, _ := st.ListSites()
	if len(list) != 1 || list[0].Name != "sg2" {
		t.Fatalf("list wrong: %+v", list)
	}
	if err := st.DeleteSite(id); err != nil {
		t.Fatal(err)
	}
	list, _ = st.ListSites()
	if len(list) != 0 {
		t.Fatalf("expected empty after delete")
	}
}

func TestSnapshotRoundTrip(t *testing.T) {
	st, _ := Open(":memory:")
	payload := map[string]string{"ModelRatio": `{"a":1}`}
	id, err := st.CreateSnapshot(7, "manual edit", payload)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := st.GetSnapshot(id)
	if err != nil {
		t.Fatal(err)
	}
	if snap.SiteID != 7 || snap.Payload["ModelRatio"] != `{"a":1}` {
		t.Fatalf("snapshot wrong: %+v", snap)
	}
}

func TestAudit(t *testing.T) {
	st, _ := Open(":memory:")
	_, err := st.AddAudit(AuditEntry{Action: "edit", TargetSite: "sg", Keys: []string{"ModelRatio"}, Models: []string{"gpt-4o"}, Result: "success"})
	if err != nil {
		t.Fatal(err)
	}
	list, _ := st.ListAudit(10)
	if len(list) != 1 || list[0].Keys[0] != "ModelRatio" {
		t.Fatalf("audit wrong: %+v", list)
	}
}
