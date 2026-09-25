import { formatUnits, parseUnits } from 'viem'

export function formatToken(amount: bigint | undefined, decimals = 9, maxFrac = 4): string {
  if (amount === undefined) return '—'
  const s = formatUnits(amount, decimals)
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n === 0) return '0'
  if (n < 0.0001) return '<0.0001'
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac })
}

export function parseTokenInput(value: string, decimals = 9): bigint | null {
  const trimmed = value.trim()
  if (!trimmed || Number.isNaN(Number(trimmed))) return null
  try {
    return parseUnits(trimmed, decimals)
  } catch {
    return null
  }
}

export function formatPercent(bps: bigint | undefined, scale = 100n): string {
  if (bps === undefined) return '—'
  return `${(Number(bps) / Number(scale)).toFixed(2)}%`
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
