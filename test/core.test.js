const { expect } = require("chai");
const { ethers } = require("hardhat");

const amount = (value, decimals = 18) => ethers.parseUnits(value.toString(), decimals);

async function deployContract(name, ...args) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

describe("Protocol contracts", function () {
  describe("TRUSTERC20Token", function () {
    it("allows only the vault to mint and supports burning", async function () {
      const [owner, vault, alice] = await ethers.getSigners();
      const trust = await deployContract("TRUSTERC20Token");

      await expect(trust.connect(alice).mint(alice.address, amount(1)))
        .to.be.revertedWith("VaultOwned: caller is not the Vault");

      await trust.setVault(vault.address);
      await trust.connect(vault).mint(alice.address, amount(10));
      expect(await trust.balanceOf(alice.address)).to.equal(amount(10));

      await trust.connect(alice).burn(amount(4));
      expect(await trust.balanceOf(alice.address)).to.equal(amount(6));
      expect(await trust.totalSupply()).to.equal(amount(6));
      expect(await trust.owner()).to.equal(owner.address);
    });
  });

  describe("TrustTreasury", function () {
    it("accepts an approved reserve depositor and mints TRUST", async function () {
      const [owner, depositor] = await ethers.getSigners();
      const trust = await deployContract("TRUSTERC20Token");
      const reserve = await deployContract("MockReserveToken", amount(1_000_000));
      const treasury = await deployContract(
        "TrustTreasury",
        trust.target,
        reserve.target,
        0,
        amount(1_000_000_000)
      );

      await trust.setVault(treasury.target);
      await treasury.queue(0, depositor.address);
      await treasury.toggle(0, depositor.address, ethers.ZeroAddress);
      await reserve.transfer(depositor.address, amount(100));
      await reserve.connect(depositor).approve(treasury.target, amount(100));

      await expect(treasury.connect(depositor).deposit(amount(100), reserve.target, 0))
        .to.emit(treasury, "Deposit")
        .withArgs(reserve.target, amount(100), amount(100));

      expect(await trust.balanceOf(depositor.address)).to.equal(amount(100));
      expect(await treasury.totalReserves()).to.equal(amount(100));
      expect(await treasury.isReserveDepositor(depositor.address)).to.equal(true);
      expect(await treasury.owner()).to.equal(owner.address);
    });

    it("rejects deposits from unapproved accounts", async function () {
      const [, alice] = await ethers.getSigners();
      const trust = await deployContract("TRUSTERC20Token");
      const reserve = await deployContract("MockReserveToken", amount(100));
      const treasury = await deployContract("TrustTreasury", trust.target, reserve.target, 0, amount(1_000));

      await reserve.transfer(alice.address, amount(10));
      await reserve.connect(alice).approve(treasury.target, amount(10));

      await expect(treasury.connect(alice).deposit(amount(10), reserve.target, 0))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("PROMries and wMEMO", function () {
    it("initializes once and wraps and unwraps MEMO at the configured index", async function () {
      const [alice] = await ethers.getSigners();
      const memo = await deployContract("PROMries");

      await memo.initialize(alice.address);
      await memo.setIndex(amount("1", 9));
      const initialBalance = await memo.balanceOf(alice.address);
      const wrapped = await deployContract("wMEMO", memo.target);
      const wrapAmount = amount("100", 9);
      const wrappedAmount = amount("100");

      await memo.connect(alice).approve(wrapped.target, wrapAmount);
      await expect(wrapped.connect(alice).wrap(wrapAmount))
        .to.emit(wrapped, "Wrap")
        .withArgs(alice.address, wrapAmount, wrappedAmount);
      expect(await wrapped.balanceOf(alice.address)).to.equal(wrappedAmount);

      await expect(wrapped.connect(alice).unwrap(wrappedAmount))
        .to.emit(wrapped, "UnWrap")
        .withArgs(alice.address, wrappedAmount, wrapAmount);
      expect(await wrapped.balanceOf(alice.address)).to.equal(0);
      expect(await memo.balanceOf(alice.address)).to.equal(initialBalance);

      await expect(memo.initialize(alice.address)).to.be.revertedWith("NA");
    });
  });

  describe("TrustStaking", function () {
    it("configures distributor and warmup only once", async function () {
      const [owner, distributor, warmup] = await ethers.getSigners();
      const trust = await deployContract("TRUSTERC20Token");
      const memo = await deployContract("PROMries");
      const staking = await deployContract(
        "TrustStaking",
        trust.target,
        memo.target,
        3600,
        1,
        Math.floor(Date.now() / 1000) + 3600
      );

      await memo.initialize(staking.target);
      await staking.setContract(0, distributor.address);
      await staking.setContract(1, warmup.address);
      await staking.setWarmup(2);

      expect(await staking.distributor()).to.equal(distributor.address);
      expect(await staking.warmupContract()).to.equal(warmup.address);
      expect(await staking.warmupPeriod()).to.equal(2);
      expect(await staking.owner()).to.equal(owner.address);

      await expect(staking.setContract(1, owner.address))
        .to.be.revertedWith("Warmup cannot be set more than once");
    });
  });

  describe("MultiRewards", function () {
    it("accrues and pays rewards to stakers", async function () {
      const [owner, alice] = await ethers.getSigners();
      const stakingToken = await deployContract("MockReserveToken", amount(1_000));
      const rewardsToken = await deployContract("MockReserveToken", amount(1_000));
      const rewards = await deployContract("MultiRewards", owner.address, stakingToken.target);
      const duration = 100;
      const stakeAmount = amount(100);
      const rewardAmount = amount(200);

      await rewards.addReward(rewardsToken.target, owner.address, duration);
      await stakingToken.transfer(alice.address, stakeAmount);
      await stakingToken.connect(alice).approve(rewards.target, stakeAmount);
      await rewards.connect(alice).stake(stakeAmount);

      await rewardsToken.approve(rewards.target, rewardAmount);
      await rewards.notifyRewardAmount(rewardsToken.target, rewardAmount);
      await ethers.provider.send("evm_increaseTime", [50]);
      await ethers.provider.send("evm_mine");

      expect(await rewards.earned(alice.address, rewardsToken.target)).to.be.gt(0);
      const before = await rewardsToken.balanceOf(alice.address);
      await rewards.connect(alice).getReward();
      expect(await rewardsToken.balanceOf(alice.address)).to.be.gt(before);

      await rewards.connect(alice).withdraw(stakeAmount);
      expect(await rewards.balanceOf(alice.address)).to.equal(0);
      expect(await stakingToken.balanceOf(alice.address)).to.equal(stakeAmount);
    });
  });
});
