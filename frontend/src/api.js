async function req(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`)
  return data
}

export const getSites = () => req('GET', '/api/sites')
export const createSite = (s) => req('POST', '/api/sites', s)
export const updateSite = (id, s) => req('PUT', `/api/sites/${id}`, s)
export const deleteSite = (id) => req('DELETE', `/api/sites/${id}`)
export const testSite = (id) => req('POST', `/api/sites/${id}/test`)
export const getPricing = (id) => req('GET', `/api/sites/${id}/pricing`)
export const putPricing = (id, edits) => req('PUT', `/api/sites/${id}/pricing`, { edits })
export const validateExpr = (expr) => req('POST', '/api/validate-expr', { expr })
export const getDiff = (sourceId, targetId) =>
  req('POST', '/api/diff', { source_id: sourceId, target_id: targetId })
export const syncPreview = (sourceId, targetIds, selections) =>
  req('POST', '/api/sync/preview', { source_id: sourceId, target_ids: targetIds, selections })
export const runSync = (sourceId, targetIds, selections) =>
  req('POST', '/api/sync', { source_id: sourceId, target_ids: targetIds, selections })
export const getSnapshots = (siteId) => req('GET', `/api/sites/${siteId}/snapshots`)
export const rollbackSnapshot = (snapshotId) => req('POST', `/api/snapshots/${snapshotId}/rollback`)
