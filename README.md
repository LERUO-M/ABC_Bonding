# ABC Bonding

Solidity bonding/staking protocol (TRUST/MEMO/wMEMO, Treasury, Staking, BondDepository) with a Vite/React frontend.

## Prerequisites

- Node.js + npm
- Copy `.env` and fill in the values you need (see below)

```bash
npm install
```

## Environment variables (`.env`, repo root)

| Variable | Required for | Description |
|---|---|---|
| `SEPOLIA_RPC_URL` | Deploying to Sepolia | JSON-RPC endpoint (e.g. Alchemy/Infura) |
| `PRIVATE_KEY` | Deploying to Sepolia | Deployer wallet private key |
| `ETHERSCAN_API_KEY` | Contract verification | Etherscan API key |
| `DAO_ADDRESS` | Optional | Receives bond profit share / becomes contract owner. Defaults to deployer |
| `RESERVE_TOKEN` | Optional | Existing ERC20 to use as principle/reserve asset. If unset, a `MockReserveToken` is deployed and seeded automatically |
| `EPOCH_LENGTH` | Optional | Staking epoch length in seconds (default `28800` = 8h) |
| `FIRST_EPOCH_TIME` | Optional | Unix timestamp of first epoch end (default: now + `EPOCH_LENGTH`) |
| `MAX_DEBT` | Optional | Max outstanding bond debt, in whole TRUST tokens (default `1000000000`) |
| `MIN_PRICE` | Optional | Bond price floor (default `200`; must stay > 100/parity, see note in script) |
| `REDEMPTION_DEADLINE` | Optional | Unix timestamp for `MemoExchange` deadline (non-functional placeholder contract) |
| `REDEMPTION_MERKLE_ROOT` | Optional | Merkle root for `MemoExchange` (non-functional placeholder contract) |
| `SKIP_OWNERSHIP_TRANSFER` | Optional | If `"true"`, skip transferring contract ownership to `DAO_ADDRESS` |
| `SKIP_VERIFY` | Optional | If `"true"`, skip Etherscan/Sourcify verification |
| `VERIFY_CONFIRMATIONS` | Optional | Block confirmations to wait before verifying (default `5`) |

`hardhat` and `localhost` networks never need `SEPOLIA_RPC_URL`/`PRIVATE_KEY` — there's no explorer to verify against either, so verification is skipped automatically.

## Quick start (local Hardhat network + frontend)

Deploys every contract to a local `hardhat node`, wires the protocol, writes the deployed addresses into `frontend/.env`, and starts the frontend dev server — all in one command:

```bash
npm run start:all -- --hardhat
```

Then open http://localhost:5173, and in MetaMask:
1. Add a network: RPC `http://127.0.0.1:8545`, Chain ID `31337`.
2. Import one of the funded test accounts printed by the `hardhat node` logs (e.g. `Account #0`, which is also the deployer and already holds seeded TRUST/reserve tokens).
3. Click **Connect Wallet** in the app.

Press `Ctrl+C` to stop both the local node and the frontend together.

## Deploying to a real network (e.g. Sepolia)

Fill in `SEPOLIA_RPC_URL` and `PRIVATE_KEY` in `.env`, then:

```bash
npm run start:all -- --network sepolia
```

or the default (`sepolia` is used when `--hardhat`/`--network` are both omitted):

```bash
npm run start:all
```

This deploys + verifies contracts on `sepolia`, updates `frontend/.env`, and starts the frontend pointed at that network.

### `start:all` options

```bash
node scripts/startAll.js [--hardhat] [--network <name>] [--skip-deploy]
```

| Flag | Effect |
|---|---|
| `--hardhat` | Spawns a local `hardhat node`, deploys to it (network `localhost`), points the frontend at `http://127.0.0.1:8545` / chain id `31337`. No `RESERVE_TOKEN`/RPC/key needed — a `MockReserveToken` is deployed and the treasury is auto-seeded. |
| `--network <name>` | Deploy to an already-configured Hardhat network (default: `sepolia`). Requires that network's RPC URL + private key to already be set in `.env`. |
| `--skip-deploy` | Skip deployment; just re-wire `frontend/.env` from the most recent `deployments/<network>-*.json` and restart the frontend. Useful for restarting the frontend without redeploying. |

> Note: when using `npm run start:all`, flags must come after `--` (e.g. `npm run start:all -- --hardhat`), otherwise npm swallows them.

## Deploying + verifying contracts only (no frontend)

```bash
npm run deployAllAndVerify -- --network sepolia
# or, for a local hardhat node you've already started separately:
npm run deployAllAndVerify -- --network localhost
```

This deploys all protocol contracts, wires them together (treasury/staking/bond permissions, seed TRUST supply if using a mock reserve token, bond terms), verifies each contract on Etherscan/Sourcify, and runs a dry-run smoke test of `BondDepository.deposit()` to confirm bonding actually works before finishing.

### Where do the deployed addresses go?

After a successful run, addresses are available in two places:

1. **Console output** — a summary table is printed at the end:
   ```
   ===== Deployment summary =====
   ┌───────────────────┬──────────────────────────────────────────────┐
   │ (index)           │ Values                                       │
   ├───────────────────┼──────────────────────────────────────────────┤
   │ TRUST             │ '0x...'                                      │
   │ BondDepository    │ '0x...'                                      │
   │ ...               │ ...                                          │
   └───────────────────┴──────────────────────────────────────────────┘
   ```
2. **JSON file** — written to `deployments/<network>-<timestamp>.json` (gitignored):
   ```json
   {
     "deployments": { "TRUST": "0x...", "BondDepository": "0x...", "..." },
     "verification": { "TRUST": "verified", "..." }
   }
   ```

Running this script directly (instead of via `start:all`) does **not** update `frontend/.env` automatically — copy the addresses from the JSON file into `frontend/.env` yourself (see `frontend/.env.example`), or just use `npm run start:all` instead, which does this for you.

## Testing

```bash
npm test        # unit tests for individual contracts (test/core.test.js)
npm run test:e2e  # full end-to-end deployment/wiring test, exercises deposit()/redeem() on BondDepository (test/deployAll.e2e.test.js)
```

## Frontend only

```bash
cd frontend
cp .env.example .env   # edit with RPC URL, chain ID, and deployed addresses
npm install
npm run dev
```

See `frontend/README.md` for details on the frontend's environment variables and features.

## AI coding assistant skills

This repo ships repo-specific instructions for AI coding assistants (e.g. GitHub Copilot CLI) under
[`.copilot/skills/`](./.copilot/skills/). These are **not** auto-discovered by every harness —
Copilot CLI/IDE integrations typically load skills from a user-level config directory outside the
repo, so each contributor needs to install them once per machine:

```bash
# GitHub Copilot CLI (adjust <owner>/<repo> to match this repository, lowercased)
mkdir -p ~/.config/github-copilot/github/leruo-m/abc_bonding/skills
cp -r .copilot/skills/* ~/.config/github-copilot/github/leruo-m/abc_bonding/skills/
```

Currently included:

- **`compile-on-contract-change`** — reminds the assistant to run `npx hardhat compile`
  immediately after creating/editing any `.sol` file, so deployed bytecode never drifts from
  source (this caused real `unrecognized-selector` bugs in this repo after branch switches).

When adding a new skill, add its folder under `.copilot/skills/<name>/SKILL.md` and re-run the
copy command above.
