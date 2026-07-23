import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#$%&*'
const isLatin = (c) => /[A-Za-z0-9]/.test(c)

/** Decodes latin/digit chars left→right with a scramble; CJK/punctuation held. */
export default function ScrambleText({ text, speed = 34, className = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const [out, setOut] = useState(text)

  useEffect(() => {
    if (!inView) return
    let frame = 0
    let raf
    const total = text.length
    const step = () => {
      const progress = frame / 2
      const next = text
        .split('')
        .map((c, i) => {
          if (i < progress || !isLatin(c)) return c
          return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        })
        .join('')
      setOut(next)
      frame++
      if (progress < total) raf = setTimeout(() => (raf = requestAnimationFrame(step)), 1000 / speed)
    }
    step()
    return () => clearTimeout(raf)
  }, [inView, text, speed])

  return (
    <span ref={ref} className={className}>
      {out}
    </span>
  )
}
