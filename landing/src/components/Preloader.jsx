import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

/** Awwwards-style intro: a 0→100 counter, then a curtain wipe up. */
export default function Preloader({ onDone }) {
  const [n, setN] = useState(0)

  useEffect(() => {
    let cur = 0
    const id = setInterval(() => {
      cur += Math.max(1, Math.round((100 - cur) * 0.09)) + Math.floor(Math.random() * 2)
      if (cur >= 100) {
        setN(100)
        clearInterval(id)
        setTimeout(onDone, 520)
      } else {
        setN(cur)
      }
    }, 85)
    return () => clearInterval(id)
  }, [onDone])

  return (
    <motion.div
      className="preloader"
      initial={{ y: 0 }}
      exit={{ y: '-100%' }}
      transition={{ duration: 0.95, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div
        className="pre-inner"
        animate={{ opacity: n >= 100 ? 0 : 1, y: n >= 100 ? -18 : 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="pre-count">
          {String(n).padStart(2, '0')}
          <span className="pct">%</span>
        </div>
        <div className="pre-label">价格中枢 · PRICE CONTROL</div>
        <div className="pre-bar">
          <i style={{ transform: `scaleX(${n / 100})`, transition: 'transform 0.2s ease-out' }} />
        </div>
      </motion.div>
    </motion.div>
  )
}
