import { useEffect, useState } from 'react'
import { getSites, getPricing, putPricing, validateExpr } from '../api'

// 前端字段 -> 后端 Field 名 与 ModelPricing 属性名
const RATIO_FIELDS = [
  ['ModelRatio', 'model_ratio'],
  ['CompletionRatio', 'completion_ratio'],
  ['ModelPrice', 'model_price'],
  ['CacheRatio', 'cache_ratio'],
  ['CreateCacheRatio', 'create_cache_ratio'],
  ['ImageRatio', 'image_ratio'],
  ['AudioRatio', 'audio_ratio'],
  ['AudioCompletionRatio', 'audio_completion_ratio'],
]

export default function Editor() {
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [models, setModels] = useState([])
  const [edits, setEdits] = useState({}) // key `${model}|${field}` -> value string
  const [exprErr, setExprErr] = useState({}) // model -> error string
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => { getSites().then(setSites) }, [])

  const load = async (id) => {
    setSiteId(id); setEdits({}); setExprErr({}); setMsg('加载中...')
    try { const r = await getPricing(id); setModels(r.models || []); setMsg('') }
    catch (e) { setMsg(e.message) }
  }

  const setEdit = (model, field, value) =>
    setEdits((p) => ({ ...p, [`${model}|${field}`]: value }))

  const editVal = (model, field, fallback) => {
    const k = `${model}|${field}`
    return k in edits ? edits[k] : (fallback ?? '')
  }

  const checkExpr = async (model, expr) => {
    if (!expr) { setExprErr((p) => ({ ...p, [model]: '' })); return }
    try {
      const r = await validateExpr(expr)
      setExprErr((p) => ({ ...p, [model]: r.valid ? '' : r.error }))
    } catch (e) { setExprErr((p) => ({ ...p, [model]: e.message })) }
  }

  const save = async () => {
    // 若有表达式错误，阻止保存
    const errs = Object.values(exprErr).filter(Boolean)
    if (errs.length) { setMsg('存在无效表达式，无法保存'); return }
    const payload = Object.entries(edits)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const [model, field] = k.split('|')
        return { model, field, value: String(v) }
      })
    if (!payload.length) { setMsg('没有改动'); return }
    setMsg('保存中...')
    try {
      const r = await putPricing(siteId, payload)
      setMsg(`已保存，改动 ${r.changed_keys?.length || 0} 个配置项（快照 #${r.snapshot_id}）`)
      load(siteId)
    } catch (e) { setMsg('保存失败: ' + e.message) }
  }

  const shown = models.filter((m) => m.model.includes(filter))

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <select value={siteId} onChange={(e) => load(Number(e.target.value))}>
          <option value="">选择站点...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>{' '}
        <input placeholder="过滤模型名" value={filter} onChange={(e) => setFilter(e.target.value)} />{' '}
        <button onClick={save} disabled={!siteId}>保存改动</button>
      </div>
      {msg && <div style={{ padding: 8, background: '#eef', marginBottom: 12 }}>{msg}</div>}

      <table border="1" cellPadding="4" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th>模型</th><th>模式</th>
            {RATIO_FIELDS.map(([f]) => <th key={f}>{f}</th>)}
            <th>阶梯表达式</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.model}>
              <td>{m.model}</td>
              <td>{m.billing_mode}</td>
              {RATIO_FIELDS.map(([field, prop]) => (
                <td key={field}>
                  <input style={{ width: 70 }}
                    value={editVal(m.model, field, m[prop] != null ? String(m[prop]) : '')}
                    onChange={(e) => setEdit(m.model, field, e.target.value)} />
                </td>
              ))}
              <td>
                {m.billing_mode === 'tiered_expr' || editVal(m.model, 'BillingExpr', m.billing_expr) ? (
                  <div>
                    <textarea rows={2} style={{ width: 320 }}
                      value={editVal(m.model, 'BillingExpr', m.billing_expr)}
                      onChange={(e) => setEdit(m.model, 'BillingExpr', e.target.value)}
                      onBlur={(e) => checkExpr(m.model, e.target.value)} />
                    {exprErr[m.model] && <div style={{ color: 'red' }}>{exprErr[m.model]}</div>}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
