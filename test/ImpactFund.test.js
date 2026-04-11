const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ImpactFund — Full Contract Suite (v2: Bootstrap + Quorum + AI)", function () {
  let donorNFT, factory;
  let deployer, ngo, donor1, donor2, donor3, backendSigner;

  // Common campaign parameters
  const TITLE = "Build 3 Wells";
  const DESCRIPTION = "Provide clean water to 3 villages in Rajasthan";
  const NGO_NAME = "WaterAid India";
  const GOAL = ethers.parseEther("1.0");
  const BOOTSTRAP_PERCENT = 5; // 5%
  let DEADLINE;

  // Milestones: percentages are % of post-bootstrap (must sum to 100)
  function milestoneInputs(deadlineBase) {
    return [
      { title: "Site Survey", description: "Survey all 3 sites", fundPercent: 30, deadline: deadlineBase + 86400 },
      { title: "Excavation", description: "Dig wells at all 3 sites", fundPercent: 40, deadline: deadlineBase + 172800 },
      { title: "Completion", description: "Install pumps and test flow", fundPercent: 30, deadline: deadlineBase + 259200 },
    ];
  }

  beforeEach(async function () {
    [deployer, ngo, donor1, donor2, donor3, backendSigner] = await ethers.getSigners();

    const block = await ethers.provider.getBlock("latest");
    DEADLINE = block.timestamp + 604800; // 1 week from now

    // Deploy DonorNFT
    const DonorNFT = await ethers.getContractFactory("DonorNFT");
    donorNFT = await DonorNFT.deploy();
    await donorNFT.waitForDeployment();

    // Deploy Factory (pass DonorNFT address + backend signer)
    const Factory = await ethers.getContractFactory("ImpactFundFactory");
    factory = await Factory.deploy(await donorNFT.getAddress(), backendSigner.address);
    await factory.waitForDeployment();

    // Transfer DonorNFT ownership to factory
    await donorNFT.transferOwnership(await factory.getAddress());
  });

  // ════════════════════════════════════════════
  //  DonorNFT
  // ════════════════════════════════════════════

  describe("DonorNFT", function () {
    it("should deploy with correct name and symbol", async function () {
      expect(await donorNFT.name()).to.equal("ImpactFund Donor");
      expect(await donorNFT.symbol()).to.equal("IMPD");
    });

    it("should support ERC-5192 interface", async function () {
      expect(await donorNFT.supportsInterface("0xb45a3c0e")).to.be.true;
    });

    it("should reject unauthorized minters", async function () {
      await expect(
        donorNFT.connect(donor1).mint(donor1.address, deployer.address, ethers.parseEther("0.1"))
      ).to.be.revertedWith("DonorNFT: not authorized");
    });
  });

  // ════════════════════════════════════════════
  //  Factory
  // ════════════════════════════════════════════

  describe("ImpactFundFactory", function () {
    it("should create a campaign and register it", async function () {
      const milestones = milestoneInputs(DEADLINE);
      await factory.connect(ngo).createCampaign(
        TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, milestones, GOAL, DEADLINE
      );

      const allCampaigns = await factory.getAllCampaigns();
      expect(allCampaigns.length).to.equal(1);

      const ngoCampaigns = await factory.getCampaignsByNGO(ngo.address);
      expect(ngoCampaigns.length).to.equal(1);
    });

    it("should emit CampaignCreated event", async function () {
      const milestones = milestoneInputs(DEADLINE);
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, milestones, GOAL, DEADLINE)
      ).to.emit(factory, "CampaignCreated");
    });

    it("should reject milestones not summing to 100", async function () {
      const badMilestones = [
        { title: "A", description: "a", fundPercent: 50, deadline: DEADLINE + 86400 },
        { title: "B", description: "b", fundPercent: 30, deadline: DEADLINE + 172800 },
      ];
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, badMilestones, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: milestone percentages must sum to 100");
    });

    it("should reject fewer than 2 milestones", async function () {
      const oneMilestone = [
        { title: "A", description: "a", fundPercent: 100, deadline: DEADLINE + 86400 },
      ];
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, oneMilestone, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: 2-5 milestones required");
    });

    it("should reject more than 5 milestones", async function () {
      const tooMany = Array(6).fill(null).map((_, i) => ({
        title: `M${i}`, description: `d${i}`,
        fundPercent: i < 5 ? 16 : 20,
        deadline: DEADLINE + 86400 * (i + 1),
      }));
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, tooMany, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: 2-5 milestones required");
    });

    it("should reject bootstrap below 1% or above 15%", async function () {
      const milestones = milestoneInputs(DEADLINE);
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, 0, milestones, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: bootstrap must be 1-15%");
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, 16, milestones, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: bootstrap must be 1-15%");
    });
  });

  // ════════════════════════════════════════════
  //  Campaign
  // ════════════════════════════════════════════

  describe("ImpactFundCampaign", function () {
    let campaign;

    beforeEach(async function () {
      const milestones = milestoneInputs(DEADLINE);
      await factory.connect(ngo).createCampaign(
        TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, milestones, GOAL, DEADLINE
      );
      const allCampaigns = await factory.getAllCampaigns();
      campaign = await ethers.getContractAt("ImpactFundCampaign", allCampaigns[0]);
    });

    // ── Initial State ──

    describe("Initial State", function () {
      it("should have correct campaign info", async function () {
        const info = await campaign.getCampaign();
        expect(info.ngoAddress).to.equal(ngo.address);
        expect(info.title).to.equal(TITLE);
        expect(info.ngoName).to.equal(NGO_NAME);
        expect(info.goalAmount).to.equal(GOAL);
        expect(info.raisedAmount).to.equal(0);
        expect(info.bootstrapPercent).to.equal(BOOTSTRAP_PERCENT);
        expect(info.status).to.equal(0); // Fundraising
      });

      it("should have milestone 0 as bootstrap grant + 3 user milestones = 4 total", async function () {
        expect(await campaign.getMilestoneCount()).to.equal(4);
        const m0 = await campaign.getMilestone(0);
        expect(m0.title).to.equal("Initial Operating Grant");
        expect(m0.fundPercent).to.equal(BOOTSTRAP_PERCENT);
      });

      it("should have correct fund percentages (converted from post-bootstrap)", async function () {
        // User milestones: 30%, 40%, 30% of post-bootstrap (95%)
        // Actual: 30*95/100=28.5→28, 40*95/100=38, 30*95/100=28.5→28
        // Total: bootstrap(5) + 28 + 38 + 28 = 99 (1% rounding loss, acceptable)
        const all = await campaign.getAllMilestones();
        expect(all[0].fundPercent).to.equal(5);  // bootstrap
        // Due to integer division: 30*95/100 = 28, 40*95/100 = 38, 30*95/100 = 28
        expect(all[1].fundPercent).to.equal(28);
        expect(all[2].fundPercent).to.equal(38);
        expect(all[3].fundPercent).to.equal(28);
      });
    });

    // ── Donations ──

    describe("Donations", function () {
      it("should accept ETH donations", async function () {
        await expect(
          campaign.connect(donor1).donate({ value: ethers.parseEther("0.1") })
        ).to.emit(campaign, "DonationReceived")
          .withArgs(donor1.address, ethers.parseEther("0.1"));

        expect(await campaign.donations(donor1.address)).to.equal(ethers.parseEther("0.1"));
        expect(await campaign.raisedAmount()).to.equal(ethers.parseEther("0.1"));
      });

      it("should mint DonorNFT on first donation", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.1") });
        expect(await donorNFT.balanceOf(donor1.address)).to.equal(1);
      });

      it("should NOT mint second NFT on re-donation (one per donor per campaign)", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.1") });
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.2") });
        // Still only 1 NFT
        expect(await donorNFT.balanceOf(donor1.address)).to.equal(1);
        // But amount is updated
        const tokenData = await donorNFT.tokenData(0);
        expect(tokenData.amountDonated).to.equal(ethers.parseEther("0.3"));
      });

      it("should make DonorNFT soulbound (non-transferable)", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.1") });
        await expect(
          donorNFT.connect(donor1).transferFrom(donor1.address, donor2.address, 0)
        ).to.be.revertedWith("Soulbound: non-transferable");
      });

      it("should report token as locked (ERC-5192)", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.1") });
        expect(await donorNFT.locked(0)).to.be.true;
      });

      it("should reject 0 value donations", async function () {
        await expect(
          campaign.connect(donor1).donate({ value: 0 })
        ).to.be.revertedWith("Campaign: donation must be > 0");
      });
    });

    // ── Bootstrap Grant ──

    describe("Bootstrap Grant", function () {
      it("should release bootstrap when goal is exactly met", async function () {
        const ngoBefore = await ethers.provider.getBalance(ngo.address);

        await expect(
          campaign.connect(donor1).donate({ value: GOAL })
        ).to.emit(campaign, "BootstrapReleased")
          .withArgs(ethers.parseEther("0.05")); // 5% of 1 ETH

        const ngoAfter = await ethers.provider.getBalance(ngo.address);
        expect(ngoAfter - ngoBefore).to.equal(ethers.parseEther("0.05"));

        const info = await campaign.getCampaign();
        expect(info.status).to.equal(1); // Active
      });

      it("should release bootstrap when goal is exceeded", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.5") });
        // Not yet at goal
        let info = await campaign.getCampaign();
        expect(info.status).to.equal(0); // Still Fundraising

        await expect(
          campaign.connect(donor2).donate({ value: ethers.parseEther("0.6") })
        ).to.emit(campaign, "BootstrapReleased");

        info = await campaign.getCampaign();
        expect(info.status).to.equal(1); // Now Active
      });

      it("should mark milestone 0 as Approved after bootstrap", async function () {
        await campaign.connect(donor1).donate({ value: GOAL });
        const m0 = await campaign.getMilestone(0);
        expect(m0.status).to.equal(3); // Approved
      });

      it("should NOT release bootstrap twice", async function () {
        await campaign.connect(donor1).donate({ value: GOAL });
        // Campaign is now Active, can't donate more
        await expect(
          campaign.connect(donor2).donate({ value: ethers.parseEther("0.1") })
        ).to.be.revertedWith("Campaign: invalid status for this action");
      });
    });

    // ── Milestone Submission ──

    describe("Milestone Submission", function () {
      beforeEach(async function () {
        await campaign.connect(donor1).donate({ value: GOAL });
      });

      it("should let NGO submit milestone evidence and open voting window", async function () {
        const tx = await campaign.connect(ngo).submitMilestone(1, "QmTestHash123");
        await expect(tx).to.emit(campaign, "MilestoneSubmitted").withArgs(1, "QmTestHash123");
        await expect(tx).to.emit(campaign, "VotingOpened");

        const m = await campaign.getMilestone(1);
        expect(m.status).to.equal(2); // Voting
        expect(m.ipfsHash).to.equal("QmTestHash123");
        expect(m.votingDeadline).to.be.gt(0);
      });

      it("should reject submission of milestone 0 (bootstrap)", async function () {
        await expect(
          campaign.connect(ngo).submitMilestone(0, "QmTestHash123")
        ).to.be.revertedWith("Campaign: cannot submit milestone 0 (bootstrap)");
      });

      it("should reject submission from non-NGO", async function () {
        await expect(
          campaign.connect(donor1).submitMilestone(1, "QmTestHash123")
        ).to.be.revertedWith("Campaign: caller is not the NGO");
      });

      it("should reject empty IPFS hash", async function () {
        await expect(
          campaign.connect(ngo).submitMilestone(1, "")
        ).to.be.revertedWith("Campaign: empty IPFS hash");
      });
    });

    // ── Voting ──

    describe("Voting", function () {
      beforeEach(async function () {
        // Multiple donors fund and activate
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.6") });
        await campaign.connect(donor2).donate({ value: ethers.parseEther("0.4") });
        // Submit milestone 1
        await campaign.connect(ngo).submitMilestone(1, "QmTestHash123");
      });

      it("should let donors vote approve", async function () {
        await expect(
          campaign.connect(donor1).vote(1, true)
        ).to.emit(campaign, "VoteCast")
          .withArgs(donor1.address, 1, true);

        const m = await campaign.getMilestone(1);
        expect(m.votesFor).to.equal(ethers.parseEther("0.6"));
      });

      it("should let donors vote challenge", async function () {
        await campaign.connect(donor2).vote(1, false);
        const m = await campaign.getMilestone(1);
        expect(m.votesAgainst).to.equal(ethers.parseEther("0.4"));
      });

      it("should prevent double voting", async function () {
        await campaign.connect(donor1).vote(1, true);
        await expect(
          campaign.connect(donor1).vote(1, true)
        ).to.be.revertedWith("Campaign: already voted");
      });

      it("should reject votes from non-donors", async function () {
        await expect(
          campaign.connect(donor3).vote(1, true)
        ).to.be.revertedWith("Campaign: caller is not a donor");
      });

      it("should reject votes on milestone 0", async function () {
        await expect(
          campaign.connect(donor1).vote(0, true)
        ).to.be.revertedWith("Campaign: cannot vote on milestone 0");
      });

      it("should reject votes after voting window closes", async function () {
        // Fast-forward past voting deadline (7 days + 1 second)
        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");

        await expect(
          campaign.connect(donor1).vote(1, true)
        ).to.be.revertedWith("Campaign: voting window closed");
      });
    });

    // ── AI Score ──

    describe("AI Score", function () {
      beforeEach(async function () {
        await campaign.connect(donor1).donate({ value: GOAL });
        await campaign.connect(ngo).submitMilestone(1, "QmTestHash123");
      });

      it("should let backend signer set AI score", async function () {
        await campaign.connect(backendSigner).setAIScore(1, 85);
        const m = await campaign.getMilestone(1);
        expect(m.aiScore).to.equal(85);
      });

      it("should reject AI score from non-backend signer", async function () {
        await expect(
          campaign.connect(donor1).setAIScore(1, 85)
        ).to.be.revertedWith("Campaign: caller is not backend signer");
      });

      it("should reject AI score > 100", async function () {
        await expect(
          campaign.connect(backendSigner).setAIScore(1, 101)
        ).to.be.revertedWith("Campaign: score must be 0-100");
      });
    });

    // ── Vote Resolution ──

    describe("Vote Resolution", function () {
      beforeEach(async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.6") });
        await campaign.connect(donor2).donate({ value: ethers.parseEther("0.4") });
        await campaign.connect(ngo).submitMilestone(1, "QmTestHash123");
      });

      it("should reject resolution before voting window closes", async function () {
        await campaign.connect(donor1).vote(1, true);
        await expect(
          campaign.resolveVote(1)
        ).to.be.revertedWith("Campaign: voting still open");
      });

      it("should approve when quorum met and 60%+ approve", async function () {
        // Both donors vote → 100% quorum
        await campaign.connect(donor1).vote(1, true);  // 0.6 ETH approve
        await campaign.connect(donor2).vote(1, true);  // 0.4 ETH approve

        // Fast-forward past voting window
        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");

        const ngoBefore = await ethers.provider.getBalance(ngo.address);

        await expect(campaign.resolveVote(1))
          .to.emit(campaign, "FundsReleased");

        const ngoAfter = await ethers.provider.getBalance(ngo.address);
        // Milestone 1 fundPercent = 30 * 95 / 100 = 28% of 1 ETH = 0.28 ETH
        expect(ngoAfter - ngoBefore).to.equal(ethers.parseEther("0.28"));

        const m = await campaign.getMilestone(1);
        expect(m.status).to.equal(3); // Approved
      });

      it("should reject when quorum met but less than 60% approve", async function () {
        await campaign.connect(donor1).vote(1, false); // 0.6 against
        await campaign.connect(donor2).vote(1, true);  // 0.4 approve

        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");

        await expect(campaign.resolveVote(1))
          .to.emit(campaign, "MilestoneRejected")
          .withArgs(1, false); // not resolved by AI

        const m = await campaign.getMilestone(1);
        expect(m.status).to.equal(4); // Rejected
      });

      it("should auto-approve via AI when quorum NOT met and AI score >= 70", async function () {
        // Only donor2 votes (0.4 ETH = 40% of 1 ETH) — below 30% quorum? No, 40% > 30%
        // Let's use scenario: only donor2 (0.4 of 1.0 = 40%) votes but we need < 30%
        // Actually 40% > 30% so quorum IS met. Let me skip voting entirely = 0% voted.

        // Set AI score high
        await campaign.connect(backendSigner).setAIScore(1, 75);

        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");

        // No one voted, 0% < 30% quorum → AI tiebreaker
        await expect(campaign.resolveVote(1))
          .to.emit(campaign, "FundsReleased")
          .withArgs(1, ethers.parseEther("0.28"), true); // resolvedByAI = true

        const m = await campaign.getMilestone(1);
        expect(m.status).to.equal(3); // Approved
        expect(m.resolvedByAI).to.be.true;
      });

      it("should auto-reject via AI when quorum NOT met and AI score < 70", async function () {
        await campaign.connect(backendSigner).setAIScore(1, 50);

        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");

        await expect(campaign.resolveVote(1))
          .to.emit(campaign, "MilestoneRejected")
          .withArgs(1, true); // resolvedByAI = true

        const m = await campaign.getMilestone(1);
        expect(m.status).to.equal(4); // Rejected
        expect(m.resolvedByAI).to.be.true;
      });

      it("should allow NGO to resubmit after rejection", async function () {
        await campaign.connect(backendSigner).setAIScore(1, 50);
        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");
        await campaign.resolveVote(1);

        // Resubmit
        await expect(
          campaign.connect(ngo).submitMilestone(1, "QmNewEvidence456")
        ).to.emit(campaign, "MilestoneSubmitted");

        const m = await campaign.getMilestone(1);
        expect(m.status).to.equal(2); // Voting (again)
        expect(m.ipfsHash).to.equal("QmNewEvidence456");
      });

      it("should complete campaign when all milestones approved", async function () {
        // Milestone 0 already approved (bootstrap)
        // Milestone 1 already submitted in beforeEach

        // Approve milestone 1
        await campaign.connect(donor1).vote(1, true);
        await campaign.connect(donor2).vote(1, true);
        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");
        await campaign.resolveVote(1);

        // Approve milestones 2 and 3
        for (let i = 2; i <= 3; i++) {
          await campaign.connect(ngo).submitMilestone(i, `QmHash${i}`);
          await campaign.connect(donor1).vote(i, true);
          await campaign.connect(donor2).vote(i, true);
          await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
          await ethers.provider.send("evm_mine");
          await campaign.resolveVote(i);
        }

        const info = await campaign.getCampaign();
        expect(info.status).to.equal(2); // Completed
      });
    });

    // ── Refund ──

    describe("Refund", function () {
      it("should allow refund when fundraising deadline passes without hitting goal", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.3") });

        await ethers.provider.send("evm_increaseTime", [605000]);
        await ethers.provider.send("evm_mine");

        const balBefore = await ethers.provider.getBalance(donor1.address);
        const tx = await campaign.connect(donor1).refund();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        const balAfter = await ethers.provider.getBalance(donor1.address);
        expect(balAfter + gasUsed - balBefore).to.equal(ethers.parseEther("0.3"));
      });

      it("should prevent double refund", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.3") });
        await ethers.provider.send("evm_increaseTime", [605000]);
        await ethers.provider.send("evm_mine");

        await campaign.connect(donor1).refund();
        await expect(
          campaign.connect(donor1).refund()
        ).to.be.revertedWith("Campaign: already refunded");
      });

      it("should prevent refund while active", async function () {
        await campaign.connect(donor1).donate({ value: GOAL });
        // Campaign is now Active
        await expect(
          campaign.connect(donor1).refund()
        ).to.be.revertedWith("Campaign: refund not available");
      });
    });

    // ── View Functions ──

    describe("View Functions", function () {
      it("should return donor list", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.1") });
        await campaign.connect(donor2).donate({ value: ethers.parseEther("0.2") });
        const donors = await campaign.getDonors();
        expect(donors.length).to.equal(2);
      });

      it("should return donation amount", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.5") });
        expect(await campaign.getDonation(donor1.address)).to.equal(ethers.parseEther("0.5"));
      });

      it("should return milestone count including milestone 0", async function () {
        expect(await campaign.getMilestoneCount()).to.equal(4);
      });

      it("should return all milestones", async function () {
        const all = await campaign.getAllMilestones();
        expect(all.length).to.equal(4);
        expect(all[0].title).to.equal("Initial Operating Grant");
      });
    });
  });
});
