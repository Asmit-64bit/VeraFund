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
  const BOOTSTRAP_AMOUNT = ethers.parseEther("0.05");
  const MILESTONE_ONE_UNLOCK = ethers.parseEther("0.33");
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

    it("should start donors at Bronze tier", async function () {
      const milestones = milestoneInputs(DEADLINE);
      await factory.connect(ngo).createCampaign(
        TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, milestones, GOAL, DEADLINE
      );
      const allCampaigns = await factory.getAllCampaigns();
      const campaign = await ethers.getContractAt("ImpactFundCampaign", allCampaigns[0]);

      await campaign.connect(donor1).donate({ value: ethers.parseEther("0.1") });
      const tokenId = await donorNFT.donorCampaignToken(await campaign.getAddress(), donor1.address);

      expect(await donorNFT.getSupporterTier(donor1.address)).to.equal(0);
      const tokenUri = await donorNFT.tokenURI(tokenId);
      const encodedMetadata = tokenUri.replace("data:application/json;base64,", "");
      const metadata = JSON.parse(Buffer.from(encodedMetadata, "base64").toString("utf8"));

      expect(metadata.attributes.find((attribute) => attribute.trait_type === "Supporter Tier")?.value).to.equal("Bronze");
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

    it("should reject an empty title", async function () {
      const milestones = milestoneInputs(DEADLINE);
      await expect(
        factory.connect(ngo).createCampaign("", DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, milestones, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: title required");
    });

    it("should reject an empty NGO name", async function () {
      const milestones = milestoneInputs(DEADLINE);
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, "", BOOTSTRAP_PERCENT, milestones, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: NGO name required");
    });

    it("should reject a zero funding goal", async function () {
      const milestones = milestoneInputs(DEADLINE);
      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, milestones, 0, DEADLINE)
      ).to.be.revertedWith("Factory: goal must be > 0");
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

    it("should reject fundraising deadlines in the past", async function () {
      const block = await ethers.provider.getBlock("latest");
      const pastDeadline = block.timestamp - 60;
      const milestones = milestoneInputs(DEADLINE);

      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, milestones, GOAL, pastDeadline)
      ).to.be.revertedWith("Factory: fundraising deadline must be in the future");
    });

    it("should reject milestone deadlines before fundraising deadline", async function () {
      const invalidMilestones = [
        { title: "A", description: "a", fundPercent: 50, deadline: DEADLINE - 10 },
        { title: "B", description: "b", fundPercent: 50, deadline: DEADLINE + 172800 },
      ];

      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, invalidMilestones, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: milestone deadline must be after fundraising deadline");
    });

    it("should reject milestone deadlines that are not increasing", async function () {
      const invalidMilestones = [
        { title: "A", description: "a", fundPercent: 50, deadline: DEADLINE + 172800 },
        { title: "B", description: "b", fundPercent: 50, deadline: DEADLINE + 86400 },
      ];

      await expect(
        factory.connect(ngo).createCampaign(TITLE, DESCRIPTION, NGO_NAME, BOOTSTRAP_PERCENT, invalidMilestones, GOAL, DEADLINE)
      ).to.be.revertedWith("Factory: milestone deadlines must be increasing");
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
        // User milestones are converted to shares of the total goal.
        // The final milestone absorbs the rounding remainder so all tranches add to 100%.
        const all = await campaign.getAllMilestones();
        expect(all[0].fundPercent).to.equal(5);  // bootstrap
        expect(all[1].fundPercent).to.equal(28);
        expect(all[2].fundPercent).to.equal(38);
        expect(all[3].fundPercent).to.equal(29);
      });

      it("should expose cumulative unlock thresholds for each milestone", async function () {
        expect(await campaign.getMilestoneUnlockAmount(0)).to.equal(BOOTSTRAP_AMOUNT);
        expect(await campaign.getMilestoneUnlockAmount(1)).to.equal(MILESTONE_ONE_UNLOCK);
        expect(await campaign.getMilestoneUnlockAmount(2)).to.equal(ethers.parseEther("0.71"));
        expect(await campaign.getMilestoneUnlockAmount(3)).to.equal(GOAL);
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

      it("should reject donations from the campaign NGO", async function () {
        await expect(
          campaign.connect(ngo).donate({ value: ethers.parseEther("0.1") })
        ).to.be.revertedWith("Campaign: NGO cannot donate to own campaign");
      });
    });

    // ── Bootstrap Grant ──

    describe("Bootstrap Grant", function () {
      it("should release bootstrap as soon as the bootstrap tranche is fully funded", async function () {
        const ngoBefore = await ethers.provider.getBalance(ngo.address);

        await expect(
          campaign.connect(donor1).donate({ value: BOOTSTRAP_AMOUNT })
        ).to.emit(campaign, "BootstrapReleased")
          .withArgs(BOOTSTRAP_AMOUNT);

        const ngoAfter = await ethers.provider.getBalance(ngo.address);
        expect(ngoAfter - ngoBefore).to.equal(BOOTSTRAP_AMOUNT);

        const info = await campaign.getCampaign();
        expect(info.status).to.equal(1); // Active
      });

      it("should reject donations that exceed the goal", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.5") });

        await expect(
          campaign.connect(donor2).donate({ value: ethers.parseEther("0.6") })
        ).to.be.revertedWith("Campaign: donation exceeds goal");
      });

      it("should mark milestone 0 as Approved after bootstrap", async function () {
        await campaign.connect(donor1).donate({ value: BOOTSTRAP_AMOUNT });
        const m0 = await campaign.getMilestone(0);
        expect(m0.status).to.equal(3); // Approved
      });

      it("should keep accepting donations after bootstrap is released", async function () {
        await campaign.connect(donor1).donate({ value: BOOTSTRAP_AMOUNT });
        await expect(
          campaign.connect(donor2).donate({ value: ethers.parseEther("0.1") })
        ).to.emit(campaign, "DonationReceived")
          .withArgs(donor2.address, ethers.parseEther("0.1"));

        expect(await campaign.raisedAmount()).to.equal(ethers.parseEther("0.15"));
      });
    });

    // ── Milestone Submission ──

    describe("Milestone Submission", function () {
      beforeEach(async function () {
        await campaign.connect(donor1).donate({ value: MILESTONE_ONE_UNLOCK });
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

      it("should reject milestone submission before its cumulative funding target is reached", async function () {
        const milestones = milestoneInputs(DEADLINE);
        await factory.connect(ngo).createCampaign(
          `${TITLE} 2`,
          DESCRIPTION,
          NGO_NAME,
          BOOTSTRAP_PERCENT,
          milestones,
          GOAL,
          DEADLINE
        );
        const allCampaigns = await factory.getAllCampaigns();
        const secondCampaign = await ethers.getContractAt("ImpactFundCampaign", allCampaigns[1]);

        await secondCampaign.connect(donor1).donate({ value: BOOTSTRAP_AMOUNT });

        await expect(
          secondCampaign.connect(ngo).submitMilestone(1, "QmTestHash123")
        ).to.be.revertedWith("Campaign: milestone funding not unlocked");
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

      it("should resolve early once 100% of donor weight has voted", async function () {
        await campaign.connect(donor1).vote(1, true);
        await campaign.connect(donor2).vote(1, true);

        const ngoBefore = await ethers.provider.getBalance(ngo.address);

        await expect(campaign.resolveVote(1))
          .to.emit(campaign, "FundsReleased")
          .withArgs(1, ethers.parseEther("0.28"), false);

        const ngoAfter = await ethers.provider.getBalance(ngo.address);
        expect(ngoAfter - ngoBefore).to.equal(ethers.parseEther("0.28"));

        const m = await campaign.getMilestone(1);
        expect(m.status).to.equal(3);
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

      it("should upgrade donors to Silver when a funded campaign completes", async function () {
        await campaign.connect(donor1).vote(1, true);
        await campaign.connect(donor2).vote(1, true);
        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");
        await campaign.resolveVote(1);

        for (let i = 2; i <= 3; i++) {
          await campaign.connect(ngo).submitMilestone(i, `QmHash${i}`);
          await campaign.connect(donor1).vote(i, true);
          await campaign.connect(donor2).vote(i, true);
          await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
          await ethers.provider.send("evm_mine");
          await campaign.resolveVote(i);
        }

        expect(await donorNFT.successfulCampaignsByDonor(donor1.address)).to.equal(1);
        expect(await donorNFT.getSupporterTier(donor1.address)).to.equal(1);
      });
    });

    // ── Refund ──

    describe("Refund", function () {
      it("should allow a proportional refund of the remaining locked balance when fundraising ends short", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.3") });

        await ethers.provider.send("evm_increaseTime", [605000]);
        await ethers.provider.send("evm_mine");

        const balBefore = await ethers.provider.getBalance(donor1.address);
        const tx = await campaign.connect(donor1).refund();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        const balAfter = await ethers.provider.getBalance(donor1.address);
        expect(balAfter + gasUsed - balBefore).to.equal(ethers.parseEther("0.25"));
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

      it("should let anyone mark a campaign stale after 60 days past an unresolved milestone deadline", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.6") });
        await campaign.connect(donor2).donate({ value: ethers.parseEther("0.4") });

        const milestoneOne = await campaign.getMilestone(1);
        await ethers.provider.send("evm_setNextBlockTimestamp", [Number(milestoneOne.deadline) + 60 * 86400 + 1]);
        await ethers.provider.send("evm_mine");

        await expect(campaign.connect(donor3).markCampaignStale())
          .to.emit(campaign, "CampaignMarkedStale")
          .withArgs(1, ethers.parseEther("0.95"));

        const info = await campaign.getCampaign();
        expect(info.status).to.equal(3); // Cancelled
        expect(await campaign.staleRefundPool()).to.equal(ethers.parseEther("0.95"));
      });

      it("should refund donors proportionally to remaining locked funds after a stale campaign", async function () {
        await campaign.connect(donor1).donate({ value: ethers.parseEther("0.6") });
        await campaign.connect(donor2).donate({ value: ethers.parseEther("0.4") });

        await campaign.connect(ngo).submitMilestone(1, "QmTestHash123");
        await campaign.connect(donor1).vote(1, true);
        await campaign.connect(donor2).vote(1, true);
        await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
        await ethers.provider.send("evm_mine");
        await campaign.resolveVote(1);

        const milestoneTwo = await campaign.getMilestone(2);
        await ethers.provider.send("evm_setNextBlockTimestamp", [Number(milestoneTwo.deadline) + 60 * 86400 + 1]);
        await ethers.provider.send("evm_mine");
        await campaign.markCampaignStale();

        expect(await campaign.getRefundAmount(donor1.address)).to.equal(ethers.parseEther("0.402"));
        expect(await campaign.getRefundAmount(donor2.address)).to.equal(ethers.parseEther("0.268"));

        await expect(() => campaign.connect(donor1).refund()).to.changeEtherBalances(
          [donor1, campaign],
          [ethers.parseEther("0.402"), -ethers.parseEther("0.402")]
        );

        await expect(() => campaign.connect(donor2).refund()).to.changeEtherBalances(
          [donor2, campaign],
          [ethers.parseEther("0.268"), -ethers.parseEther("0.268")]
        );
      });

      it("should reject stale marking before the inactivity window has passed", async function () {
        await campaign.connect(donor1).donate({ value: GOAL });

        const milestoneOne = await campaign.getMilestone(1);
        await ethers.provider.send("evm_setNextBlockTimestamp", [Number(milestoneOne.deadline) + 30 * 86400]);
        await ethers.provider.send("evm_mine");

        await expect(
          campaign.markCampaignStale()
        ).to.be.revertedWith("Campaign: stale refund not available");
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
