# VeraFund

![VeraFund Banner](./veraFundBanner.png)

VeraFund is a milestone-based donation platform where ETH is released only when real-world progress is proven. Instead of trusting a fundraiser blindly, donors get transparent funding milestones, evidence review, donor voting, and an audit trail.

## Problem

Traditional donation platforms have three recurring trust gaps:

1. Donors send money up front, but cannot verify how it is used over time.
2. Fundraisers can post vague updates that are hard to authenticate.
3. On-chain transparency exists, but normal donors cannot read raw contract events or Etherscan logs.

That makes it hard to answer the most important question:

Did this campaign actually do the work it claimed it would do?

## Solution

VeraFund breaks a campaign into funding tranches tied to milestones.

- A small bootstrap tranche unlocks once its funding threshold is reached.
- Each later milestone unlocks only when its cumulative funding target is reached and the previous milestone is approved.
- Organisers submit proof images and location data for milestone review.
- Evidence is checked through image analysis, location comparison, timing signals, and anti-spoof heuristics before donor voting.
- Donors vote with weight based on how much they contributed.
- Every major contract action is exposed as a readable audit trail instead of raw blockchain logs.

The result is a donation flow that is still on-chain, but much easier to trust and understand.

## Architecture

### 1. Smart contracts

- `ImpactFundFactory.sol`
  Creates campaigns and validates milestone structure.
- `ImpactFundCampaign.sol`
  Holds ETH in escrow, unlocks milestone funding by threshold, manages voting, refunds, and tranche releases.
- `DonorNFT.sol`
  Mints one soulbound donor token per donor per campaign for governance and provenance.

### 2. Frontend

- React + TypeScript + Vite
- RainbowKit / Wagmi wallet connection
- Campaign creation, campaign detail, dashboard, profile, audit trail, and donor voting flows

### 3. Backend / APIs

- Node.js + Express for local development
- Vercel Functions for production deployment under `/api`
- Handles evidence upload, AI verification, campaign reads, audit trail reads, and notifications

### 4. Evidence verification pipeline

Milestone evidence is checked through several signals:

- OpenAI image analysis for milestone relevance
- EXIF metadata extraction
- claimed site vs photo GPS comparison
- capture-time freshness checks
- geospatial review and locality clues
- reverse-image / duplicate checks
- provenance marker checks such as C2PA / SynthID hints when present

### 5. Auditability

- Human-readable audit trail per campaign
- Etherscan links for every transaction
- Backend-first campaign reads to avoid flaky public RPC behavior in the UI

### Current Sepolia deployment

- DonorNFT:
  [`0x25c992175fE2A0Cc31F381f0C6894B3376353BCd`](https://sepolia.etherscan.io/address/0x25c992175fE2A0Cc31F381f0C6894B3376353BCd#code)
- VeraFund Factory:
  [`0x6A837595E2592d699d48eB2DAcF47Df9493035d2`](https://sepolia.etherscan.io/address/0x6A837595E2592d699d48eB2DAcF47Df9493035d2#code)

## Demo Steps

### Local setup

```bash
git clone https://github.com/Arav-Arun/VeraFund.git
cd VeraFund
npm install
npm --prefix client install
```

Create `.env` files from the examples and fill in the required values:

- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`
- `ETHERSCAN_API_KEY`
- `BACKEND_SIGNER_ADDRESS`
- `OPENAI_API_KEY`
- `PINATA_API_KEY`
- `PINATA_SECRET`
- `VITE_WALLETCONNECT_PROJECT_ID`
- optional email / reverse-image / AI-image detection keys

### Run locally

```bash
# backend
node server/index.js

# frontend
npm --prefix client run dev
```

Open:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3001`

### Demo flow

1. Connect a wallet on Sepolia.
2. Create a campaign with milestone percentages and deadlines.
3. Donate from a separate donor wallet.
4. Watch the bootstrap tranche unlock once its threshold is funded.
5. Submit milestone proof with images and claimed location.
6. Review AI and geospatial verification output.
7. Vote as a donor.
8. Resolve the vote on-chain and inspect the readable audit trail.

## Notes

- VeraFund now reads and creates campaigns from the latest fixed Sepolia factory.
- Older campaigns from the broken funding model are intentionally excluded from the main app flow.
- Production deployment is prepared for Vercel with the frontend in `client/` and backend actions in `api/`.

## Repository

- GitHub:
  [https://github.com/Arav-Arun/VeraFund](https://github.com/Arav-Arun/VeraFund)
