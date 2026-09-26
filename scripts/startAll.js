#!/usr/bin/env node
require("dotenv").config();

/**
 * Orchestration script: deploy the protocol (via scripts/deployAllAndVerify.js),
 * wire the frontend's .env with the freshly deployed addresses, then start the
 * frontend dev server.
 *
 * Usage:
 *   node scripts/startAll.js [--hardhat] [--network <name>] [--skip-deploy]
 *
 *   --hardhat      Spin up a local `hardhat node`, deploy everything against
 *                   it (network "localhost"), then point the frontend at
 *                   http://127.0.0.1:8545 / chainId 31337. A MockReserveToken
 *                   is deployed automatically (no RESERVE_TOKEN needed).
 *   --network name Deploy against an already-configured Hardhat network
 *                   (e.g. "sepolia"). Defaults to "sepolia" when --hardhat is
 *                   not passed. Requires the network's RPC_URL/PRIVATE_KEY to
 *                   already be set in .env.
 *   --skip-deploy  Skip deployment entirely and just (re)wire the frontend
 *                  .env from the most recent deployments/<network>-*.json
 *                  file, then start the frontend. Useful for restarting the
 *                  frontend without redeploying.
 *
 * Contracts are recompiled (`hardhat compile`) right before deploying, so
 * switching branches/pulling changes never deploys stale bytecode. This step
 * is skipped along with deployment when --skip-deploy is passed.
 *
 * Both a locally spawned `hardhat node` and the frontend dev server are kept
 * attached to this process and are terminated together on exit/Ctrl+C.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");

const CHAIN_IDS = {
  hardhat: 31337,
  localhost: 31337,
  sepolia: 11155111,
};

function parseArgs(argv) {
  const args = { hardhat: false, network: null, skipDeploy: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--hardhat") args.hardhat = true;
    else if (arg === "--skip-deploy") args.skipDeploy = true;
    else if (arg === "--network") args.network = argv[++i];
    else if (arg.startsWith("--network=")) args.network = arg.split("=")[1];
  }
  return args;
}

function rpcRequest(url, body) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname } = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname,
        port,
        path: pathname || "/",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: 2000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve(raw));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

async function waitForRpc(url, { retries = 60, delayMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      await rpcRequest(url, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Timed out waiting for RPC endpoint to respond: ${url}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: ROOT,
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
  }
}

// Networks defined in hardhat.config.js that need an RPC URL + private key
// from .env before `hardhat run --network <name>` can do anything useful.
// Add an entry here whenever a new remote network is added to hardhat.config.js.
const REMOTE_NETWORK_ENV_VARS = {
  sepolia: { rpc: "SEPOLIA_RPC_URL", key: "PRIVATE_KEY" },
};

function validateNetworkConfig(network, isHardhat) {
  if (isHardhat || network === "hardhat" || network === "localhost") return;

  const envVars = REMOTE_NETWORK_ENV_VARS[network];
  if (!envVars) {
    console.warn(
      `\nWarning: no known RPC/PRIVATE_KEY env vars registered for network "${network}" - ` +
        "make sure it's configured in hardhat.config.js and any required env vars are set."
    );
    return;
  }

  const missing = [];
  if (!process.env[envVars.rpc]) missing.push(envVars.rpc);
  if (!process.env[envVars.key]) missing.push(envVars.key);
  if (missing.length > 0) {
    throw new Error(
      `Cannot deploy to network "${network}": missing required .env value(s): ${missing.join(", ")}.\n` +
        `Set them in .env, or pass --hardhat to deploy locally instead.`
    );
  }
}

function latestDeploymentFile(network) {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) return null;
  const files = fs
    .readdirSync(DEPLOYMENTS_DIR)
    .filter((f) => f.startsWith(`${network}-`) && f.endsWith(".json"))
    .sort();
  if (files.length === 0) return null;
  return path.join(DEPLOYMENTS_DIR, files[files.length - 1]);
}

function writeFrontendEnv({ rpcUrl, chainId, chainName, addresses }) {
  const lines = [
    "# Auto-generated by scripts/startAll.js - do not edit by hand",
    `VITE_RPC_URL=${rpcUrl}`,
    `VITE_CHAIN_ID=${chainId}`,
    `VITE_CHAIN_NAME=${chainName}`,
    `VITE_BOND_DEPOSITORY=${addresses.BondDepository || ""}`,
    `VITE_STAKING=${addresses.Staking || ""}`,
  ];
  if (addresses.TRUST) lines.push(`VITE_TIME_TOKEN=${addresses.TRUST}`);
  if (addresses.MockReserveToken) lines.push(`VITE_PRINCIPLE_TOKEN=${addresses.MockReserveToken}`);
  else if (process.env.RESERVE_TOKEN) lines.push(`VITE_PRINCIPLE_TOKEN=${process.env.RESERVE_TOKEN}`);
  if (addresses.MEMO) lines.push(`VITE_MEMO_TOKEN=${addresses.MEMO}`);

  const outPath = path.join(FRONTEND_DIR, ".env");
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nWrote frontend env to ${outPath}:`);
  console.log(lines.filter((l) => !l.startsWith("#")).join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const network = args.hardhat ? "localhost" : args.network || process.env.NETWORK || "sepolia";
  const children = [];

  const cleanup = () => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  let hardhatNode = null;
  if (args.hardhat) {
    console.log("Starting local `hardhat node`...");
    hardhatNode = spawn("npx", ["hardhat", "node"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    children.push(hardhatNode);
    hardhatNode.on("exit", (code) => {
      if (code && code !== 0) {
        console.error(`hardhat node exited unexpectedly (code ${code})`);
        process.exit(code);
      }
    });
    await waitForRpc("http://127.0.0.1:8545");
    console.log("hardhat node is up.");
  }

  if (!args.skipDeploy) {
    validateNetworkConfig(network, args.hardhat);
    console.log("\nCompiling contracts...");
    run("npx", ["hardhat", "compile"]);
    console.log(`\nDeploying + verifying contracts on network "${network}"...`);
    run("npx", ["hardhat", "run", "scripts/deployAllAndVerify.js", "--network", network]);
  } else {
    console.log(`\nSkipping deploy, reusing latest deployment for network "${network}".`);
  }

  const deploymentFile = latestDeploymentFile(network);
  if (!deploymentFile) {
    throw new Error(
      `No deployment file found for network "${network}" in ${DEPLOYMENTS_DIR}. Run without --skip-deploy first.`
    );
  }
  console.log(`Using deployment file: ${deploymentFile}`);
  const parsed = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const addresses = parsed.deployments || parsed; // support flat legacy deployment-file format too

  const rpcUrl = args.hardhat ? "http://127.0.0.1:8545" : process.env.SEPOLIA_RPC_URL || "";
  const chainId = CHAIN_IDS[network] || Number(process.env.CHAIN_ID || 0);
  const chainName = args.hardhat ? "Localhost" : network;

  writeFrontendEnv({ rpcUrl, chainId, chainName, addresses });

  if (!fs.existsSync(path.join(FRONTEND_DIR, "node_modules"))) {
    console.log("\nfrontend/node_modules not found, running `npm install`...");
    run("npm", ["install"], { cwd: FRONTEND_DIR });
  }

  console.log("\nStarting frontend dev server...");
  const frontend = spawn("npm", ["run", "dev"], {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(frontend);
  frontend.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
