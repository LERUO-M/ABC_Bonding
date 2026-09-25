import { useReadContracts } from 'wagmi'
import { erc20Abi } from '../abis'
import type { ReadContracts } from '../types'

const DEFAULT_TIME_DECIMALS = 9

export function useTokenMeta(token?: `0x${string}`) {
  const contracts = token
    ? ([
        { address: token, abi: erc20Abi, functionName: 'decimals' as const },
        { address: token, abi: erc20Abi, functionName: 'symbol' as const },
      ] as const)
    : []

  const { data, isLoading } = useReadContracts({
    contracts: contracts as ReadContracts,
  })

  const decimalsRaw = data?.[0]?.result as number | undefined
  const symbol = (data?.[1]?.result as string | undefined) ?? 'TOKEN'

  return {
    isLoading,
    decimals: decimalsRaw ?? DEFAULT_TIME_DECIMALS,
    symbol,
  }
}
