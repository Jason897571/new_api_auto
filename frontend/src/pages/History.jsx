import { useEffect, useState } from 'react'
import { getSites, getSnapshots, previewRollback, rollbackSnapshot } from '../api'
import Modal from '../components/Modal'
import ChangeList from '../components/ChangeList'

const MODE_LABEL = { ratio: '按量', tiered_expr: '阶梯' }

export default function History() {
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [snaps, setSnaps] = useState([])
  const [msg, setMsg] = useState('')
  const [pvOpen, setPvOpen] = useState(false)
  const [pvGroups, setPvGroups] = useState([])
  const [pvBusy, setPvBusy] = useState(false)
  const [pvSnap, setPvSnap] = useState(null)

  useEffect(() => { getSites().then(setSites) }, [])

  const load = async (id) => {
    setSiteId(id); setMsg('加载中...')
    try { const r = await getSnapshots(id); setSnaps(r.snapshots || []); setMsg('') }
    catch (e) { setMsg(e.message) }
  }

  // 打开回滚预览弹窗：显示 当前值 → 回滚后值。
  const openRollback = async (snapId) => {
    setMsg('计算回滚改动...')
    let p
    try { p = await previewRollback(snapId) } catch (e) { setMsg('预览失败: ' + e.message); return }
    setMsg('')
    const showVal = (field, price, raw) => {
      if (field === 'BillingMode') return raw == null ? '无' : (MODE_LABEL[raw] || raw)
      const v = price != null ? price : raw
      return v == null ? '无' : v
    }
    const changes = []
    for (const m of p.models || []) {
      for (const f of m.fields) {
        changes.push({
          model: m.model, label: f.label || f.field,
          before: showVal(f.field, f.source_price, f.source),
          after: showVal(f.field, f.target_price, f.target),
        })
      }
    }
    setPvGroups([{ name: p.site_name || '目标站', changes }])
    setPvSnap(snapId); setPvOpen(true)
  }

  const confirmRollback = async () => {
    setPvBusy(true)
    try {
      const r = await rollbackSnapshot(pvSnap)
      setMsg(`回滚成功，还原 ${r.changed_keys?.length || 0} 个 option`)
      setPvOpen(false); load(siteId)
    } catch (e) { setMsg('回滚失败: ' + e.message) }
    setPvBusy(false)
  }

  const fmtTime = (t) => new Date(t * 1000).toLocaleString()

  const isErr = msg.includes('失败')
  const isOk = msg.includes('成功')

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>历史</h2>
          <p>每次保存或同步都会留存快照，可随时回滚到任一时点的价格。</p>
        </div>
      </div>

      <div className="toolbar">
        <span className="field">
          <label>站点</label>
          <select value={siteId} onChange={(e) => load(Number(e.target.value))}>
            <option value="">选择站点...</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </span>
      </div>

      {msg && <div className={'msg' + (isErr ? ' msg-err' : isOk ? ' msg-ok' : '')}>{msg}</div>}

      {siteId ? (
        <div className="card">
          <div className="card-scroll">
            <table className="ledger">
              <thead>
                <tr><th>快照</th><th>时间</th><th>原因</th><th>涉及 option</th><th>操作</th></tr>
              </thead>
              <tbody>
                {snaps.length === 0 && (
                  <tr><td colSpan={5} className="empty">该站点还没有快照。</td></tr>
                )}
                {snaps.map((s) => (
                  <tr key={s.id}>
                    <td className="model" style={{ fontFamily: 'var(--mono)' }}>#{s.id}</td>
                    <td className="muted">{fmtTime(s.created_at)}</td>
                    <td>{s.reason}</td>
                    <td className="muted">{Object.keys(s.payload || {}).join(', ')}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => openRollback(s.id)}>回滚</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty">请先选择一个站点以查看快照历史。</div>
      )}

      {pvOpen && (
        <Modal
          title={`确认回滚到快照 #${pvSnap}`}
          subtitle="会把下列价格还原为快照时的旧值，并生成一个新的可回滚快照"
          confirmText="确认回滚"
          confirmDanger
          busy={pvBusy}
          onCancel={() => setPvOpen(false)}
          onConfirm={confirmRollback}>
          <ChangeList groups={pvGroups} />
        </Modal>
      )}
    </div>
  )
}
