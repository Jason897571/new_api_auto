import { useEffect, useRef } from 'react'

/** Mint sparks streaming off the pointer (additive 2D canvas, capped). */
export default function CursorTrail() {
  const ref = useRef(null)

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return
    const c = ref.current
    const ctx = c.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w, h
    const resize = () => {
      w = c.width = window.innerWidth * dpr
      h = c.height = window.innerHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)

    const ps = []
    let lx = 0
    let ly = 0
    let has = false
    const move = (e) => {
      const x = e.clientX * dpr
      const y = e.clientY * dpr
      if (has) {
        const dx = x - lx
        const dy = y - ly
        const n = Math.min(3, Math.floor(Math.hypot(dx, dy) / 6))
        for (let i = 0; i < n; i++) {
          ps.push({
            x: lx + dx * (i / n) + (Math.random() - 0.5) * 4,
            y: ly + dy * (i / n) + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5 - 0.2,
            life: 1,
            r: (Math.random() * 1.6 + 0.6) * dpr,
          })
        }
      }
      lx = x
      ly = y
      has = true
      if (ps.length > 280) ps.splice(0, ps.length - 280)
    }
    window.addEventListener('pointermove', move, { passive: true })

    let raf
    const loop = () => {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.life -= 0.032
        if (p.life <= 0) {
          ps.splice(i, 1)
          continue
        }
        p.x += p.vx
        p.y += p.vy
        ctx.beginPath()
        ctx.fillStyle = `rgba(55, 245, 176, ${p.life * 0.5})`
        ctx.arc(p.x, p.y, p.r * p.life, 0, 6.2832)
        ctx.fill()
      }
      raf = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', move)
    }
  }, [])

  return <canvas ref={ref} className="cursor-trail" aria-hidden />
}
