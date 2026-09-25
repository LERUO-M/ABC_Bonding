import { useReadContracts } from 'wagmi'
import { bondDepositoryAbi, stakingAbi } from '../abis'
import { contracts } from '../config'
import type { ReadContracts } from '../types'

export function useContractAddresses() {
  const bond = contracts.bondDepository
  const staking = contracts.staking

  const addressContracts = [
    ...(bond && !contracts.time
      ? [{ address: bond, abi: bondDepositoryAbi, functionName: 'Time' as const }]
      : []),
    ...(bond && !contracts.principle
      ? [{ address: bond, abi: bondDepositoryAbi, functionName: 'principle' as const }]
      : []),
    ...(staking && !contracts.memo
      ? [{ address: staking, abi: stakingAbi, functionName: 'Memories' as const }]
      : []),
    ...(staking && !contracts.time
      ? [{ address: staking, abi: stakingAbi, functionName: 'Time' as const }]
      : []),
  ]

  const { data, isLoading } = useReadContracts({
    contracts: addressContracts as ReadContracts,
  })

  let timeFromBond: `0x${string}` | undefined
  let principleFromBond: `0x${string}` | undefined
  let memoFromStaking: `0x${string}` | undefined
  let timeFromStaking: `0x${string}` | undefined

  let i = 0
  if (bond && !contracts.time) {
    timeFromBond = data?.[i]?.result as `0x${string}` | undefined
    i++
  }
  if (bond && !contracts.principle) {
    principleFromBond = data?.[i]?.result as `0x${string}` | undefined
    i++
  }
  if (staking && !contracts.memo) {
    memoFromStaking = data?.[i]?.result as `0x${string}` | undefined
    i++
  }
  if (staking && !contracts.time) {
    timeFromStaking = data?.[i]?.result as `0x${string}` | undefined
  }

  return {
    isLoading,
    bondDepository: bond,
    staking,
    time: contracts.time ?? timeFromBond ?? timeFromStaking,
    principle: contracts.principle ?? principleFromBond,
    memo: contracts.memo ?? memoFromStaking,
  }
}
