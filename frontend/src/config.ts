import { defineChain } from 'viem'

export const rpcUrl = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337)

export const appChain = defineChain({
  id: chainId,
  name: import.meta.env.VITE_CHAIN_NAME ?? 'Local',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
})

export const ZERO = '0x0000000000000000000000000000000000000000' as const

function parseAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value || value === ZERO) return undefined
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return undefined
  return value as `0x${string}`
}

export const contracts = {
  bondDepository: parseAddress(import.meta.env.VITE_BOND_DEPOSITORY),
  staking: parseAddress(import.meta.env.VITE_STAKING),
  time: parseAddress(import.meta.env.VITE_TIME_TOKEN),
  principle: parseAddress(import.meta.env.VITE_PRINCIPLE_TOKEN),
  memo: parseAddress(import.meta.env.VITE_MEMO_TOKEN),
}

export function isConfigured(): boolean {
  return Boolean(contracts.bondDepository && contracts.staking)
}
