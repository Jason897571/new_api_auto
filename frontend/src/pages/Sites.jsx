import { useEffect, useState } from 'react'
import { getSites, createSite, updateSite, deleteSite, testSite } from '../api'

const empty = { name: '', base_url: '', token: '', user_id: '', role: 'main', parent_id: '' }

export default function Sites({ onSyncFromParent }) {
  const [sites, setSites] = useState([])
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [msg, setMsg] = useState('')

  const load = () => getSites().then(setSites).catch((e) => setMsg(e.message))
  useEffect(() => { load() }, [])

  const nameOf = (id) => sites.find((x) => x.id === id)?.name || `#${id}`
  // 可作为主站的候选：role 为主站，且不是正在编辑的自己
  const mainSites = sites.filter((s) => s.role !== 'sub' && s.id !== editId)

  const startEdit = (s) => {
    setForm({
      name: s.name || '', base_url: s.base_url || '', token: s.token || '', user_id: s.user_id || '',
      role: s.role || 'main', parent_id: s.parent_id != null ? String(s.parent_id) : '',
    })
    setEditId(s.id)
  }

  const submit = async () => {
    if (form.role === 'sub' && !form.parent_id) { setMsg('请为子站选择所属主站'); return }
    const payload = {
      name: form.name, base_url: form.base_url, token: form.token, user_id: form.user_id,
      role: form.role,
      parent_id: form.role === 'sub' && form.parent_id ? Number(form.parent_id) : null,
    }
    try {
      if (editId) await updateSite(editId, payload)
      else await createSite(payload)
      setForm(empty); setEditId(null); setMsg('已保存'); load()
    } catch (e) { setMsg(e.message) }
  }

  const test = async (id) => {
    setMsg('测试中...')
    try { const r = await testSite(id); setMsg(`连接成功，读到 ${r.count} 个价格配置项`) }
    catch (e) { setMsg('连接失败: ' + e.message) }
  }

  const isErr = msg.includes('失败') || msg.includes('请为')
  const isOk = msg.includes('成功') || msg === '已保存'

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>站点</h2>
          <p>管理接入的 new-api 站点。子站可指定所属主站，之后从主站手动同步价格。</p>
        </div>
      </div>

      {msg && <div className={'msg' + (isErr ? ' msg-err' : isOk ? ' msg-ok' : '')}>{msg}</div>}

      <div className="card">
        <div className="card-scroll">
          <table className="ledger">
            <thead>
              <tr><th>名称</th><th>类型</th><th>URL</th><th className="num">用户 ID</th><th>操作</th></tr>
            </thead>
            <tbody>
              {sites.length === 0 && (
                <tr><td colSpan={5} className="empty">还没有站点，在下方新增第一个。</td></tr>
              )}
              {sites.map((s) => (
                <tr key={s.id}>
                  <td className="model">{s.name}</td>
                  <td>
                    {s.role === 'sub'
                      ? <span className="pill pill-tier">子站 · 主站：{nameOf(s.parent_id)}</span>
                      : <span className="pill">主站</span>}
                  </td>
                  <td className="muted">{s.base_url}</td>
                  <td className="num">{s.user_id}</td>
                  <td>
                    {s.role === 'sub' && (
                      <>
                        <button className="btn btn-ghost btn-sm" disabled={s.parent_id == null}
                          onClick={() => onSyncFromParent(s.parent_id, s.id)}>从主站同步</button>{' '}
                      </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => test(s.id)}>测试连接</button>{' '}
                    <button className="btn btn-ghost btn-sm" onClick={() => startEdit(s)}>编辑</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => deleteSite(s.id).then(load)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h3>{editId ? '编辑站点' : '新增站点'}</h3>
        <div className="form">
          {['name', 'base_url', 'token', 'user_id'].map((k) => (
            <div key={k} className="form-row">
              <label>{k}</label>
              <input className="input" value={form[k] || ''}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div className="form-row">
            <label>类型</label>
            <select className="select" value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="main">主站</option>
              <option value="sub">子站</option>
            </select>
          </div>
          {form.role === 'sub' && (
            <div className="form-row">
              <label>所属主站</label>
              <select className="select" value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">选择主站...</option>
                {mainSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={submit}>保存</button>
            {editId && <button className="btn btn-ghost" onClick={() => { setForm(empty); setEditId(null) }}>取消</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
