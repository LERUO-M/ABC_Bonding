import { useMemo, useState } from 'react'
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from 'wagmi'
import { maxUint256 } from 'viem'
import { erc20Abi, stakingAbi } from '../abis'
import { useContractAddresses } from '../hooks/useContractAddresses'
import { useRefreshOnTxSuccess } from '../hooks/useRefreshOnTxSuccess'
import { useTokenMeta } from '../hooks/useTokenMeta'
import { formatToken, parseTokenInput } from '../utils/format'
import type { ReadContracts } from '../types'

export function StakePanel() {
  const { address, chainId } = useAccount()
  const { staking, time, memo } = useContractAddresses()
  const timeMeta = useTokenMeta(time)
  const memoMeta = useTokenMeta(memo)

  const [stakeAmount, setStakeAmount] = useState('')
  const [unstakeAmount, setUnstakeAmount] = useState('')
  const [step, setStep] = useState<
    'idle' | 'approveTime' | 'approveMemo' | 'stake' | 'claim' | 'unstake' | 'rebase'
  >('idle')

  const parsedStake = useMemo(
    () => parseTokenInput(stakeAmount, timeMeta.decimals),
    [stakeAmount, timeMeta.decimals],
  )
  const parsedUnstake = useMemo(
    () => parseTokenInput(unstakeAmount, memoMeta.decimals),
    [unstakeAmount, memoMeta.decimals],
  )

  const stakingMetaContracts =
    staking && address
      ? ([
          { address: staking, abi: stakingAbi, functionName: 'epoch' as const },
          { address: staking, abi: stakingAbi, functionName: 'warmupPeriod' as const },
          { address: staking, abi: stakingAbi, functionName: 'index' as const },
          {
            address: staking,
            abi: stakingAbi,
            functionName: 'warmupInfo' as const,
            args: [address] as const,
          },
        ] as const)
      : staking
        ? ([
            { address: staking, abi: stakingAbi, functionName: 'epoch' as const },
            { address: staking, abi: stakingAbi, functionName: 'warmupPeriod' as const },
            { address: staking, abi: stakingAbi, functionName: 'index' as const },
          ] as const)
        : []

  const { data: stakingMeta } = useReadContracts({
    contracts: stakingMetaContracts as ReadContracts,
  })

  const epoch = stakingMeta?.[0]?.result as
    | readonly [bigint, bigint, number, number]
    | undefined
  const warmupPeriod = stakingMeta?.[1]?.result as bigint | undefined
  const memoIndex = stakingMeta?.[2]?.result as bigint | undefined
  const warmupInfo = address
    ? (stakingMeta?.[3]?.result as readonly [bigint, bigint, bigint, boolean] | undefined)
    : undefined

  const { data: timeAllowance } = useReadContract({
    address: time,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && staking ? [address, staking] : undefined,
  })

  const { data: memoAllowance } = useReadContract({
    address: memo,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && staking ? [address, staking] : undefined,
  })

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract()

  const { isSuccess, isConfirming } = useRefreshOnTxSuccess(txHash, () => {
    setStep('idle')
    setStakeAmount('')
    setUnstakeAmount('')
    reset()
  })

  const needsTimeApproval =
    parsedStake !== null &&
    parsedStake > 0n &&
    (timeAllowance === undefined || timeAllowance < parsedStake)

  const needsMemoApproval =
    parsedUnstake !== null &&
    parsedUnstake > 0n &&
    (memoAllowance === undefined || memoAllowance < parsedUnstake)

  const canClaim =
    warmupInfo &&
    warmupInfo[2] > 0n &&
    epoch &&
    epoch[0] >= warmupInfo[2]

  const epochEnds = epoch ? new Date(Number(epoch[3]) * 1000) : undefined

  function handleApproveTime() {
    if (!time || !staking) return
    setStep('approveTime')
    writeContract({
      address: time,
      abi: erc20Abi,
      functionName: 'approve',
      args: [staking, maxUint256],
      chainId,
    })
  }

  function handleApproveMemo() {
    if (!memo || !staking) return
    setStep('approveMemo')
    writeContract({
      address: memo,
      abi: erc20Abi,
      functionName: 'approve',
      args: [staking, maxUint256],
      chainId,
    })
  }

  function handleStake() {
    if (!staking || !address || !parsedStake) return
    setStep('stake')
    writeContract({
      address: staking,
      abi: stakingAbi,
      functionName: 'stake',
      args: [parsedStake, address],
      chainId,
    })
  }

  function handleClaim() {
    if (!staking || !address) return
    setStep('claim')
    writeContract({
      address: staking,
      abi: stakingAbi,
      functionName: 'claim',
      args: [address],
      chainId,
    })
  }

  function handleUnstake() {
    if (!staking || !parsedUnstake) return
    setStep('unstake')
    writeContract({
      address: staking,
      abi: stakingAbi,
      functionName: 'unstake',
      args: [parsedUnstake, true],
      chainId,
    })
  }

  function handleRebase() {
    if (!staking) return
    setStep('rebase')
    writeContract({
      address: staking,
      abi: stakingAbi,
      functionName: 'rebase',
      chainId,
    })
  }

  if (!address) {
    return (
      <section className="card">
        <h2>Stake</h2>
        <p className="hint">Connect a wallet to stake TIME and earn rebases.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Stake</h2>
      <p className="hint">Stake {timeMeta.symbol} to receive rebasing {memoMeta.symbol}.</p>

      <div className="stat-grid stat-grid-inline">
        <div className="stat">
          <span className="stat-label">Epoch</span>
          <span className="stat-value">{epoch ? epoch[0].toString() : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Next rebase</span>
          <span className="stat-value stat-value-sm">
            {epochEnds ? epochEnds.toLocaleString() : '—'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{memoMeta.symbol} index</span>
          <span className="stat-value">{formatToken(memoIndex, memoMeta.decimals, 6)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Warmup epochs</span>
          <span className="stat-value">{warmupPeriod?.toString() ?? '—'}</span>
        </div>
      </div>

      <div className="form-block">
        <label htmlFor="stake-amount">Stake {timeMeta.symbol}</label>
        <input
          id="stake-amount"
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={stakeAmount}
          onChange={(e) => setStakeAmount(e.target.value)}
        />
      </div>

      <div className="btn-row">
        {needsTimeApproval ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isPending || isConfirming || !parsedStake}
            onClick={handleApproveTime}
          >
            {step === 'approveTime' && (isPending || isConfirming)
              ? 'Approving…'
              : `Approve ${timeMeta.symbol}`}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPending || isConfirming || !parsedStake}
            onClick={handleStake}
          >
            {step === 'stake' && (isPending || isConfirming) ? 'Staking…' : 'Stake'}
          </button>
        )}
      </div>

      {(warmupInfo?.[0] ?? 0n) > 0n && (
        <div className="position-box">
          <h3>Warmup</h3>
          <ul className="position-list">
            <li>
              <span>{timeMeta.symbol} in warmup</span>
              <strong>{formatToken(warmupInfo?.[0], timeMeta.decimals)}</strong>
            </li>
            <li>
              <span>Claimable at epoch</span>
              <strong>{warmupInfo?.[2]?.toString() ?? '—'}</strong>
            </li>
          </ul>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canClaim || isPending || isConfirming}
            onClick={handleClaim}
          >
            {step === 'claim' && (isPending || isConfirming)
              ? 'Claiming…'
              : `Claim ${memoMeta.symbol}`}
          </button>
        </div>
      )}

      <hr className="divider" />

      <div className="form-block">
        <label htmlFor="unstake-amount">
          Unstake {memoMeta.symbol} → {timeMeta.symbol}
        </label>
        <input
          id="unstake-amount"
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={unstakeAmount}
          onChange={(e) => setUnstakeAmount(e.target.value)}
        />
      </div>

      <div className="btn-row">
        {needsMemoApproval ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isPending || isConfirming || !parsedUnstake}
            onClick={handleApproveMemo}
          >
            {step === 'approveMemo' && (isPending || isConfirming)
              ? 'Approving…'
              : `Approve ${memoMeta.symbol}`}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isPending || isConfirming || !parsedUnstake}
            onClick={handleUnstake}
          >
            {step === 'unstake' && (isPending || isConfirming) ? 'Unstaking…' : 'Unstake'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={isPending || isConfirming}
          onClick={handleRebase}
        >
          {step === 'rebase' && (isPending || isConfirming) ? 'Rebasing…' : 'Trigger rebase'}
        </button>
      </div>

      {writeError && <p className="error">{writeError.message.split('\n')[0]}</p>}
      {isSuccess && <p className="success">Transaction confirmed.</p>}
    </section>
  )
}
