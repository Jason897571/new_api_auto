import { motion } from 'framer-motion'
import Magnetic from '../components/Magnetic.jsx'
import ScrambleText from '../components/ScrambleText.jsx'
import HeroField from '../components/HeroField.jsx'
import { CONSOLE_URL } from '../config.js'

const EASE = [0.22, 1, 0.36, 1]
const lineC = (delay) => ({
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: delay } },
})
const charV = {
  hidden: { y: '115%' },
  show: { y: 0, transition: { duration: 0.95, ease: EASE } },
}
const fade = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.85, ease: EASE, delay: 1.05 } },
}

function Chars({ text, className = '' }) {
  return text.split('').map((c, i) => (
    <motion.span key={i} variants={charV} className={className} style={{ display: 'inline-block' }}>
      {c === ' ' ? ' ' : c}
    </motion.span>
  ))
}

export default function Hero({ ready }) {
  const anim = ready ? 'show' : 'hidden'
  return (
    <header className="hero" id="top">
      <div className="hero-grid-lines" />
      <HeroField />
      <div className="wrap">
        <motion.span
          className="kicker"
          initial={{ opacity: 0 }}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={{ delay: 0.45, duration: 0.6 }}
        >
          NEW-API · <ScrambleText text="MULTI-SITE PRICING CONTROL" />
        </motion.span>

        <h1>
          <motion.span className="line" variants={lineC(0.5)} initial="hidden" animate={anim}>
            <Chars text="多站价格，" />
          </motion.span>
          <motion.span className="line" variants={lineC(0.82)} initial="hidden" animate={anim}>
            <Chars text="一处" className="serif-i em" />
            <Chars text="掌控" className="em" />
            <Chars text="。" />
          </motion.span>
        </h1>

        <motion.p className="hero-sub" variants={fade} initial="hidden" animate={anim}>
          以<strong style={{ color: 'var(--ink)' }}>真实单价</strong>（$/1M
          tokens）统一编辑多个 new-api 站点的模型定价 —— 一源多目标同步、写入前预览、
          自动快照、一键回滚。每一次改动都<span className="serif-i">可追溯、可撤销</span>。
        </motion.p>

        <motion.div className="hero-cta" variants={fade} initial="hidden" animate={anim}>
          <Magnetic strength={0.35}>
            <a className="btn btn-primary" href={CONSOLE_URL} data-hover>
              进入控制台 <span className="arrow">→</span>
            </a>
          </Magnetic>
          <Magnetic strength={0.5}>
            <a className="btn btn-ghost" href="#features" data-hover>
              浏览能力 ↓
            </a>
          </Magnetic>
        </motion.div>
      </div>

      <div className="scroll-cue">
        <span className="bar" />
        SCROLL
      </div>
    </header>
  )
}
