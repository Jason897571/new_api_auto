// 改动清单：按分组（目标站/站点）列出 模型 · 维度 · 当前值 → 新值。
// groups: [{ name, error, changes: [{ model, label, before, after }] }]
export default function ChangeList({ groups }) {
  return (
    <div className="changelist">
      {groups.map((g) => (
        <div key={g.name} className="cl-group">
          <div className="cl-group-head">
            <b>{g.name}</b>
            {g.error
              ? <span className="err-text"> · {g.error}</span>
              : <span className="muted"> · {g.changes.length} 项改动</span>}
          </div>
          {!g.error && (g.changes.length === 0 ? (
            <div className="cl-empty">无改动</div>
          ) : (
            <table className="cl-table">
              <tbody>
                {g.changes.map((c, i) => (
                  <tr key={c.model + '|' + c.label + '|' + i}>
                    <td className="cl-model" title={c.model}>{c.model}</td>
                    <td className="cl-label"><span className="pill">{c.label}</span></td>
                    <td className="cl-before">{c.before}</td>
                    <td className="cl-arrow">→</td>
                    <td className="cl-after">{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ))}
    </div>
  )
}
