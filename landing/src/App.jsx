import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import Lenis from 'lenis'

import ShaderBackground from './components/ShaderBackground.jsx'
import Cursor from './components/Cursor.jsx'
import CursorTrail from './components/CursorTrail.jsx'
import Preloader from './components/Preloader.jsx'
import KineticMarquee from './components/KineticMarquee.jsx'
import Nav from './sections/Nav.jsx'
import Hero from './sections/Hero.jsx'
import Ticker from './sections/Ticker.jsx'
import Stats from './sections/Stats.jsx'
import Features from './sections/Features.jsx'
import Flow from './sections/Flow.jsx'
import SyncShowcase from './sections/SyncShowcase.jsx'
import Footer from './sections/Footer.jsx'

export default function App() {
  const [ready, setReady] = useState(false)
  const lenisRef = useRef(null)

  // Lenis inertial scroll + smooth anchor jumps
  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 1 })
    lenisRef.current = lenis
    let raf
    const loop = (t) => {
      lenis.raf(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onClick = (e) => {
      const a = e.target.closest('a[href^="#"]')
      if (!a) return
      const href = a.getAttribute('href')
      if (href.length > 1) {
        const el = document.querySelector(href)
        if (el) {
          e.preventDefault()
          lenis.scrollTo(el, { offset: 0, duration: 1.4 })
        }
      }
    }
    document.addEventListener('click', onClick)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('click', onClick)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  // Freeze scroll during the intro, release when ready
  useEffect(() => {
    const l = lenisRef.current
    if (!l) return
    if (ready) l.start()
    else l.stop()
  }, [ready])

  return (
    <>
      <ShaderBackground />
      <div className="bg-grain" aria-hidden />
      <div className="bg-vignette" aria-hidden />
      <CursorTrail />
      <Cursor />

      <AnimatePresence>
        {!ready && <Preloader key="pre" onDone={() => setReady(true)} />}
      </AnimatePresence>

      <Nav />
      <main>
        <Hero ready={ready} />
        <Ticker />
        <Stats />
        <Features />
        <KineticMarquee />
        <Flow />
        <SyncShowcase />
        <Footer />
      </main>
    </>
  )
}
