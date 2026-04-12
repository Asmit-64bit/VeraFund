# VeraFund

![VeraFund Banner](./client/public/assets/veraFundBanner.png)

**VeraFund** is a milestone-based donation escrow platform built on Sepolia. Donors send ETH into a transparent smart contract, organisers unlock funds only after milestone proof is submitted, and everyone can audit what happened through a readable on-chain trail instead of raw blockchain logs.

---

## The Problem

Most donation platforms still depend on trust after payment.
- Funds are often transferred up front.
- Donors usually get vague progress updates instead of verifiable proof.
- Even when a project is on-chain, ordinary users cannot easily read Etherscan events and understand what actually happened.

That leaves one core question unanswered: **How can donors know that money is released only when the promised work is actually done?**

## The Solution

VeraFund breaks every campaign into a bootstrap tranche and later milestones.
- **Escrow Contracts:** Donations are locked in a campaign smart contract.
- **Milestone Unlocks:** The bootstrap tranche unlocks when its funding threshold is reached. Later milestones unlock only when their cumulative funding threshold is reached, and the previous milestone has been approved.
- **Proof of Work:** Organisers submit proof for each milestone instead of receiving all funds up front.
- **Donor Governance:** Donors vote with weight based on how much they donated.
- **Refunds:** If fundraising fails or a campaign becomes stale, donors can claim refunds from the locked remainder.

---

## Architecture

VeraFund is split into three layers:
1. **Solidity Contracts:** Handles fundraising, milestone state, voting, and refunds.
2. **React Frontend:** Manages campaign discovery, donation, profile management, milestone proof submission, and audit views.
3. **Backend Verification:** Routes for media upload, IPFS proxying, campaign reads, and proof analysis.

### Smart Contracts
- `contracts/ImpactFundFactory.sol`: Creates campaigns; validates milestone percentages and deadlines.
- `contracts/ImpactFundCampaign.sol`: Holds escrowed ETH, tracks donation weights, opens milestones, accepts proof, runs donor voting, resolves milestones, and paths refunds/stale states.
- `contracts/DonorNFT.sol`: Mints a soulbound Donor NFT per donor per campaign.

### Frontend Stack
- React, TypeScript, Vite
- RainbowKit & Wagmi
- Ethers v6

### Backend & Deployment
- Express routes (`server/routes/`) for local development
- Vercel Functions (`api/`) for deployment
- Shared verification logic (`lib/`)

---

## 🔍 Evidence Verification Pipeline

Milestone evidence is reviewed through multiple layers:

### AI Evidence Review (Vision)
OpenAI GPT-4o with Vision reviews whether the evidence:
- Matches the milestone description.
- Appears specific to the campaign and milestone.
- Visually supports the claimed work.
- Aligns with the context and location details.
_The campaign page features a visible AI review panel displaying score, verdict, and review details._

### Authenticity & Geospatial Checks
The backend also verifies:
- EXIF GPS coordinates, capture time metadata, and camera make/model.
- Editing software metadata and exact file hash duplicates.
- Previous milestone evidence reuse.
- Campaign-specific proof codes and marker phrases.
- Claimed coordinates vs. detected coordinates, flagging locality mismatches.

### Provider-Backed Checks
- Reverse-image lookup through configured adapters.
- AI-generated image scoring via Sightengine.

---

## Audit Trail

Each campaign includes a readable audit log summarizing:
- Donations
- Bootstrap releases
- Milestone submissions, donor votes, and approvals/rejections
- Refunds and stale campaign transitions

_Every audit entry links directly to the underlying Etherscan transaction for absolute transparency._

---

## Current Sepolia Deployment

- **DonorNFT:** [0x25c992175fE2A0Cc31F381f0C6894B3376353BCd](https://sepolia.etherscan.io/address/0x25c992175fE2A0Cc31F381f0C6894B3376353BCd#code)
- **VeraFund Factory:** [0x6A837595E2592d699d48eB2DAcF47Df9493035d2](https://sepolia.etherscan.io/address/0x6A837595E2592d699d48eB2DAcF47Df9493035d2#code)

---

## 💻 Running Locally

### 1. Install Dependencies

```bash
git clone https://github.com/Arav-Arun/VeraFund.git
cd VeraFund
npm install
npm --prefix client install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in the required keys:

**Core:**
`SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`, `FACTORY_ADDRESS`, `FACTORY_ADDRESSES`, `BACKEND_SIGNER_PRIVATE_KEY`, `OPENAI_API_KEY`, `PINATA_API_KEY`, `PINATA_SECRET`, `IPFS_GATEWAYS`

**Frontend:**
`VITE_FACTORY_ADDRESS`, `VITE_FACTORY_ADDRESSES`, `VITE_BLOCK_EXPLORER_URL`, `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_IPFS_GATEWAYS`

**Provider-Backed (Optional):**
`SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET`, `REVERSE_IMAGE_SEARCH_API_URL`, `REVERSE_IMAGE_SEARCH_API_KEY`, `REVERSE_IMAGE_SEARCH_API_KEY_HEADER`

### 3. Start the Application

**Backend API:**
```bash
node server/index.js
```
_Running on `http://127.0.0.1:3001`_

**Frontend UI:**
```bash
npm --prefix client run dev
```
_Running on `http://127.0.0.1:5173`_

---

## Demo Walkthrough

1. Connect a wallet (Donor/Organiser) on Sepolia.
2. Create a campaign with bootstrap and milestone percentages. Add media.
3. Donate using a donor wallet.
4. Watch thresholds unlock the bootstrap and subsequent milestones.
5. Submit milestone evidence (fresh photos, location details, proof codes).
6. Review the AI Verification panel and authenticity checks.
7. Vote as a Donor.
8. Resolve the milestone when voting concludes.
9. Inspect the on-chain audit trail.

---
Made during KJSSE GajShield Hack X 2026
