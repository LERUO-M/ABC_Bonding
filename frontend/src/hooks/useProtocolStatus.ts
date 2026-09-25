import { useEffect, useState } from 'react'
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { bondDepositoryAbi, stakingAbi, treasuryAbi } from '../abis'
import { contracts, ZERO } from '../config'
import type { ReadContracts } from '../types'

export type StatusItem = {
  label: string
  ok: boolean
  detail: string
}

export function useProtocolStatus() {
  const publicClient = usePublicClient()
  const [bytecodeOk, setBytecodeOk] = useState<boolean | null>(null)

  const bond = contracts.bondDepository
  const staking = contracts.staking

  const { data, isLoading, isError } = useReadContracts({
    contracts: [
      ...(bond
        ? [
            { address: bond, abi: bondDepositoryAbi, functionName: 'terms' as const },
            { address: bond, abi: bondDepositoryAbi, functionName: 'treasury' as const },
            { address: bond, abi: bondDepositoryAbi, functionName: 'staking' as const },
            { address: bond, abi: bondDepositoryAbi, functionName: 'useHelper' as const },
          ]
        : []),
      ...(staking
        ? [{ address: staking, abi: stakingAbi, functionName: 'warmupContract' as const }]
        : []),
    ] as ReadContracts,
  })

  let idx = 0
  const terms = bond
    ? (data?.[idx++]?.result as
        | readonly [bigint, bigint, bigint, bigint, bigint, number]
        | undefined)
    : undefined
  const treasury = bond ? (data?.[idx++]?.result as `0x${string}` | undefined) : undefined
  const bondStaking = bond ? (data?.[idx++]?.result as `0x${string}` | undefined) : undefined
  const useHelper = bond ? (data?.[idx++]?.result as boolean | undefined) : undefined
  const warmupContract = staking
    ? (data?.[idx++]?.result as `0x${string}` | undefined)
    : undefined

  const { data: isReserveDepositor } = useReadContract({
    address: treasury,
    abi: treasuryAbi,
    functionName: 'isReserveDepositor',
    args: bond ? [bond] : undefined,
  })

  useEffect(() => {
    if (!publicClient || !bond || !staking) {
      setBytecodeOk(null)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const [bondCode, stakingCode] = await Promise.all([
          publicClient.getBytecode({ address: bond }),
          publicClient.getBytecode({ address: staking }),
        ])
        if (!cancelled) {
          setBytecodeOk(Boolean(bondCode && bondCode !== '0x' && stakingCode && stakingCode !== '0x'))
        }
      } catch {
        if (!cancelled) setBytecodeOk(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [publicClient, bond, staking])

  const bondInitialized = terms !== undefined && terms[0] > 0n
  const reserveDepositorOk = isReserveDepositor === true
  const warmupConfigured = warmupContract !== undefined && warmupContract !== ZERO
  const stakingLinked = bondStaking !== undefined && bondStaking !== ZERO

  const items: StatusItem[] = [
    {
      label: 'RPC / contracts reachable',
      ok: !isError && bytecodeOk === true,
      detail:
        bytecodeOk === null
          ? 'Checking…'
          : bytecodeOk
            ? 'Bytecode found at bond & staking addresses'
            : 'Could not read contract bytecode — check addresses & RPC',
    },
    {
      label: 'Bond market initialized',
      ok: bondInitialized,
      detail: bondInitialized
        ? `BCV ${terms![0].toString()}, vesting ${(Number(terms![5]) / 86400).toFixed(1)}d`
        : 'Call initializeBondTerms on BondDepository',
    },
    {
      label: 'Treasury reserve depositor',
      ok: reserveDepositorOk,
      detail: reserveDepositorOk
        ? 'BondDepository can deposit to treasury'
        : 'Whitelist bond as RESERVEDEPOSITOR on treasury',
    },
    {
      label: 'Staking warmup contract',
      ok: warmupConfigured,
      detail: warmupConfigured
        ? 'Warmup vault configured'
        : 'Call staking.setContract(WARMUP, …) before users stake',
    },
    {
      label: 'Bond → staking link',
      ok: stakingLinked,
      detail: stakingLinked
        ? useHelper
          ? 'Auto-stake uses StakingHelper'
          : 'Auto-stake uses Staking directly'
        : 'Call bond.setStaking for redeem auto-stake',
    },
  ]

  const allOk = items.every((item) => item.ok)

  return { items, allOk, isLoading: isLoading || bytecodeOk === null }
}
