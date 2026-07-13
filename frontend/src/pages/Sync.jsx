import { useEffect, useState } from 'react'
import { getSites, getDiff, syncPreview, runSync } from '../api'

export default function Sync() {
  const [sites, setSites] = useState([])
  const [sourceId, setSourceId] = useState('')
  const [targetIds, setTargetIds] = useState([])
  const [rows, setRows] = useState([]) // {model, field, source, targets: {tid: value|null}}
  const [sel, setSel] = useState({})   // `${model}|${field}` -> true
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => { getSites().then(setSites) }, [])

  const toggleTarget = (id) =>
    setTargetIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const loadDiff = async () => {
    setMsg('计算差异中...'); setRows([]); setSel({}); setPreview(null); setResult(null)
    try {
      // 对每个目标站拉 diff，按 model|field 合并
      const merged = {} // key -> {model, field, source, targets:{}}
      for (const tid of targetIds) {
        const d = await getDiff(Number(sourceId), tid)
        for (const m of d.models || []) {
          for (const f of m.fields) {
            const key = `${m.model}|${f.field}`
            if (!merged[key]) merged[key] = { model: m.model, field: f.field, source: f.source, targets: {} }
            merged[key].targets[tid] = f.target
          }
        }
      }
      setRows(Object.values(merged).sort((a, b) => (a.model + a.field).localeCompare(b.model + b.field)))
      setMsg('')
    } catch (e) { setMsg('差异计算失败: ' + e.message) }
  }

  const selections = () =>
    Object.keys(sel).filter((k) => sel[k]).map((k) => {
      const [model, field] = k.split('|')
      return { model, field }
    })

  const doPreview = async () => {
    const s = selections()
    if (!s.length) { setMsg('未勾选任何项'); return }
    setMsg('生成预览...')
    try { const p = await syncPreview(Number(sourceId), targetIds, s); setPreview(p.targets); setMsg('') }
    catch (e) { setMsg('预览失败: ' + e.message) }
  }

  const doSync = async () => {
    const s = selections()
    if (!s.length) return
    setMsg('同步中...')
    try {
      const r = await runSync(Number(sourceId), targetIds, s)
      setResult(r.targets); setMsg('同步完成'); setPreview(null)
    } catch (e) { setMsg('同步失败: ' + e.message) }
  }

  const nameOf = (id) => sites.find((x) => x.id === id)?.name || id

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <b>源站：</b>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">选择源站...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 10 }}>
        <b>目标站：</b>
        {sites.filter((s) => String(s.id) !== String(sourceId)).map((s) => (
          <label key={s.id} style={{ marginRight: 12 }}>
            <input type="checkbox" checked={targetIds.includes(s.id)}
              onChange={() => toggleTarget(s.id)} /> {s.name}
          </label>
        ))}
      </div>
      <button onClick={loadDiff} disabled={!sourceId || !targetIds.length}>计算差异</button>{' '}
      <button onClick={doPreview} disabled={!rows.length}>预览所选</button>{' '}
      <button onClick={doSync} disabled={!preview}>确认同步</button>
      {msg && <div style={{ padding: 8, background: '#eef', margin: '10px 0' }}>{msg}</div>}

      {rows.length > 0 && (
        <table border="1" cellPadding="4" style={{ borderCollapse: 'collapse', fontSize: 13, marginTop: 10 }}>
          <thead>
            <tr>
              <th>选</th><th>模型</th><th>维度</th><th>源值</th>
              {targetIds.map((tid) => <th key={tid}>{nameOf(tid)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.model}|${row.field}`
              return (
                <tr key={key}>
                  <td><input type="checkbox" checked={!!sel[key]}
                    onChange={(e) => setSel({ ...sel, [key]: e.target.checked })} /></td>
                  <td>{row.model}</td><td>{row.field}</td>
                  <td>{row.source ?? <i>无</i>}</td>
                  {targetIds.map((tid) => (
                    <td key={tid} style={{ color: row.targets[tid] === row.source ? '#888' : '#b00' }}>
                      {row.targets[tid] ?? <i>无</i>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <h3>预览（before → after）</h3>
          {preview.map((t) => (
            <div key={t.target_id} style={{ marginBottom: 8 }}>
              <b>{t.target_name || t.target_id}</b>{t.error && <span style={{ color: 'red' }}> {t.error}</span>}
              <ul>
                {Object.entries(t.changes || {}).map(([k, c]) => (
                  <li key={k}><code>{k}</code>: 改动已就绪（{Object.keys(t.changes).length} 个 option）</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          <h3>同步结果</h3>
          {result.map((t) => (
            <div key={t.target_id}>
              <b>{t.target_name || t.target_id}</b>：
              {t.error
                ? <span style={{ color: 'red' }}>失败 {t.error}（快照 #{t.snapshot_id || '-'}）</span>
                : <span style={{ color: 'green' }}>成功，改动 {t.changed_keys?.length || 0} 个 option（快照 #{t.snapshot_id}）</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
