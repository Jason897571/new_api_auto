# P2 Prerequisites & Deferred Findings (from P1 final review)

Tracked so P2 (sync) doesn't build on unguarded seams. None block P1 merge.

## Must land WITH P2 sync (they guard the live gateway)
- **Deterministic write ordering + rollback endpoint (coupled).** editsvc write loop iterates a map (nondeterministic). If a model's `billing_setting.billing_mode` and `billing_setting.billing_expr` both change and the 2nd PUT fails, the gateway is left half-updated. Fix: write `billing_expr` before `billing_mode`; ship the rollback endpoint (P3) alongside so partial failures are recoverable. (Not reachable from P1 UI today — see ratio→tiered limitation — but sync will trigger paired writes.)
- **Per-site write mutex.** editsvc does read-modify-write on the whole option map; concurrent writes to one site lose updates (TOCTOU). Add a per-site lock before multi-site sync makes concurrent writes likely.

## Known P1 limitations (document for users)
- **Editor cannot convert a ratio model to tiered.** It edits existing tiered exprs only; there is no BillingMode toggle to activate tiered on a ratio model. Add a paired BillingMode+BillingExpr edit if needed.

## Deferred Minor cleanups (P2 quality pass)
- pricing/parse_test.go: remove unused helper `f`
- pricing/edit.go: consolidate equalJSON float/string duplication; reuse fieldToKey's isFloat
- pricing tests: cover delete-nonexistent-model and unknown-field error path
- store.go: ListSnapshots/ListAudit/AddAudit discard json errors — log them (audit writes especially)
- newapi/client.go: do() swallows io.ReadAll error; add non-200 path test
- api/sites.go: writeJSON encode error swallowed; validate create/update fields; clientForSite maps DB error to 404 (distinguish 500)
- frontend: prune unused App.css/index.css/scaffold svgs; Editor.jsx dead filter(v!==undefined), redundant String(v), disabled={!siteId} edge case for id 0
