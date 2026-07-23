// A market-board price ticker — flavor only (illustrative $/1M-token prices).
const ROWS = [
  { sym: 'gpt-4o', prc: '2.50 / 10.00', d: '+0.0%', up: true },
  { sym: 'claude-3.5-sonnet', prc: '3.00 / 15.00', d: '−4.8%', up: false },
  { sym: 'gemini-1.5-pro', prc: '1.25 / 5.00', d: '+0.0%', up: true },
  { sym: 'o1', prc: '15.00 / 60.00', d: '+3.4%', up: true },
  { sym: 'deepseek-v3', prc: '0.27 / 1.10', d: '−12.0%', up: false },
  { sym: 'gpt-4o-mini', prc: '0.15 / 0.60', d: '+0.0%', up: true },
  { sym: 'claude-3-opus', prc: '15.00 / 75.00', d: '+0.0%', up: true },
  { sym: 'llama-3.1-405b', prc: '2.70 / 2.70', d: '−6.2%', up: false },
  { sym: 'mistral-large', prc: '2.00 / 6.00', d: '+0.0%', up: true },
  { sym: 'qwen-2.5-72b', prc: '0.35 / 0.40', d: '−9.1%', up: false },
]

export default function Ticker() {
  const loop = [...ROWS, ...ROWS]
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {loop.map((r, i) => (
          <span className="tk" key={i}>
            <span className="sym">{r.sym}</span>
            <span className="prc">${r.prc}</span>
            <span className={`dl ${r.up ? 'up' : 'dn'}`}>{r.d}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
