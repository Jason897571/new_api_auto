import { useEffect, useState } from 'react'
import { getSites, getSnapshots, rollbackSnapshot } from '../api'

export default function History() {
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [snaps, setSnaps] = useState([])
  const [msg, setMsg] = useState('')

  useEffect(() => { getSites().then(setSites) }, [])

  const load = async (id) => {
    setSiteId(id); setMsg('加载中...')
    try { const r = await getSnapshots(id); setSnaps(r.snapshots || []); setMsg('') }
    catch (e) { setMsg(e.message) }
  }

  const rollback = async (snapId) => {
    if (!window.confirm(`确认回滚到快照 #${snapId}？会把该站相关价格还原为快照时的旧值。`)) return
    setMsg('回滚中...')
    try {
      const r = await rollbackSnapshot(snapId)
      setMsg(`回滚成功，还原 ${r.changed_keys?.length || 0} 个 option`)
      load(siteId)
    } catch (e) { setMsg('回滚失败: ' + e.message) }
  }

  const fmtTime = (t) => new Date(t * 1000).toLocaleString()

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <select value={siteId} onChange={(e) => load(Number(e.target.value))}>
          <option value="">选择站点...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {msg && <div style={{ padding: 8, background: '#eef', marginBottom: 10 }}>{msg}</div>}
      <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead><tr><th>快照ID</th><th>时间</th><th>原因</th><th>涉及option</th><th>操作</th></tr></thead>
        <tbody>
          {snaps.map((s) => (
            <tr key={s.id}>
              <td>#{s.id}</td>
              <td>{fmtTime(s.created_at)}</td>
              <td>{s.reason}</td>
              <td>{Object.keys(s.payload || {}).join(', ')}</td>
              <td><button onClick={() => rollback(s.id)}>回滚</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
