import { useEffect, useState } from 'react'
import { getSites, getPricing, putPricing, validateExpr } from '../api'

// 价格列定义：显示价格（$/1M），保存时反算回 new-api 的 ratio 字段。
// 换算表见 docs/superpowers/specs/2026-07-22-price-display-design.md。
// key: 前端价格字段；label: 列名；ratio: 存回的 new-api 字段；prop: ModelPricing 上的原始属性。
const PRICE_FIELDS = [
  { key: 'InputPrice', label: '输入价/1M', ratio: 'ModelRatio', prop: 'model_ratio' },
  { key: 'OutputPrice', label: '输出价/1M', ratio: 'CompletionRatio', prop: 'completion_ratio' },
  { key: 'CacheReadPrice', label: '缓存读价', ratio: 'CacheRatio', prop: 'cache_ratio' },
  { key: 'CacheWritePrice', label: '缓存写价', ratio: 'CreateCacheRatio', prop: 'create_cache_ratio' },
  { key: 'ImagePrice', label: '图片价', ratio: 'ImageRatio', prop: 'image_ratio' },
  { key: 'AudioInPrice', label: '音频输入价', ratio: 'AudioRatio', prop: 'audio_ratio' },
  { key: 'AudioOutPrice', label: '音频输出价', ratio: 'AudioCompletionRatio', prop: 'audio_completion_ratio' },
  { key: 'ModelPrice', label: '按次价', ratio: 'ModelPrice', prop: 'model_price' },
]
const PRICE_KEYS = new Set(PRICE_FIELDS.map((f) => f.key))

// 计费模式中文名
const MODE_LABEL = { ratio: '按量', tiered_expr: '阶梯' }

// 删除模型时需清空的全部受管字段。
const ALL_RATIO_FIELDS = [
  'ModelRatio', 'CompletionRatio', 'ModelPrice', 'CacheRatio', 'CreateCacheRatio',
  'ImageRatio', 'AudioRatio', 'AudioCompletionRatio', 'BillingMode', 'BillingExpr',
]

const fmtNum = (x) => (x == null ? '' : String(Number(Number(x).toFixed(6))))
const num = (x) => {
  if (x === '' || x == null) return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

// 输入价 = ModelRatio × 2
const inputPriceOf = (m) => (m.model_ratio != null ? m.model_ratio * 2 : null)
const relOf = (ip, r) => (ip == null || r == null ? null : ip * r)

// 某模型某价格字段的显示价（null = 不可换算）。
const displayPriceOf = (m, key) => {
  const ip = inputPriceOf(m)
  switch (key) {
    case 'InputPrice': return ip
    case 'ModelPrice': return m.model_price ?? null // 本就是真实价格
    case 'OutputPrice': return relOf(ip, m.completion_ratio)
    case 'CacheReadPrice': return relOf(ip, m.cache_ratio)
    case 'CacheWritePrice': return relOf(ip, m.create_cache_ratio)
    case 'ImagePrice': return relOf(ip, m.image_ratio)
    case 'AudioInPrice': return relOf(ip, m.audio_ratio)
    case 'AudioOutPrice':
      if (ip == null || m.audio_ratio == null || m.audio_completion_ratio == null) return null
      return ip * m.audio_ratio * m.audio_completion_ratio
    default: return null
  }
}
const priceFallback = (m, key) => fmtNum(displayPriceOf(m, key))

const EMPTY_NEW = { name: '', mode: 'ratio', price: '' }

export default function Editor() {
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [models, setModels] = useState([])
  const [edits, setEdits] = useState({}) // `${model}|${key}` -> value string（价格 或 BillingExpr/BillingMode 原值）
  const [deleted, setDeleted] = useState({})
  const [added, setAdded] = useState({})
  const [exprErr, setExprErr] = useState({})
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState(EMPTY_NEW)
  const [selected, setSelected] = useState({}) // model -> true（批量勾选）
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchForm, setBatchForm] = useState({ field: 'InputPrice', value: '' })

  useEffect(() => { getSites().then(setSites) }, [])

  const load = async (id) => {
    setSiteId(id); setEdits({}); setDeleted({}); setAdded({}); setExprErr({})
    setAdding(false); setNewForm(EMPTY_NEW); setSelected({}); setBatchOpen(false); setMsg('加载中...')
    try { const r = await getPricing(id); setModels(r.models || []); setMsg('') }
    catch (e) { setMsg(e.message) }
  }

  const setEdit = (model, key, value) =>
    setEdits((p) => ({ ...p, [`${model}|${key}`]: value }))

  const editVal = (model, key, fallback) => {
    const k = `${model}|${key}`
    return k in edits ? edits[k] : (fallback ?? '')
  }

  const checkExpr = async (model, expr) => {
    if (!expr) { setExprErr((p) => ({ ...p, [model]: '' })); return }
    try {
      const r = await validateExpr(expr)
      setExprErr((p) => ({ ...p, [model]: r.valid ? '' : r.error }))
    } catch (e) { setExprErr((p) => ({ ...p, [model]: e.message })) }
  }

  const addModel = () => {
    const name = newForm.name.trim()
    if (!name) { setMsg('请填写模型名'); return }
    if (models.some((m) => m.model === name)) { setMsg('模型已存在：' + name); return }
    if (newForm.price === '' || !Number.isFinite(Number(newForm.price))) {
      setMsg('请填写有效的输入价'); return
    }
    setModels((p) => [{ model: name, billing_mode: newForm.mode }, ...p])
    setEdits((p) => {
      const next = { ...p, [`${name}|InputPrice`]: String(newForm.price) }
      if (newForm.mode === 'tiered_expr') next[`${name}|BillingMode`] = 'tiered_expr'
      return next
    })
    setAdded((p) => ({ ...p, [name]: true }))
    setAdding(false); setNewForm(EMPTY_NEW); setMsg('')
  }

  const toggleDelete = (model) => {
    if (added[model]) {
      setModels((p) => p.filter((m) => m.model !== model))
      setAdded((p) => { const n = { ...p }; delete n[model]; return n })
      setEdits((p) => {
        const n = { ...p }
        Object.keys(n).forEach((k) => { if (k.startsWith(model + '|')) delete n[k] })
        return n
      })
      return
    }
    setDeleted((p) => {
      const n = { ...p }
      if (n[model]) delete n[model]; else n[model] = true
      return n
    })
  }

  // ---- 批量：勾选 / 删除所选 / 批量改价 ----
  const toggleSelect = (model) =>
    setSelected((p) => { const n = { ...p }; if (n[model]) delete n[model]; else n[model] = true; return n })

  const toggleSelectAll = () => {
    const shownNow = models.filter((m) => m.model.includes(filter))
    const allSel = shownNow.length > 0 && shownNow.every((m) => selected[m.model])
    setSelected((p) => {
      const n = { ...p }
      shownNow.forEach((m) => { if (allSel) delete n[m.model]; else n[m.model] = true })
      return n
    })
  }

  const removeAddedModel = (model) => {
    setModels((p) => p.filter((m) => m.model !== model))
    setAdded((p) => { const n = { ...p }; delete n[model]; return n })
    setEdits((p) => { const n = { ...p }; Object.keys(n).forEach((k) => { if (k.startsWith(model + '|')) delete n[k] }); return n })
  }

  const batchDelete = () => {
    const names = Object.keys(selected)
    if (!names.length) return
    names.forEach((model) => {
      if (added[model]) removeAddedModel(model)
      else setDeleted((p) => ({ ...p, [model]: true }))
    })
    setSelected({}); setMsg(`已标记 ${names.length} 个模型待删除`)
  }

  const applyBatch = () => {
    if (batchForm.value === '' || !Number.isFinite(Number(batchForm.value))) { setMsg('请填写有效的数值'); return }
    const targets = Object.keys(selected).filter((m) => !deleted[m])
    if (!targets.length) { setMsg('未选中可编辑的模型'); return }
    setEdits((p) => {
      const n = { ...p }
      targets.forEach((m) => { n[`${m}|${batchForm.field}`] = String(batchForm.value) })
      return n
    })
    setBatchOpen(false); setBatchForm((f) => ({ ...f, value: '' }))
    const label = PRICE_FIELDS.find((f) => f.key === batchForm.field)?.label || batchForm.field
    setMsg(`已把 ${targets.length} 个模型的「${label}」设为 ${batchForm.value}`)
  }

  const save = async () => {
    const errs = Object.entries(exprErr).filter(([m, e]) => e && !deleted[m])
    if (errs.length) { setMsg('存在无效表达式，无法保存'); return }

    const payload = []

    // 1. 非价格的原值改动（BillingExpr / BillingMode）直接透传
    for (const [k, v] of Object.entries(edits)) {
      const [model, field] = k.split('|')
      if (deleted[model] || PRICE_KEYS.has(field)) continue
      payload.push({ model, field, value: String(v) })
    }

    // 2. 价格 -> ratio：对每个有价格改动的模型，按当前显示价重算全部 ratio，只写回变化字段
    const touched = new Set(
      Object.keys(edits).map((k) => k.split('|')[0]).filter((m) => !deleted[m])
    )
    for (const model of touched) {
      const hasPriceEdit = PRICE_FIELDS.some((f) => `${model}|${f.key}` in edits)
      if (!hasPriceEdit) continue
      const sm = models.find((x) => x.model === model) || { model }
      const price = (key) => num(editVal(model, key, priceFallback(sm, key)))
      const inputP = price('InputPrice')

      const emit = (ratioField, prop, computed) => {
        if (computed == null || !Number.isFinite(computed)) return
        const cur = sm[prop]
        if (cur != null && fmtNum(cur) === fmtNum(computed)) return // 未变化
        payload.push({ model, field: ratioField, value: fmtNum(computed) })
      }

      if (inputP != null) emit('ModelRatio', 'model_ratio', inputP / 2)
      const mp = price('ModelPrice')
      if (mp != null) emit('ModelPrice', 'model_price', mp)

      // 其余都是「相对输入价」的倍率
      const relEmit = (key, ratioField, prop) => {
        const p = price(key)
        if (p == null || inputP == null || inputP === 0) return
        emit(ratioField, prop, p / inputP)
      }
      relEmit('OutputPrice', 'CompletionRatio', 'completion_ratio')
      relEmit('CacheReadPrice', 'CacheRatio', 'cache_ratio')
      relEmit('CacheWritePrice', 'CreateCacheRatio', 'create_cache_ratio')
      relEmit('ImagePrice', 'ImageRatio', 'image_ratio')
      relEmit('AudioInPrice', 'AudioRatio', 'audio_ratio')
      // 音频输出价相对音频输入价：AudioCompletionRatio = 音频输出价 / 音频输入价
      const ao = price('AudioOutPrice'); const ai = price('AudioInPrice')
      if (ao != null && ai != null && ai !== 0) {
        emit('AudioCompletionRatio', 'audio_completion_ratio', ao / ai)
      }
    }

    // 3. 删除模型：清空其所有字段
    for (const model of Object.keys(deleted)) {
      for (const field of ALL_RATIO_FIELDS) payload.push({ model, field, value: '', delete: true })
    }

    if (!payload.length) { setMsg('没有改动'); return }
    setMsg('保存中...')
    try {
      const r = await putPricing(siteId, payload)
      setMsg(`已保存，改动 ${r.changed_keys?.length || 0} 个配置项（快照 #${r.snapshot_id}）`)
      load(siteId)
    } catch (e) { setMsg('保存失败: ' + e.message) }
  }

  const shown = models.filter((m) => m.model.includes(filter))
  const editCount = Object.keys(edits).length
  const delCount = Object.keys(deleted).length
  const selectedCount = Object.keys(selected).length
  const allShownSelected = shown.length > 0 && shown.every((m) => selected[m.model])
  const isErr = msg.includes('失败') || msg.includes('无效') || msg.includes('请填写') || msg.includes('已存在')

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>单站编辑</h2>
          <p>价格均为真实单价（$/1M tokens），保存后生成可回滚快照。</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setAdding((a) => !a)} disabled={!siteId}>+ 新增模型</button>
          <button className="btn btn-primary" onClick={save} disabled={!siteId}>保存改动</button>
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
        <span className="field">
          <label>过滤</label>
          <input placeholder="模型名，如 gpt-4o" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </span>
      </div>

      {msg && <div className={'msg' + (isErr ? ' msg-err' : msg.includes('已保存') ? ' msg-ok' : '')}>{msg}</div>}

      {adding && siteId && (
        <div className="addbar">
          <div className="af">
            <label>模型名</label>
            <input autoFocus placeholder="如 gpt-4o" value={newForm.name}
              onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') addModel() }} />
          </div>
          <div className="af">
            <label>模式</label>
            <select value={newForm.mode} onChange={(e) => setNewForm({ ...newForm, mode: e.target.value })}>
              <option value="ratio">按量</option>
              <option value="tiered_expr">阶梯</option>
            </select>
          </div>
          <div className="af">
            <label>输入价/1M</label>
            <input placeholder="如 2.5" value={newForm.price}
              onChange={(e) => setNewForm({ ...newForm, price: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') addModel() }} />
          </div>
          <div className="af-actions">
            <button className="btn btn-primary btn-sm" onClick={addModel}>添加</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setNewForm(EMPTY_NEW) }}>取消</button>
          </div>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="batchbar">
          <span>已选 <b>{selectedCount}</b> 项</span>
          <button className="btn btn-sm" onClick={() => setBatchOpen((o) => !o)}>批量改价</button>
          <button className="btn btn-sm btn-danger" onClick={batchDelete}>删除所选</button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setSelected({}); setBatchOpen(false) }}>取消选择</button>
        </div>
      )}

      {batchOpen && selectedCount > 0 && (
        <div className="addbar">
          <div className="af">
            <label>字段</label>
            <select value={batchForm.field} onChange={(e) => setBatchForm({ ...batchForm, field: e.target.value })}>
              {PRICE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div className="af">
            <label>设为固定值</label>
            <input autoFocus placeholder="如 2.5" value={batchForm.value}
              onChange={(e) => setBatchForm({ ...batchForm, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') applyBatch() }} />
          </div>
          <div className="af-actions">
            <button className="btn btn-primary btn-sm" onClick={applyBatch}>应用到 {selectedCount} 项</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setBatchOpen(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="note">
        所有价格均为 <b>真实单价（$/1M tokens）</b>，不再是倍率：输出价/缓存价/图片价/音频价都已按输入价换算。
        改「输入价」会保持其它价格不变、自动调整对应倍率（所见即所存）。新增/删除均在「保存改动」时提交、可回滚。
      </div>

      {siteId ? (
        <>
          <div className="card">
            <div className="card-scroll">
              <table className="ledger">
                <thead>
                  <tr>
                    <th className="chk"><input type="checkbox" checked={allShownSelected} onChange={toggleSelectAll} title="全选当前筛选" /></th>
                    <th className="gut">#</th>
                    <th>模型</th><th>模式</th>
                    {PRICE_FIELDS.map((f) => <th key={f.key} className="num">{f.label}</th>)}
                    <th>阶梯表达式</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m, i) => {
                    const isDel = !!deleted[m.model]
                    return (
                      <tr key={m.model} className={isDel ? 'row-del' : (selected[m.model] ? 'row-sel' : undefined)}>
                        <td className="chk"><input type="checkbox" checked={!!selected[m.model]} onChange={() => toggleSelect(m.model)} /></td>
                        <td className="gut">{String(i + 1).padStart(2, '0')}</td>
                        <td className="model">{m.model}</td>
                        <td>
                          <span className={'pill' + (m.billing_mode === 'tiered_expr' ? ' pill-tier' : '')}>{MODE_LABEL[m.billing_mode] || m.billing_mode}</span>
                          {added[m.model] && <span className="pill pill-new" style={{ marginLeft: 6 }}>新增</span>}
                        </td>
                        {PRICE_FIELDS.map((f) => (
                          <td key={f.key} className="num">
                            <input
                              className={'cell' + (`${m.model}|${f.key}` in edits ? ' edited' : '')}
                              disabled={isDel}
                              value={editVal(m.model, f.key, priceFallback(m, f.key))}
                              onChange={(e) => setEdit(m.model, f.key, e.target.value)} />
                          </td>
                        ))}
                        <td>
                          {m.billing_mode === 'tiered_expr' || editVal(m.model, 'BillingExpr', m.billing_expr) ? (
                            <div>
                              <textarea className="expr" rows={2} disabled={isDel}
                                value={editVal(m.model, 'BillingExpr', m.billing_expr)}
                                onChange={(e) => setEdit(m.model, 'BillingExpr', e.target.value)}
                                onBlur={(e) => checkExpr(m.model, e.target.value)} />
                              {exprErr[m.model] && !isDel && <div className="expr-err">{exprErr[m.model]}</div>}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <button
                            className={'btn btn-sm ' + (isDel ? 'btn-ghost' : 'btn-danger')}
                            onClick={() => toggleDelete(m.model)}>
                            {isDel ? '撤销' : '删除'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="foot-note">
            <span className="muted">
              {shown.length} / {models.length} 个模型
              {editCount > 0 && <> · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{editCount} 项改动待保存</span></>}
              {delCount > 0 && <> · <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{delCount} 个待删除</span></>}
            </span>
          </div>
        </>
      ) : (
        <div className="empty">请先在上方选择一个站点以加载价格配置。</div>
      )}
    </div>
  )
}
