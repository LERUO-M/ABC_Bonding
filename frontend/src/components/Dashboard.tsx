import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from '../abis'
import { useContractAddresses } from '../hooks/useContractAddresses'
import { useTokenMeta } from '../hooks/useTokenMeta'
import { formatToken } from '../utils/format'

export function Dashboard() {
  const { address } = useAccount()
  const { time, principle, memo, isLoading: addrsLoading } = useContractAddresses()

  const timeMeta = useTokenMeta(time)
  const principleMeta = useTokenMeta(principle)
  const memoMeta = useTokenMeta(memo)

  const { data: timeBal, isLoading: timeBalLoading } = useReadContract({
    address: time,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  })

  const { data: principleBal, isLoading: principleBalLoading } = useReadContract({
    address: principle,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  })

  const { data: memoBal, isLoading: memoBalLoading } = useReadContract({
    address: memo,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  })

  if (!address) {
    return (
      <section className="card card-muted">
        <p>Connect your wallet to view balances and interact with the protocol.</p>
      </section>
    )
  }

  const loading =
    addrsLoading ||
    timeBalLoading ||
    principleBalLoading ||
    memoBalLoading ||
    timeMeta.isLoading ||
    principleMeta.isLoading ||
    memoMeta.isLoading

  return (
    <section className="dashboard">
      <h2>Your balances</h2>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">{timeMeta.symbol}</span>
          <span className="stat-value">
            {loading ? '…' : formatToken(timeBal, timeMeta.decimals)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{principleMeta.symbol}</span>
          <span className="stat-value">
            {loading ? '…' : formatToken(principleBal, principleMeta.decimals)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{memoMeta.symbol}</span>
          <span className="stat-value">
            {loading ? '…' : formatToken(memoBal, memoMeta.decimals)}
          </span>
        </div>
      </div>
    </section>
  )
}
