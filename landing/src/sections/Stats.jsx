import CountUp from '../components/CountUp.jsx'
import Reveal from '../components/Reveal.jsx'

// Grounded in what the tool actually is — not vanity metrics.
const STATS = [
  { v: 8, lbl: '价格维度 · DIMENSIONS' },
  { v: 10, lbl: '托管配置项 · MANAGED KEYS' },
  { v: 5, lbl: '安全流程步 · SAFETY STEPS' },
  { v: 100, suf: '%', lbl: '改动可回滚 · REVERSIBLE' },
]

export default function Stats() {
  return (
    <section className="sec" style={{ paddingBottom: 0 }}>
      <div className="wrap">
        <Reveal>
          <div className="stats">
            {STATS.map((s, i) => (
              <div className="stat" key={i}>
                <div className="num">
                  <CountUp value={s.v} />
                  {s.suf && <span className="suf">{s.suf}</span>}
                </div>
                <div className="lbl">{s.lbl}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
