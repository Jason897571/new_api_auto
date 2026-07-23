import { useEffect, useState } from 'react'
import { getSites, getDiff, syncPreview, runSync } from '../api'
import Modal from '../components/Modal'
import ChangeList from '../components/ChangeList'

export default function Sync({ preset, onPresetConsumed }) {
  const [sites, setSites] = useState([])
  const [sourceId, setSourceId] = useState('')
  const [targetIds, setTargetIds] = useState([])
  const [rows, setRows] = useState([]) // {model, field, label, source, targets: {tid: value|null}}
  const [sel, setSel] = useState({})   // `${model}|${field}` -> true
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewGroups, setPreviewGroups] = useState([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => { getSites().then(setSites) }, [])

  // 由站点页「从主站同步」跳转而来：预置 源站/目标站，等用户点“计算差异”。
  useEffect(() => {
    if (preset && preset.source) {
      setSourceId(String(preset.source))
      setTargetIds(preset.targets || [])
      setMsg('已预置：源站=主站、目标站=该子站，点“计算差异”继续')
      if (onPresetConsumed) onPresetConsumed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleTarget = (id) =>
    setTargetIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const loadDiff = async () => {
    setMsg('计算差异中...'); setRows([]); setSel({}); setPreviewOpen(false); setResult(null)
    try {
      // 对每个目标站拉 diff，按 model|field 合并。
      // 值优先用后端算好的显示价格（source_price/target_price）；
      // 计费模式翻译成中文；阶梯表达式无价格则回退原值。
      const MODE_LABEL = { ratio: '按量', tiered_expr: '阶梯' }
      const showVal = (f, price, raw) => {
        if (f.field === 'BillingMode') return raw == null ? null : (MODE_LABEL[raw] || raw)
        return price != null ? price : raw
      }
      const merged = {} // key -> {model, field, label, source, targets:{}}
      for (const tid of targetIds) {
        const d = await getDiff(Number(sourceId), tid)
        for (const m of d.models || []) {
          for (const f of m.fields) {
            const key = `${m.model}|${f.field}`
            if (!merged[key]) {
              merged[key] = {
                model: m.model, field: f.field, label: f.label || f.field,
                source: showVal(f, f.source_price, f.source), targets: {},
              }
            }
            merged[key].targets[tid] = showVal(f, f.target_price, f.target)
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

  // 打开预览弹窗：调后端预览做校验（捕获目标站错误），改动内容用已算好的差异数据构建。
  const openPreview = async () => {
    const s = selections()
    if (!s.length) { setMsg('未勾选任何项'); return }
    setMsg('生成预览...')
    let errByTid = {}
    try {
      const p = await syncPreview(Number(sourceId), targetIds, s)
      ;(p.targets || []).forEach((t) => { if (t.error) errByTid[t.target_id] = t.error })
    } catch (e) { setMsg('预览失败: ' + e.message); return }
    setMsg('')
    const groups = targetIds.map((tid) => {
      const changes = []
      for (const { model, field } of s) {
        const row = rows.find((r) => r.model === model && r.field === field)
        if (!row) continue
        const before = row.targets[tid]
        if (before === undefined) continue // 该目标站此项已与源站一致，无改动
        changes.push({ model, label: row.label, before: before ?? '无', after: row.source ?? '无' })
      }
      return { name: nameOf(tid), error: errByTid[tid], changes }
    })
    setPreviewGroups(groups); setPreviewOpen(true)
  }

  const confirmSync = async () => {
    const s = selections()
    if (!s.length) return
    setPreviewBusy(true)
    try {
      const r = await runSync(Number(sourceId), targetIds, s)
      setResult(r.targets); setMsg('同步完成'); setPreviewOpen(false)
    } catch (e) { setMsg('同步失败: ' + e.message) }
    setPreviewBusy(false)
  }

  const nameOf = (id) => sites.find((x) => x.id === id)?.name || id

  const isErr = msg.includes('失败')
  const isOk = msg === '同步完成'
  const allSelected = rows.length > 0 && rows.every((r) => sel[`${r.model}|${r.field}`])
  const toggleSelectAll = () => {
    setSel(allSelected ? {} : Object.fromEntries(rows.map((r) => [`${r.model}|${r.field}`, true])))
    setResult(null)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>同步</h2>
          <p>以一个源站为基准，把选中的价格项对齐到一个或多个目标站，同步前可预览。</p>
        </div>
      </div>

      <div className="toolbar">
        <span className="field">
          <label>源站</label>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">选择源站...</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </span>
      </div>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>目标站</span>
        {sites.filter((s) => String(s.id) !== String(sourceId)).map((s) => (
          <label key={s.id} className="checkline">
            <input type="checkbox" checked={targetIds.includes(s.id)} onChange={() => toggleTarget(s.id)} />
            {s.name}
          </label>
        ))}
      </div>

      <div className="toolbar">
        <button className="btn" onClick={loadDiff} disabled={!sourceId || !targetIds.length}>计算差异</button>
        <button className="btn btn-primary" onClick={openPreview} disabled={!rows.length}>预览所选</button>
      </div>

      {msg && <div className={'msg' + (isErr ? ' msg-err' : isOk ? ' msg-ok' : '')}>{msg}</div>}

      {rows.length > 0 && (
        <div className="card">
          <div className="card-scroll">
            <table className="ledger ledger-fit">
              <thead>
                <tr>
                  <th style={{ width: 34 }}><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ accentColor: 'var(--accent)' }} title="全选" /></th><th>模型</th><th>维度</th><th className="num">源值</th>
                  {targetIds.map((tid) => <th key={tid} className="num">{nameOf(tid)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = `${row.model}|${row.field}`
                  return (
                    <tr key={key}>
                      <td>
                        <input type="checkbox" checked={!!sel[key]} style={{ accentColor: 'var(--accent)' }}
                          onChange={(e) => { setSel({ ...sel, [key]: e.target.checked }); setResult(null) }} />
                      </td>
                      <td className="model" title={row.model}>{row.model}</td>
                      <td><span className="pill">{row.label}</span></td>
                      <td className="num diff-src" title={row.source ?? ''}>{row.source ?? <i className="diff-none">无</i>}</td>
                      {targetIds.map((tid) => {
                        const v = row.targets[tid]
                        if (v === undefined) {
                          return <td key={tid} className="num diff-same" title={row.source ?? ''}>{row.source ?? '='}</td>
                        }
                        if (v === null) {
                          return <td key={tid} className="num diff-none"><i>无</i></td>
                        }
                        return <td key={tid} className="num diff-diff" title={v}>{v}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {previewOpen && (
        <Modal
          title="确认同步"
          subtitle={`以「${nameOf(Number(sourceId))}」为基准，同步到 ${targetIds.length} 个目标站`}
          confirmText="确认同步"
          busy={previewBusy}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={confirmSync}>
          <ChangeList groups={previewGroups} />
        </Modal>
      )}

      {result && (
        <div className="section">
          <h3>同步结果</h3>
          <div className="card" style={{ padding: '4px 16px' }}>
            {result.map((t) => (
              <div key={t.target_id} className="result-line">
                <b>{t.target_name || t.target_id}</b>：
                {t.error
                  ? <span className="err-text">失败 {t.error}（快照 #{t.snapshot_id || '-'}）</span>
                  : <span className="ok-text">成功，改动 {t.changed_keys?.length || 0} 个 option（快照 #{t.snapshot_id}）</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
