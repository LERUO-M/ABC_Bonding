import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { appChain } from '../config'
import { shortenAddress } from '../utils/format'

export function Header() {
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const wrongChain = isConnected && chainId !== appChain.id

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark">ABC</span>
        <div>
          <h1>Trust Bonding</h1>
          <p>
            {appChain.name} · chain {appChain.id}
          </p>
        </div>
      </div>

      <div className="header-actions">
        {wrongChain && (
          <>
            <span className="badge badge-warn">Wrong network</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: appChain.id })}
            >
              {isSwitching ? 'Switching…' : `Switch to ${appChain.name}`}
            </button>
          </>
        )}
        {isConnected && address ? (
          <>
            <span className="address-pill">{shortenAddress(address)}</span>
            <button type="button" className="btn btn-ghost" onClick={() => disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPending}
            onClick={() => connect({ connector: connectors[0], chainId: appChain.id })}
          >
            {isPending ? 'Connecting…' : 'Connect Wallet'}
          </button>
        )}
      </div>
    </header>
  )
}
