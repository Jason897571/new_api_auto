import { useEffect, useState } from 'react'
import { getSites, createSite, updateSite, deleteSite, testSite } from '../api'

const empty = { name: '', base_url: '', token: '', user_id: '' }

export default function Sites() {
  const [sites, setSites] = useState([])
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [msg, setMsg] = useState('')

  const load = () => getSites().then(setSites).catch((e) => setMsg(e.message))
  useEffect(() => { load() }, [])

  const submit = async () => {
    try {
      if (editId) await updateSite(editId, form)
      else await createSite(form)
      setForm(empty); setEditId(null); setMsg('已保存'); load()
    } catch (e) { setMsg(e.message) }
  }

  const test = async (id) => {
    setMsg('测试中...')
    try { const r = await testSite(id); setMsg(`连接成功，读到 ${r.count} 个价格配置项`) }
    catch (e) { setMsg('连接失败: ' + e.message) }
  }

  return (
    <div>
      {msg && <div style={{ padding: 8, background: '#eef', marginBottom: 12 }}>{msg}</div>}
      <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th>名称</th><th>URL</th><th>用户ID</th><th>操作</th></tr></thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td><td>{s.base_url}</td><td>{s.user_id}</td>
              <td>
                <button onClick={() => test(s.id)}>测试连接</button>{' '}
                <button onClick={() => { setForm(s); setEditId(s.id) }}>编辑</button>{' '}
                <button onClick={() => deleteSite(s.id).then(load)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{editId ? '编辑站点' : '新增站点'}</h3>
      {['name', 'base_url', 'token', 'user_id'].map((k) => (
        <div key={k} style={{ marginBottom: 6 }}>
          <label style={{ display: 'inline-block', width: 90 }}>{k}</label>
          <input value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            style={{ width: 400 }} />
        </div>
      ))}
      <button onClick={submit}>保存</button>{' '}
      {editId && <button onClick={() => { setForm(empty); setEditId(null) }}>取消</button>}
    </div>
  )
}
