require("dotenv").config();

const { ethers, network, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Full protocol deployment script with:
 *   1. Deployment of every contract (same set/order as scripts/deployAll.js)
 *   2. Wiring so bonding + staking actually work end to end
 *   3. Etherscan/Sourcify verification of every deployed contract
 *   4. A post-wiring dry-run of BondDepository.deposit() to prove the whole
 *      pipeline is actually functional before the script reports success.
 *
 * This fixes two issues found while proving the flow out in
 * test/deployAll.e2e.test.js:
 *   - MAX_DEBT must be expressed in TRUST's decimals (18), not 9. The old
 *     default (`parseUnits("1000000000", 9)`) is ~1e9x too small and makes
 *     the very first bond revert with "Max capacity reached".
 *   - contracts/BondDepository.sol's ITreasury.deposit() interface / balance
 *     check bugs (return type bool -> uint, and comparing against `profit`
 *     instead of `payout`) must already be fixed in the contract - this
 *     script's dry run will fail loudly if they are not.
 *
 * Configuration (all optional, via environment variables):
 *   DAO_ADDRESS      - receives bond profit share / becomes contract owner. Defaults to deployer.
 *   RESERVE_TOKEN    - existing ERC20 address to use as reserve/principle asset.
 *                      If unset, a MockReserveToken is deployed and minted to the deployer,
 *                      the treasury is auto-seeded, and a smoke-test deposit is dry-run.
 *   EPOCH_LENGTH     - staking epoch length in seconds (default 28800 = 8h)
 *   FIRST_EPOCH_TIME - unix timestamp of the first epoch end (default: now + EPOCH_LENGTH)
 *   MAX_DEBT         - max outstanding bond debt, in whole TRUST tokens (default 1,000,000,000)
 *   SKIP_OWNERSHIP_TRANSFER - if "true", do not transfer contract ownership to DAO_ADDRESS
 *   SKIP_VERIFY      - if "true", skip the Etherscan/Sourcify verification pass
 *   VERIFY_CONFIRMATIONS - block confirmations to wait before verifying (default 5, ignored on local networks)
 */

const isLocalNetwork = (name) => name === "hardhat" || name === "localhost";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Deploying with account: ${deployer.address}`);
  console.log(`Network: ${network.name} (chainId ${net.chainId})`);

  const DAO_ADDRESS = process.env.DAO_ADDRESS && ethers.isAddress(process.env.DAO_ADDRESS)
    ? process.env.DAO_ADDRESS
    : deployer.address;

  const EPOCH_LENGTH = Number(process.env.EPOCH_LENGTH || 28800); // 8 hours
  const FIRST_EPOCH_NUMBER = 1;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const FIRST_EPOCH_TIME = Number(process.env.FIRST_EPOCH_TIME || nowSeconds + EPOCH_LENGTH);
  const SECONDS_NEEDED_FOR_QUEUE = 0; // no timelock delay for this deployment
  const TREASURY_LIMIT_AMOUNT = ethers.parseUnits("1000000000", 18);
  const VERIFY_CONFIRMATIONS = Number(process.env.VERIFY_CONFIRMATIONS || 5);
  const shouldVerify = process.env.SKIP_VERIFY !== "true" && !isLocalNetwork(network.name);

  const deployments = {};
  const verifyQueue = []; // { name, address, contract (fully qualified path), constructorArguments }

  const record = (name, contract) => {
    deployments[name] = contract.target ?? contract.address;
  };

  const waitConfirmations = async (contract) => {
    if (isLocalNetwork(network.name)) return;
    const deployTx = contract.deploymentTransaction();
    if (deployTx) {
      await deployTx.wait(VERIFY_CONFIRMATIONS);
    }
  };

  const deployContract = async (label, factoryName, args, { contractPath } = {}) => {
    console.log(`\nDeploying ${label}...`);
    const Factory = await ethers.getContractFactory(factoryName);
    const contract = await Factory.deploy(...args);
    await contract.waitForDeployment();
    record(label, contract);
    console.log(`${label} deployed to: ${contract.target}`);
    await waitConfirmations(contract);
    verifyQueue.push({
      name: label,
      address: contract.target,
      contract: contractPath,
      constructorArguments: args,
    });
    return contract;
  };

  // ---------------------------------------------------------------------
  // 1. Reserve / principle token
  // ---------------------------------------------------------------------
  let reserveTokenAddress = process.env.RESERVE_TOKEN;
  let usingMockReserve = false;
  if (reserveTokenAddress && ethers.isAddress(reserveTokenAddress)) {
    console.log(`\nUsing existing reserve token: ${reserveTokenAddress}`);
  } else {
    usingMockReserve = true;
    const mockReserve = await deployContract(
      "MockReserveToken",
      "MockReserveToken",
      [ethers.parseUnits("1000000", 18)],
      { contract: "contracts/mocks/MockReserveToken.sol:MockReserveToken" }
    );
    reserveTokenAddress = mockReserve.target;
  }

  // ---------------------------------------------------------------------
  // 2. TRUST token
  // ---------------------------------------------------------------------
  const trust = await deployContract("TRUST", "TRUSTERC20Token", [], {
    contract: "contracts/TRUSTERC20.sol:TRUSTERC20Token",
  });

  // ---------------------------------------------------------------------
  // 3. PROMries (MEMO staking token)
  // ---------------------------------------------------------------------
  const memo = await deployContract("MEMO", "PROMries", [], {
    contract: "contracts/PromisesERC20.sol:PROMries",
  });

  // ---------------------------------------------------------------------
  // 4. Treasury
  // ---------------------------------------------------------------------
  const treasury = await deployContract(
    "Treasury",
    "TrustTreasury",
    [trust.target, reserveTokenAddress, SECONDS_NEEDED_FOR_QUEUE, TREASURY_LIMIT_AMOUNT],
    { contract: "contracts/Treasury.sol:TrustTreasury" }
  );

  // ---------------------------------------------------------------------
  // 5. Staking
  // ---------------------------------------------------------------------
  const staking = await deployContract(
    "Staking",
    "TrustStaking",
    [trust.target, memo.target, EPOCH_LENGTH, FIRST_EPOCH_NUMBER, FIRST_EPOCH_TIME],
    { contract: "contracts/Staking.sol:TrustStaking" }
  );

  // ---------------------------------------------------------------------
  // 6. Distributor
  // ---------------------------------------------------------------------
  const distributor = await deployContract(
    "Distributor",
    "Distributor",
    [treasury.target, trust.target, EPOCH_LENGTH, FIRST_EPOCH_TIME],
    { contract: "contracts/StakingDistributor.sol:Distributor" }
  );

  // ---------------------------------------------------------------------
  // 7. Staking warmup
  // ---------------------------------------------------------------------
  const warmup = await deployContract(
    "StakingWarmup",
    "StakingWarmup",
    [staking.target, memo.target],
    { contract: "contracts/StakingWarmup.sol:StakingWarmup" }
  );

  // ---------------------------------------------------------------------
  // 8. Staking helper
  // ---------------------------------------------------------------------
  const helper = await deployContract(
    "StakingHelper",
    "StakingHelper",
    [staking.target, trust.target],
    { contract: "contracts/StakingHelper.sol:StakingHelper" }
  );

  // ---------------------------------------------------------------------
  // 9. Bonding calculator (for future LP bonds; not wired to the reserve bond)
  // ---------------------------------------------------------------------
  const calculator = await deployContract(
    "BondingCalculator",
    "TimeBondingCalculator",
    [trust.target],
    { contract: "contracts/StandardBondingCalculator.sol:TimeBondingCalculator" }
  );

  // ---------------------------------------------------------------------
  // 10. Bond depository (reserve-token bond, bondCalculator = 0x0 => not an LP bond)
  // ---------------------------------------------------------------------
  const bondArgs = [trust.target, reserveTokenAddress, treasury.target, DAO_ADDRESS, ethers.ZeroAddress];
  console.log("\nDeploying TimeBondDepository...");
  const BondDepository = await ethers.getContractFactory(
    "contracts/BondDepository.sol:TimeBondDepository"
  );
  const bondDepository = await BondDepository.deploy(...bondArgs);
  await bondDepository.waitForDeployment();
  record("BondDepository", bondDepository);
  console.log(`TimeBondDepository deployed to: ${bondDepository.target}`);
  await waitConfirmations(bondDepository);
  verifyQueue.push({
    name: "BondDepository",
    address: bondDepository.target,
    contract: "contracts/BondDepository.sol:TimeBondDepository",
    constructorArguments: bondArgs,
  });

  // ---------------------------------------------------------------------
  // 11. wMEMO
  // ---------------------------------------------------------------------
  const wmemo = await deployContract("wMEMO", "wMEMO", [memo.target], {
    contract: "contracts/wMEMO.sol:wMEMO",
  });

  // ---------------------------------------------------------------------
  // 12. MultiRewards (generic staking-rewards contract, staking token = wMEMO)
  // ---------------------------------------------------------------------
  const multiRewards = await deployContract(
    "MultiRewards",
    "MultiRewards",
    [DAO_ADDRESS, wmemo.target],
    { contract: "contracts/MultiReward.sol:MultiRewards" }
  );

  // ---------------------------------------------------------------------
  // 13. MemoExchange (Redemption.sol) - non-functional here, see WARNING below
  // ---------------------------------------------------------------------
  const redemptionDeadline = Number(process.env.REDEMPTION_DEADLINE || nowSeconds + 30 * 24 * 60 * 60);
  const memoExchangeArgs = [
    process.env.REDEMPTION_MERKLE_ROOT || ethers.ZeroHash,
    treasury.target,
    redemptionDeadline,
  ];
  const memoExchange = await deployContract("MemoExchange", "MemoExchange", memoExchangeArgs, {
    contract: "contracts/Redemption.sol:MemoExchange",
  });
  console.log("  WARNING: MemoExchange references hardcoded WMEMO/USDC/BSGG constants from a different deployment; not functional here.");

  // ---------------------------------------------------------------------
  // 14. Wonderland_ZapIn_V1 (WonderZapIn.sol) - non-functional here, see WARNING below
  // ---------------------------------------------------------------------
  const zapIn = await deployContract("WonderZapIn", "Wonderland_ZapIn_V1", [DAO_ADDRESS], {
    contract: "contracts/WonderZapIn.sol:Wonderland_ZapIn_V1",
  });
  console.log("  WARNING: WonderZapIn hardcodes Trader Joe (Avalanche) router/factory addresses; not functional on this network.");

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------
  console.log("\nWiring core protocol together...");

  await (await trust.setVault(treasury.target)).wait();
  console.log("  TRUST.setVault(treasury) done");

  await (await memo.initialize(staking.target)).wait();
  console.log("  MEMO.initialize(staking) done");

  const CONTRACTS_DISTRIBUTOR = 0;
  const CONTRACTS_WARMUP = 1;
  await (await staking.setContract(CONTRACTS_DISTRIBUTOR, distributor.target)).wait();
  await (await staking.setContract(CONTRACTS_WARMUP, warmup.target)).wait();
  console.log("  Staking.setContract(DISTRIBUTOR/WARMUP) done");

  await (await staking.setWarmup(0)).wait();
  console.log("  Staking.setWarmup(0) done");

  const MANAGING_RESERVEDEPOSITOR = 0;
  const MANAGING_REWARDMANAGER = 8;

  await (await treasury.queue(MANAGING_REWARDMANAGER, distributor.target)).wait();
  await (await treasury.toggle(MANAGING_REWARDMANAGER, distributor.target, ethers.ZeroAddress)).wait();
  console.log("  Treasury reward manager set to Distributor");

  await (await treasury.queue(MANAGING_RESERVEDEPOSITOR, bondDepository.target)).wait();
  await (await treasury.toggle(MANAGING_RESERVEDEPOSITOR, bondDepository.target, ethers.ZeroAddress)).wait();
  console.log("  Treasury reserve depositor set to BondDepository");

  // Bonds price against Time.totalSupply() (debtRatio = debt / supply), so a
  // freshly deployed TRUST (supply 0) makes every bond revert with a
  // division-by-zero. Seed a small initial TRUST supply by depositing reserve
  // tokens directly into the Treasury before anyone can bond.
  let seedAmount = 0n;
  if (usingMockReserve) {
    console.log("\nSeeding initial TRUST supply so bonding math (debtRatio) doesn't divide by zero...");
    await (await treasury.queue(MANAGING_RESERVEDEPOSITOR, deployer.address)).wait();
    await (await treasury.toggle(MANAGING_RESERVEDEPOSITOR, deployer.address, ethers.ZeroAddress)).wait();
    const mockReserve = await ethers.getContractAt("MockReserveToken", reserveTokenAddress);
    seedAmount = ethers.parseUnits("1000", 18);
    await (await mockReserve.approve(treasury.target, seedAmount)).wait();
    await (await treasury.deposit(seedAmount, reserveTokenAddress, 0)).wait();
    console.log(`  Seeded treasury with ${ethers.formatUnits(seedAmount, 18)} reserve tokens, minted equivalent TRUST to deployer`);
  } else {
    console.log("\nSkipping automatic TRUST supply seeding because an existing RESERVE_TOKEN was provided.");
    console.log("  NOTE: bonds will revert with 'division by zero' until Time.totalSupply() > 0.");
    console.log("  Make the deployer (or another address) a RESERVEDEPOSITOR and call treasury.deposit(...) to seed supply,");
    console.log("  or mint an initial TRUST amount directly, before enabling public bonding.");
  }

  // Conservative default bond terms; adjust to your economics before real use.
  // NOTE: MAX_DEBT is expressed in TRUST's own decimals (18), matching the
  // units `totalDebt`/`value` are actually tracked in - NOT the 9-decimal
  // convention some Olympus forks use for a 9-decimal reward token. Getting
  // this wrong makes the very first bond revert with "Max capacity reached".
  // NOTE: MIN_PRICE must be kept above 100 (parity). At zero debt,
  // _bondPrice() == 100 exactly, which makes payoutFor(value) == value with
  // no room left to carve the DAO fee out of `profit` - the very first bond
  // then underflows in `profit = value.sub(payout).sub(fee)`. A floor above
  // parity guarantees payout < value even before any debt has accrued.
  const BCV = 300;
  const MIN_PRICE = Number(process.env.MIN_PRICE || 200);
  const MAX_PAYOUT = 500; // 0.5%
  const FEE = 1000; // 10%
  const MAX_DEBT = ethers.parseUnits(process.env.MAX_DEBT || "1000000000", 18);
  const VESTING_TERM = 5 * 24 * 60 * 60; // 5 days (> required 36h minimum)
  await (await bondDepository.initializeBondTerms(BCV, MIN_PRICE, MAX_PAYOUT, FEE, MAX_DEBT, VESTING_TERM)).wait();
  console.log("  BondDepository.initializeBondTerms done");

  await (await bondDepository.setStaking(helper.target, true)).wait();
  console.log("  BondDepository.setStaking(helper, true) done");

  // ---------------------------------------------------------------------
  // Smoke test: prove deposit() actually works before declaring success.
  // Only runs when we control the reserve token (MockReserveToken path),
  // since it requires spending reserve tokens; uses a static call so no
  // state is mutated and no gas/tokens are spent for a real bond.
  // ---------------------------------------------------------------------
  if (usingMockReserve && seedAmount > 0n) {
    console.log("\nDry-running BondDepository.deposit() to confirm the setup actually works...");
    const mockReserve = await ethers.getContractAt("MockReserveToken", reserveTokenAddress);

    // Keep the test deposit small relative to the seeded supply so it stays
    // comfortably under maxPayout() (0.5% of Time.totalSupply()) with margin
    // for bondPrice()/debtRatio() rounding.
    const testDepositAmount = seedAmount / 1000n; // 0.1% of seed amount
    await (await mockReserve.approve(bondDepository.target, testDepositAmount)).wait();

    try {
      const expectedPayout = await bondDepository.deposit.staticCall(
        testDepositAmount,
        ethers.parseUnits("1000000", 9), // max price willing to pay (very permissive)
        deployer.address
      );
      console.log(
        `  Dry run succeeded: depositing ${ethers.formatUnits(testDepositAmount, 18)} reserve tokens ` +
          `would payout ~${ethers.formatUnits(expectedPayout, 18)} TRUST (vesting).`
      );
    } catch (err) {
      throw new Error(
        `Post-deploy smoke test failed: BondDepository.deposit() would revert (${err.message}). ` +
          "The deployment is wired but bonding will not work - check bond terms / treasury permissions."
      );
    }
  }

  if (process.env.SKIP_OWNERSHIP_TRANSFER !== "true" && DAO_ADDRESS.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\nTransferring ownership of owned contracts to DAO_ADDRESS (${DAO_ADDRESS})...`);
    await (await treasury.transferOwnership(DAO_ADDRESS)).wait();
    await (await staking.transferOwnership(DAO_ADDRESS)).wait();
    await (await distributor.transferOwnership(DAO_ADDRESS)).wait();
    await (await bondDepository.transferOwnership(DAO_ADDRESS)).wait();
    await (await memo.transferOwnership(DAO_ADDRESS)).wait();
    await (await trust.transferOwnership(DAO_ADDRESS)).wait();
    console.log("  Ownership transfers done");
  }

  console.log("\n===== Deployment summary =====");
  console.table(deployments);

  // ---------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------
  const verification = {};
  if (!shouldVerify) {
    console.log(
      isLocalNetwork(network.name)
        ? "\nSkipping verification: local network has no block explorer."
        : "\nSkipping verification: SKIP_VERIFY=true."
    );
  } else if (!process.env.ETHERSCAN_API_KEY) {
    console.log("\nSkipping verification: ETHERSCAN_API_KEY is not set.");
  } else {
    console.log(`\nVerifying ${verifyQueue.length} contracts on ${network.name}...`);
    for (const entry of verifyQueue) {
      try {
        await run("verify:verify", {
          address: entry.address,
          constructorArguments: entry.constructorArguments,
          contract: entry.contract,
        });
        verification[entry.name] = "verified";
        console.log(`  ${entry.name} (${entry.address}): verified`);
      } catch (err) {
        const message = err.message || String(err);
        if (/already verified/i.test(message)) {
          verification[entry.name] = "already-verified";
          console.log(`  ${entry.name} (${entry.address}): already verified`);
        } else {
          verification[entry.name] = `failed: ${message}`;
          console.log(`  ${entry.name} (${entry.address}): verification failed - ${message}`);
        }
      }
    }
  }

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}-${Date.now()}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ deployments, verification }, null, 2)
  );
  console.log(`\nAddresses + verification status written to: ${outFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
