import { useProtocolStatus } from '../hooks/useProtocolStatus'

export function ProtocolStatus() {
  const { items, allOk, isLoading } = useProtocolStatus()

  return (
    <section className={`card protocol-status ${allOk ? 'protocol-ok' : 'protocol-warn'}`}>
      <h2>Protocol wiring</h2>
      <p className="hint">
        {isLoading
          ? 'Checking on-chain configuration…'
          : allOk
            ? 'All checks passed — users can bond and stake.'
            : 'Some setup steps may still be required on-chain.'}
      </p>
      <ul className="status-list">
        {items.map((item) => (
          <li key={item.label} className={item.ok ? 'status-ok' : 'status-bad'}>
            <span className="status-dot" aria-hidden />
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
