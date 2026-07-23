import Reveal from '../components/Reveal.jsx'
import Magnetic from '../components/Magnetic.jsx'
import { CONSOLE_URL } from '../config.js'

export default function Footer() {
  return (
    <>
      <section className="cta">
        <span className="cta-glow" />
        <div className="wrap">
          <Reveal>
            <h2>
              准备好把价格
              <br />
              <span className="serif-i">拧成一处真相</span>了吗？
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p>本地部署、内网自用、开源自建。打开控制台，几分钟接入第一个站点。</p>
          </Reveal>
          <Reveal delay={0.18}>
            <Magnetic strength={0.3}>
              <a className="btn btn-primary" href={CONSOLE_URL} data-hover>
                进入控制台 <span className="arrow">→</span>
              </a>
            </Magnetic>
          </Reveal>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footer-inner">
          <a className="brand" href="#top">
            <span className="brand-mark">₽</span>
            <span>
              价格中枢
              <small>PRICE CONTROL</small>
            </span>
          </a>
          <div className="tags">
            <span className="chip">本地 · 内网</span>
            <span className="chip">Go + React</span>
            <span className="chip">SQLite 快照</span>
            <span className="chip">开源自建</span>
          </div>
          <span className="cprt">new-api 价格管理 · 单进程部署</span>
        </div>
      </footer>
    </>
  )
}
