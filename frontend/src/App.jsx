import { useState } from 'react'
import Sites from './pages/Sites'
import Editor from './pages/Editor'
import Sync from './pages/Sync'

export default function App() {
  const [tab, setTab] = useState('sites')
  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 1100, margin: '0 auto', padding: 20 }}>
      <h1>new-api 价格管理</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('sites')} disabled={tab === 'sites'}>站点</button>
        <button onClick={() => setTab('editor')} disabled={tab === 'editor'}>单站编辑</button>
        <button onClick={() => setTab('sync')} disabled={tab === 'sync'}>同步</button>
      </div>
      {tab === 'sites' && <Sites />}
      {tab === 'editor' && <Editor />}
      {tab === 'sync' && <Sync />}
    </div>
  )
}
