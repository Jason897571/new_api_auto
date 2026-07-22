import { useEffect } from 'react'

// 通用弹窗：遮罩 + 居中卡片 + 标题 + body + footer（取消/确认）。
export default function Modal({ title, subtitle, children, onCancel, onConfirm,
  confirmText = '确认', confirmDanger = false, confirmDisabled = false, busy = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button
            className={'btn ' + (confirmDanger ? 'btn-danger-solid' : 'btn-primary')}
            onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
