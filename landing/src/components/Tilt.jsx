import { useRef } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

/** 3D tilt toward the cursor with a slight lift. Springs keep it liquid. */
export default function Tilt({ children, max = 9, lift = -6, className = '' }) {
  const ref = useRef(null)
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const rz = useMotionValue(0) // used as translateZ via style below
  const srx = useSpring(rx, { stiffness: 220, damping: 18 })
  const sry = useSpring(ry, { stiffness: 220, damping: 18 })
  const lz = useSpring(rz, { stiffness: 220, damping: 20 })

  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    ry.set(px * max)
    rx.set(-py * max)
    rz.set(lift)
  }
  const reset = () => {
    rx.set(0)
    ry.set(0)
    rz.set(0)
  }

  return (
    <div className={`tilt ${className}`} ref={ref} onPointerMove={onMove} onPointerLeave={reset}>
      <motion.div
        className="tilt-inner"
        style={{ rotateX: srx, rotateY: sry, translateZ: lz }}
      >
        {children}
      </motion.div>
    </div>
  )
}
