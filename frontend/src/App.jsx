import { useState } from 'react'
import Sites from './pages/Sites'
import Editor from './pages/Editor'
import Sync from './pages/Sync'
import History from './pages/History'

const NAV = [
  ['sites', '站点'],
  ['editor', '单站编辑'],
  ['sync', '同步'],
  ['history', '历史'],
]

export default function App() {
  const [tab, setTab] = useState('sites')
  const [syncPreset, setSyncPreset] = useState(null)

  // 子站「从主站同步」：预置 源=主站、目标=子站，跳到同步页。
  const goSyncFromParent = (parentId, subId) => {
    setSyncPreset({ source: parentId, targets: [subId] })
    setTab('sync')
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="brand__mark">₽</div>
          <div>
            <div className="brand__name">价格管理</div>
            <div className="brand__sub">new-api</div>
          </div>
        </div>
        {NAV.map(([key, label]) => (
          <button
            key={key}
            className={'nav-i' + (tab === key ? ' on' : '')}
            onClick={() => setTab(key)}
          >
            <span className="dot" />
            {label}
          </button>
        ))}
        <div className="side__foot">跨站模型价格<br />统一管理与同步</div>
      </aside>

      <main className="main">
        {tab === 'sites' && <Sites onSyncFromParent={goSyncFromParent} />}
        {tab === 'editor' && <Editor />}
        {tab === 'sync' && <Sync preset={syncPreset} onPresetConsumed={() => setSyncPreset(null)} />}
        {tab === 'history' && <History />}
      </main>
    </div>
  )
}
