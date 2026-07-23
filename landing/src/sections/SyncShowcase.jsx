import Reveal from '../components/Reveal.jsx'
import Tilt from '../components/Tilt.jsx'
import ScrambleText from '../components/ScrambleText.jsx'

const DIFF = [
  { m: 'gpt-4o', before: '$9.80', after: '$10.00' },
  { m: 'claude-3.5-sonnet', before: '$14.50', after: '$15.00' },
  { m: 'gpt-4o-mini', before: '$0.58', after: '$0.60' },
  { m: 'o1', before: '$58.00', after: '$60.00' },
  { m: 'deepseek-v3', before: '—', after: '$1.10' },
]

export default function SyncShowcase() {
  return (
    <section className="sec" id="sync">
      <div className="wrap showcase">
        <Reveal>
          <div>
            <span className="kicker">同步 · <ScrambleText text="IN SYNC" /></span>
            <h2 style={{
              fontFamily: 'var(--f-display)', fontWeight: 500,
              fontSize: 'clamp(2rem,4vw,3rem)', letterSpacing: '-0.025em',
              lineHeight: 1.08, marginTop: 18,
            }}>
              像看行情板一样，
              <br />
              <span className="serif-i" style={{ color: 'var(--mint)' }}>看清</span>两站的价差。
            </h2>
            <p style={{ color: 'var(--ink-2)', marginTop: 20, maxWidth: 400 }}>
              一张表并排列出源站与每个目标站的价格，差异、缺失、一致三态配色。
              勾选要推的行，预览 before → after，确认才落地。
            </p>
            <div className="footer tags" style={{ border: 'none', padding: 0, marginTop: 26, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span className="chip">逐项可选</span>
              <span className="chip">整表快照</span>
              <span className="chip">目标间互不影响</span>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <Tilt max={6}>
          <div className="term" data-hover>
            <div className="term-bar">
              <span className="dot g" />
              <span className="dot" />
              <span className="dot" />
              <span className="path">POST /api/sync · 新加坡daily → tokyo-prod</span>
            </div>
            <div className="term-body">
              <div className="trow head">
                <span>模型</span>
                <span>当前</span>
                <span />
                <span style={{ textAlign: 'right' }}>同步后</span>
              </div>
              {DIFF.map((r, i) => (
                <div className="trow" key={i}>
                  <span className="m">{r.m}</span>
                  <span className="before">{r.before}</span>
                  <span className="arrow-i">→</span>
                  <span className="after">{r.after}</span>
                </div>
              ))}
            </div>
          </div>
          </Tilt>
        </Reveal>
      </div>
    </section>
  )
}
