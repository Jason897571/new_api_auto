import SpotlightCard from '../components/SpotlightCard.jsx'
import Reveal from '../components/Reveal.jsx'
import Tilt from '../components/Tilt.jsx'
import ScrambleText from '../components/ScrambleText.jsx'

const I = {
  price: (
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.8ZM7.5 7.5h.01" />
  ),
  sync: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  tree: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-2h12v2" />
    </>
  ),
  fn: (
    <>
      <path d="M14 4h-2a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H4" />
      <path d="M6 12h9M18 8l3 4-3 4" />
    </>
  ),
  audit: (
    <>
      <path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M8 11h8M8 15h5" />
    </>
  ),
}

const FEATURES = [
  { ic: 'price', t: '真实价格编辑', d: '看到的是 $/1M tokens，不是晦涩的倍率。改价即所见即所存，保存时自动换算回 new-api 的 ratio，只写变化字段。' },
  { ic: 'sync', t: '一源多目标同步', d: '以主站为基准，一次对齐任意多个子站。逐模型、逐维度可勾选，差异一目了然。' },
  { ic: 'shield', t: '预览 · 快照 · 回滚', d: '写入前弹窗展示 before → after，确认才执行；每次改动落一份快照，一键还原，回滚本身也可再回滚。' },
  { ic: 'tree', t: '主站 / 子站拓扑', d: '站点分角色，子站一键「从主站同步」，直达同步页并预置源与目标。' },
  { ic: 'fn', t: '阶梯计费校验', d: '表达式本地 smoke test —— 编译并用样本 token 向量跑一遍，非负校验，拒绝坏表达式上线。' },
  { ic: 'audit', t: '全链路可追溯', d: '每一次保存、同步、回滚都留痕。所有写操作只走官方 API，绝不直连数据库。' },
]

export default function Features() {
  return (
    <section className="sec" id="features">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="kicker">能力 · <ScrambleText text="CAPABILITIES" /></span>
          <h2>
            管一处价格该有的<br />
            <span className="serif-i">每一件</span>兵器。
          </h2>
          <p>从单站精修到跨站对齐，每一步都带预览、快照与回滚 —— 稳，是唯一的默认值。</p>
        </Reveal>

        <div className="feat-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={i} delay={(i % 3) * 0.08} className="card-slot" as="div">
              <Tilt max={8}>
                <SpotlightCard data-hover>
                  <div className="ic">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      {I[f.ic]}
                    </svg>
                  </div>
                  <span className="idx">0{i + 1}</span>
                  <h3>{f.t}</h3>
                  <p>{f.d}</p>
                </SpotlightCard>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
