import { useEffect } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

/**
 * Custom cursor. Centering is done in CSS via negative margins, so the inline
 * transform below only positions/scales — no more (-50%,-50%) fight.
 * Dot tracks raw pointer (zero lag); ring follows on a TIGHT spring.
 */
export default function Cursor() {
  const x = useMotionValue(-100)
  const y = useMotionValue(-100)
  const ringX = useSpring(x, { stiffness: 900, damping: 45, mass: 0.25 })
  const ringY = useSpring(y, { stiffness: 900, damping: 45, mass: 0.25 })
  const scale = useSpring(1, { stiffness: 500, damping: 26 })

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return
    const move = (e) => {
      x.set(e.clientX)
      y.set(e.clientY)
    }
    const over = (e) => {
      const hit = e.target.closest('a, button, [data-hover]')
      scale.set(hit ? 1.8 : 1)
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', over)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', over)
    }
  }, [x, y, scale])

  return (
    <>
      <motion.div className="cursor-ring" style={{ x: ringX, y: ringY, scale }} aria-hidden />
      <motion.div className="cursor-dot" style={{ x, y }} aria-hidden />
    </>
  )
}
