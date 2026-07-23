import { useEffect, useState } from 'react'
import Magnetic from '../components/Magnetic.jsx'
import { CONSOLE_URL } from '../config.js'

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="wrap nav-inner">
        <a className="brand" href="#top">
          <span className="brand-mark">₽</span>
          <span>
            价格中枢
            <small>PRICE CONTROL</small>
          </span>
        </a>
        <div className="nav-links">
          <a className="nl" href="#features">能力</a>
          <a className="nl" href="#flow">安全流程</a>
          <a className="nl" href="#sync">同步</a>
          <Magnetic strength={0.5}>
            <a className="btn btn-ghost" href={CONSOLE_URL}>
              进入控制台 <span className="arrow">→</span>
            </a>
          </Magnetic>
        </div>
      </div>
    </nav>
  )
}
