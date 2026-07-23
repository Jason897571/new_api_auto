import Reveal from '../components/Reveal.jsx'
import ScrambleText from '../components/ScrambleText.jsx'

const STEPS = [
  { t: '预览差异', d: '源站 vs 目标站，逐项高亮' },
  { t: '表达式校验', d: '本地 smoke test，非负' },
  { t: '自动快照', d: '写前冻结旧值' },
  { t: '顺序写入', d: '失败即停，报告进度' },
  { t: '可回滚', d: '一键还原到快照' },
]

export default function Flow() {
  return (
    <section className="sec" id="flow">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="kicker">安全流程 · <ScrambleText text="SAFETY FLOW" /></span>
          <h2>
            每一次写入，都走
            <span className="serif-i"> 同一条 </span>
            安全通道。
          </h2>
          <p>预览、校验、快照、写入、回滚 —— 五道关卡串成一条不可跳过的链路。</p>
        </Reveal>

        <Reveal>
          <div className="flow">
            <div className="flow-track">
              {STEPS.map((s, i) => (
                <div className="step on" key={i}>
                  <div className="node">{String(i + 1).padStart(2, '0')}</div>
                  <h4>{s.t}</h4>
                  <p>{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
