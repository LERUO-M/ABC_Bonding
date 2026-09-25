# ABC Trust Bonding — Frontend

Simple wallet UI for end users to **bond** reserve tokens and **stake** TIME with the ABC Bonding contracts.

## Features

- Connect wallet (MetaMask / injected provider) with **network switch** button
- **Protocol wiring panel** — on-chain health checks (bytecode, bond init, treasury whitelist, warmup, auto-stake link)
- View TIME, reserve (MIM), and MEMO balances (decimals/symbols read from chain)
- **Bond**: approve + purchase bonds, view vesting, redeem (optional auto-stake)
- **Stake**: approve TIME, stake, claim MEMO after warmup, approve MEMO + unstake, trigger rebase
- Auto-refresh balances after each confirmed transaction

## Setup

```bash
cd frontend
cp .env.example .env
# Edit .env with your RPC URL, chain ID, and deployed addresses
npm install
npm run dev
```

Open http://localhost:5173

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_RPC_URL` | Yes | JSON-RPC endpoint |
| `VITE_CHAIN_ID` | Yes | Chain ID (e.g. `31337` local, `43114` Avalanche) |
| `VITE_BOND_DEPOSITORY` | Yes | `BondDepository` contract address |
| `VITE_STAKING` | Yes | `Staking` contract address |
| `VITE_TIME_TOKEN` | No | Auto-read from bond/staking if omitted |
| `VITE_PRINCIPLE_TOKEN` | No | Auto-read from bond if omitted |
| `VITE_MEMO_TOKEN` | No | Auto-read from staking if omitted |

## Prerequisites on-chain

The **Protocol wiring** panel at the top of the app checks these automatically:

1. Contract bytecode exists at configured addresses (RPC reachable)
2. `initializeBondTerms` called on `BondDepository`
3. `BondDepository` whitelisted as treasury **reserve depositor**
4. `Staking.setContract(WARMUP, …)` configured
5. `BondDepository.setStaking(…)` configured (for redeem auto-stake)

For rebases to mint rewards, also configure off-app:

- `StakingDistributor` as treasury **reward manager**
- `Staking` added as distributor recipient

## Build

```bash
npm run build
npm run preview
```

## Stack

- React + TypeScript + Vite
- [wagmi](https://wagmi.sh) + [viem](https://viem.sh) for Ethereum interactions
