const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const parse = (value, decimals = 18) => ethers.parseUnits(value.toString(), decimals);

async function deploy(name, ...args) {
  const contract = await (await ethers.getContractFactory(name)).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

describe("Full protocol deployment wiring", function () {
  it("deploys every component and connects the protocol end to end", async function () {
    const [deployer, dao] = await ethers.getSigners();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochLength = 3600;

    const reserve = await deploy("MockReserveToken", parse("1000000"));
    const trust = await deploy("TRUSTERC20Token");
    const memo = await deploy("PROMries");
    const treasury = await deploy(
      "TrustTreasury",
      trust.target,
      reserve.target,
      0,
      parse("1000000000")
    );
    const staking = await deploy(
      "TrustStaking",
      trust.target,
      memo.target,
      epochLength,
      1,
      now + epochLength
    );
    const distributor = await deploy(
      "Distributor",
      treasury.target,
      trust.target,
      epochLength,
      now + epochLength
    );
    const warmup = await deploy("StakingWarmup", staking.target, memo.target);
    const helper = await deploy("StakingHelper", staking.target, trust.target);
    const calculator = await deploy("TimeBondingCalculator", trust.target);
    const bond = await deploy(
      "contracts/BondDepository.sol:TimeBondDepository",
      trust.target,
      reserve.target,
      treasury.target,
      dao.address,
      ethers.ZeroAddress
    );
    const wmemo = await deploy("wMEMO", memo.target);
    const multiRewards = await deploy("MultiRewards", dao.address, wmemo.target);
    const redemption = await deploy(
      "MemoExchange",
      ethers.ZeroHash,
      treasury.target,
      now + 30 * 24 * 60 * 60
    );
    const zapIn = await deploy("Wonderland_ZapIn_V1", dao.address);

    // Core token and staking wiring.
    await trust.setVault(treasury.target);
    await memo.initialize(staking.target);
    await staking.setContract(0, distributor.target);
    await staking.setContract(1, warmup.target);
    await staking.setWarmup(0);

    // Treasury permissions used by the distributor and bond depository.
    await treasury.queue(8, distributor.target);
    await treasury.toggle(8, distributor.target, ethers.ZeroAddress);
    await treasury.queue(0, bond.target);
    await treasury.toggle(0, bond.target, ethers.ZeroAddress);

    // Seed TRUST supply so the bond pricing debt-ratio calculation is valid.
    await treasury.queue(0, deployer.address);
    await treasury.toggle(0, deployer.address, ethers.ZeroAddress);
    const seed = parse("1000");
    await reserve.approve(treasury.target, seed);
    await treasury.deposit(seed, reserve.target, 0);

    await bond.initializeBondTerms(
      300,
      200,
      500,
      1000,
      parse("1000000000000", 9),
      5 * 24 * 60 * 60
    );
    await bond.setStaking(helper.target, true);

    expect(await trust.vault()).to.equal(treasury.target);
    expect(await memo.stakingContract()).to.equal(staking.target);
    expect(await staking.distributor()).to.equal(distributor.target);
    expect(await staking.warmupContract()).to.equal(warmup.target);
    expect(await staking.warmupPeriod()).to.equal(0);
    expect(await treasury.isRewardManager(distributor.target)).to.equal(true);
    expect(await treasury.isReserveDepositor(bond.target)).to.equal(true);
    expect(await treasury.totalReserves()).to.equal(seed);
    expect(await trust.totalSupply()).to.equal(seed);
    expect(await bond.treasury()).to.equal(treasury.target);
    expect(await bond.DAO()).to.equal(dao.address);
    expect(await bond.stakingHelper()).to.equal(helper.target);
    expect(await bond.useHelper()).to.equal(true);
    expect((await bond.terms()).vestingTerm).to.equal(5 * 24 * 60 * 60);

    // Exercise the bond entry points against the fully wired protocol.
    const bondDeposit = parse("1");
    const maxPrice = await bond.bondPrice();
    await reserve.approve(bond.target, bondDeposit);
    const expectedPayout = await bond.deposit.staticCall(
      bondDeposit,
      maxPrice,
      deployer.address
    );
    await expect(bond.deposit(bondDeposit, maxPrice, deployer.address))
      .to.emit(bond, "BondCreated")
      .withArgs(
        bondDeposit,
        expectedPayout,
        anyValue,
        anyValue
      );
    expect((await bond.bondInfo(deployer.address)).payout).to.equal(expectedPayout);

    await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine");
    const trustBeforeRedeem = await trust.balanceOf(deployer.address);
    await expect(bond.redeem(deployer.address, false))
      .to.emit(bond, "BondRedeemed")
      .withArgs(deployer.address, expectedPayout, 0);
    expect(await trust.balanceOf(deployer.address)).to.equal(trustBeforeRedeem + expectedPayout);
    expect((await bond.bondInfo(deployer.address)).payout).to.equal(0);

    // Every deployment in deployAllAndVerify.js produced bytecode and is reachable.
    for (const contract of [
      reserve,
      trust,
      memo,
      treasury,
      staking,
      distributor,
      warmup,
      helper,
      calculator,
      bond,
      wmemo,
      multiRewards,
      redemption,
      zapIn
    ]) {
      expect(await ethers.provider.getCode(contract.target)).to.not.equal("0x");
    }
  });
});
