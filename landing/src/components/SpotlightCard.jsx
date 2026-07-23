import { useRef } from 'react'

/** Card that tracks the cursor to drive a radial spotlight (via --mx/--my). */
export default function SpotlightCard({ className = '', children, ...rest }) {
  const ref = useRef(null)
  const onMove = (e) => {
    const el = ref.current
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    <div ref={ref} className={`card ${className}`} onPointerMove={onMove} {...rest}>
      {children}
    </div>
  )
}
