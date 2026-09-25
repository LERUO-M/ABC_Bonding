import { useMemo, useState } from 'react'
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from 'wagmi'
import { maxUint256 } from 'viem'
import { bondDepositoryAbi, erc20Abi, treasuryAbi } from '../abis'
import { ZERO } from '../config'
import { useContractAddresses } from '../hooks/useContractAddresses'
import { useRefreshOnTxSuccess } from '../hooks/useRefreshOnTxSuccess'
import { useTokenMeta } from '../hooks/useTokenMeta'
import { formatToken, parseTokenInput } from '../utils/format'
import type { ReadContracts } from '../types'

export function BondPanel() {
  const { address, chainId } = useAccount()
  const { bondDepository, principle } = useContractAddresses()
  const principleMeta = useTokenMeta(principle)

  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState('5')
  const [stakeOnRedeem, setStakeOnRedeem] = useState(true)
  const [step, setStep] = useState<'idle' | 'approve' | 'bond' | 'redeem'>('idle')

  const bondMetaContracts = bondDepository
    ? ([
        { address: bondDepository, abi: bondDepositoryAbi, functionName: 'bondPrice' as const },
        { address: bondDepository, abi: bondDepositoryAbi, functionName: 'bondPriceInUSD' as const },
        { address: bondDepository, abi: bondDepositoryAbi, functionName: 'currentDebt' as const },
        { address: bondDepository, abi: bondDepositoryAbi, functionName: 'terms' as const },
        { address: bondDepository, abi: bondDepositoryAbi, functionName: 'treasury' as const },
        { address: bondDepository, abi: bondDepositoryAbi, functionName: 'staking' as const },
        { address: bondDepository, abi: bondDepositoryAbi, functionName: 'useHelper' as const },
      ] as const)
    : []

  const { data: bondMeta } = useReadContracts({
    contracts: bondMetaContracts as ReadContracts,
  })

  const bondPrice = bondMeta?.[0]?.result as bigint | undefined
  const bondPriceUsd = bondMeta?.[1]?.result as bigint | undefined
  const currentDebt = bondMeta?.[2]?.result as bigint | undefined
  const terms = bondMeta?.[3]?.result as
    | readonly [bigint, bigint, bigint, bigint, bigint, number]
    | undefined
  const treasury = bondMeta?.[4]?.result as `0x${string}` | undefined
  const bondStaking = bondMeta?.[5]?.result as `0x${string}` | undefined

  const parsedAmount = useMemo(
    () => parseTokenInput(amount, principleMeta.decimals),
    [amount, principleMeta.decimals],
  )

  const { data: valueOfAmount } = useReadContract({
    address: treasury && principle && parsedAmount ? treasury : undefined,
    abi: treasuryAbi,
    functionName: 'valueOf',
    args: principle && parsedAmount ? [principle, parsedAmount] : undefined,
  })

  const { data: estimatedPayout } = useReadContract({
    address: bondDepository && valueOfAmount !== undefined ? bondDepository : undefined,
    abi: bondDepositoryAbi,
    functionName: 'payoutFor',
    args: valueOfAmount !== undefined ? [valueOfAmount] : undefined,
  })

  const bondPositionContracts =
    bondDepository && address
      ? ([
          {
            address: bondDepository,
            abi: bondDepositoryAbi,
            functionName: 'bondInfo' as const,
            args: [address] as const,
          },
          {
            address: bondDepository,
            abi: bondDepositoryAbi,
            functionName: 'pendingPayoutFor' as const,
            args: [address] as const,
          },
          {
            address: bondDepository,
            abi: bondDepositoryAbi,
            functionName: 'percentVestedFor' as const,
            args: [address] as const,
          },
        ] as const)
      : []

  const { data: bondPosition } = useReadContracts({
    contracts: bondPositionContracts as ReadContracts,
  })

  const bondInfo = bondPosition?.[0]?.result as
    | readonly [bigint, bigint, number, number]
    | undefined
  const pendingPayout = bondPosition?.[1]?.result as bigint | undefined
  const percentVested = bondPosition?.[2]?.result as bigint | undefined

  const { data: allowance } = useReadContract({
    address: principle,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && bondDepository ? [address, bondDepository] : undefined,
  })

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract()

  const { isSuccess, isConfirming } = useRefreshOnTxSuccess(txHash, () => {
    setStep('idle')
    setAmount('')
    reset()
  })

  const maxPrice = useMemo(() => {
    if (!bondPrice) return undefined
    const slip = Number(slippage) || 0
    return bondPrice + (bondPrice * BigInt(Math.round(slip * 100))) / 10000n
  }, [bondPrice, slippage])

  const needsApproval =
    parsedAmount !== null &&
    parsedAmount > 0n &&
    (allowance === undefined || allowance < parsedAmount)

  const bondReady = terms !== undefined && terms[0] > 0n
  const autoStakeReady = !stakeOnRedeem || (bondStaking !== undefined && bondStaking !== ZERO)

  function handleApprove() {
    if (!principle || !bondDepository) return
    setStep('approve')
    writeContract({
      address: principle,
      abi: erc20Abi,
      functionName: 'approve',
      args: [bondDepository, maxUint256],
      chainId,
    })
  }

  function handleBond() {
    if (!bondDepository || !address || !parsedAmount || !maxPrice) return
    setStep('bond')
    writeContract({
      address: bondDepository,
      abi: bondDepositoryAbi,
      functionName: 'deposit',
      args: [parsedAmount, maxPrice, address],
      chainId,
    })
  }

  function handleRedeem() {
    if (!bondDepository || !address) return
    setStep('redeem')
    writeContract({
      address: bondDepository,
      abi: bondDepositoryAbi,
      functionName: 'redeem',
      args: [address, stakeOnRedeem],
      chainId,
    })
  }

  if (!address) {
    return (
      <section className="card">
        <h2>Bonds</h2>
        <p className="hint">Connect a wallet to purchase or redeem bonds.</p>
      </section>
    )
  }

  const vestingDays = terms ? Number(terms[5]) / 86400 : undefined

  return (
    <section className="card">
      <h2>Bonds</h2>
      <p className="hint">
        Deposit {principleMeta.symbol} to receive vesting TIME at a discount.
      </p>

      {!bondReady && (
        <p className="error">Bond market not initialized yet (initializeBondTerms required).</p>
      )}

      <div className="stat-grid stat-grid-inline">
        <div className="stat">
          <span className="stat-label">Bond price</span>
          <span className="stat-value">
            {formatToken(bondPriceUsd, principleMeta.decimals, 2)} {principleMeta.symbol}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Debt outstanding</span>
          <span className="stat-value">{formatToken(currentDebt, 9)} TIME</span>
        </div>
        {vestingDays !== undefined && (
          <div className="stat">
            <span className="stat-label">Vesting</span>
            <span className="stat-value">{vestingDays.toFixed(1)} days</span>
          </div>
        )}
      </div>

      <div className="form-block">
        <label htmlFor="bond-amount">Amount to bond ({principleMeta.symbol})</label>
        <input
          id="bond-amount"
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {parsedAmount && estimatedPayout !== undefined && (
          <p className="estimate">
            Estimated payout: <strong>{formatToken(estimatedPayout, 9)} TIME</strong>
          </p>
        )}
      </div>

      <div className="form-block">
        <label htmlFor="slippage">Max price slippage (%)</label>
        <input
          id="slippage"
          type="number"
          min="0"
          max="100"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
        />
      </div>

      <div className="btn-row">
        {needsApproval ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isPending || isConfirming || !parsedAmount || !bondReady}
            onClick={handleApprove}
          >
            {step === 'approve' && (isPending || isConfirming)
              ? 'Approving…'
              : `Approve ${principleMeta.symbol}`}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPending || isConfirming || !parsedAmount || !maxPrice || !bondReady}
            onClick={handleBond}
          >
            {step === 'bond' && (isPending || isConfirming) ? 'Bonding…' : 'Purchase bond'}
          </button>
        )}
      </div>

      {(bondInfo?.[0] ?? 0n) > 0n && (
        <div className="position-box">
          <h3>Your bond</h3>
          <ul className="position-list">
            <li>
              <span>Total payout remaining</span>
              <strong>{formatToken(bondInfo?.[0], 9)} TIME</strong>
            </li>
            <li>
              <span>Claimable now</span>
              <strong>{formatToken(pendingPayout, 9)} TIME</strong>
            </li>
            <li>
              <span>Vested</span>
              <strong>{((Number(percentVested ?? 0n) / 100).toFixed(1))}%</strong>
            </li>
          </ul>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={stakeOnRedeem}
              onChange={(e) => setStakeOnRedeem(e.target.checked)}
            />
            Auto-stake TIME on redeem
          </label>

          {stakeOnRedeem && !autoStakeReady && (
            <p className="error">Auto-stake requires bond.setStaking — uncheck or configure on-chain.</p>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={
              isPending ||
              isConfirming ||
              !pendingPayout ||
              pendingPayout === 0n ||
              (stakeOnRedeem && !autoStakeReady)
            }
            onClick={handleRedeem}
          >
            {step === 'redeem' && (isPending || isConfirming)
              ? 'Redeeming…'
              : 'Redeem vested TIME'}
          </button>
        </div>
      )}

      {writeError && <p className="error">{writeError.message.split('\n')[0]}</p>}
      {isSuccess && <p className="success">Transaction confirmed.</p>}
    </section>
  )
}
