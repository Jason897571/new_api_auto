const WORDS = ['真实价格', '一键同步', '快照回滚', '主站子站', '阶梯校验']

export default function KineticMarquee() {
  const seq = [...WORDS, ...WORDS]
  return (
    <div className="kmarquee" aria-hidden="true">
      <div className="kmarquee-track">
        {seq.map((w, i) => (
          <em key={i} className={i % 3 === 1 ? 'fill' : ''} data-text={w}>
            {w}
            <span className="star"> ✦ </span>
          </em>
        ))}
      </div>
    </div>
  )
}
