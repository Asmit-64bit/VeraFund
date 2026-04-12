# VeraFund

![VeraFund Banner](./client/public/assets/veraFundBanner.png)

VeraFund is a milestone-based donation escrow platform built on Sepolia. Donors fund campaigns through a smart contract, organisers unlock money only after milestone proof is submitted, and donors can inspect what happened through a readable audit trail instead of raw blockchain logs.

## Problem

Most donation platforms still depend on trust after payment.

- Funds are often transferred up front.
- Donors usually get vague progress updates instead of verifiable proof.
- Even when a project is on-chain, ordinary users cannot easily read Etherscan events and understand what actually happened.

That leaves one core question unanswered:

How can donors know that money is released only when the promised work is actually done?

## Solution

VeraFund breaks each campaign into a bootstrap tranche and later milestones.

- Donations are locked in a campaign smart contract.
- The bootstrap tranche unlocks when its own funding threshold is reached.
- Later milestones unlock only when:
  - their cumulative funding threshold is reached, and
  - the previous milestone has already been approved.
- Organisers submit proof for each milestone instead of receiving all funds up front.
- Donors vote with weight based on how much they donated.
- Milestones can resolve early once all donor voting weight has voted.
- If fundraising fails or a campaign becomes stale, donors can claim refunds from the locked remainder.

## Architecture

### Smart contracts

- `contracts/ImpactFundFactory.sol`
  Creates campaigns and validates milestone percentages and deadlines.
- `contracts/ImpactFundCampaign.sol`
  Holds escrowed ETH, tracks donation weights, opens milestones, accepts proof submissions, runs donor voting, resolves milestones, and handles stale/refund paths.
- `contracts/DonorNFT.sol`
  Mints a donor NFT per donor per campaign.

### Frontend

- React
- TypeScript
- Vite
- RainbowKit / Wagmi
- Ethers v6

Main user-facing flows:

- browse and filter campaigns
- create campaigns with organiser identity and campaign media
- donate to campaigns
- upload milestone proof
- review AI evidence analysis
- vote on milestones
- inspect audit trails
- view profile and dashboard pages

### Backend and deployment

- Express routes in `server/routes/` for local development
- matching Vercel Functions in `api/` for deployment
- shared verification and read logic in `lib/`

Main backend responsibilities:

- upload and pin campaign media
- upload and pin milestone evidence
- read campaign and audit data
- proxy IPFS assets through the app
- run evidence verification

## Evidence verification pipeline

Milestone evidence is reviewed through multiple layers instead of a single image check.

### OpenAI review

OpenAI GPT-4o with vision is used to review whether the uploaded evidence:

- matches the milestone description
- appears specific to the campaign and milestone
- visually supports the claimed work being done
- aligns with the claimed context and location details

The campaign page shows a visible AI review panel with score, verdict, and review details.

### Authenticity checks

The backend also checks:

- EXIF GPS coordinates when available
- capture time metadata when available
- camera make/model metadata
- editing or software metadata
- exact file hash duplicates
- previous milestone evidence reuse
- campaign-specific proof codes and milestone-specific marker phrases
- provenance hints such as `C2PA`, `Content Credentials`, and `SynthID`

### Geospatial checks

When coordinates are provided or embedded:

- photo GPS is reverse-geocoded
- claimed coordinates are compared against detected coordinates
- locality mismatch is flagged
- distance from the claimed location is measured

### Provider-backed checks

These checks run when the corresponding env vars are configured:

- reverse-image lookup through your configured reverse-image adapter
- AI-generated image scoring through Sightengine

## Audit trail

Each campaign includes a readable audit trail that summarizes:

- donations
- bootstrap release
- milestone submissions
- donor votes
- milestone approvals
- milestone rejections
- refunds
- stale campaign transitions

Each entry links to the underlying transaction on Etherscan.

## Current Sepolia deployment

- DonorNFT:
  [0x25c992175fE2A0Cc31F381f0C6894B3376353BCd](https://sepolia.etherscan.io/address/0x25c992175fE2A0Cc31F381f0C6894B3376353BCd#code)
- VeraFund Factory:
  [0x6A837595E2592d699d48eB2DAcF47Df9493035d2](https://sepolia.etherscan.io/address/0x6A837595E2592d699d48eB2DAcF47Df9493035d2#code)

## Demo steps

### 1. Install dependencies

```bash
git clone https://github.com/Arav-Arun/VeraFund.git
cd VeraFund
npm install
npm --prefix client install
```

### 2. Configure environment variables

The repository includes [/.env.example](/Users/arav/Desktop/VeraFund/.env.example) with the expected keys.

Core env vars:

- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`
- `ETHERSCAN_API_KEY`
- `BACKEND_SIGNER_ADDRESS`
- `BACKEND_SIGNER_PRIVATE_KEY`
- `OPENAI_API_KEY`
- `PINATA_API_KEY`
- `PINATA_SECRET`
- `VITE_WALLETCONNECT_PROJECT_ID`

Optional provider-backed verification env vars:

- `SIGHTENGINE_API_USER`
- `SIGHTENGINE_API_SECRET`
- `REVERSE_IMAGE_SEARCH_API_URL`
- `REVERSE_IMAGE_SEARCH_API_KEY`
- `REVERSE_IMAGE_SEARCH_API_KEY_HEADER`

### 3. Run locally

Start the backend:

```bash
node server/index.js
```

Start the frontend:

```bash
npm --prefix client run dev
```

Local URLs:

- frontend: `http://127.0.0.1:5173`
- backend: `http://127.0.0.1:3001`

### 4. Walk through the demo

1. Connect a donor or organiser wallet on Sepolia.
2. Create a campaign with bootstrap and milestone percentages.
3. Add banner and gallery images for the campaign.
4. Donate from a donor wallet.
5. Watch funding thresholds unlock the bootstrap tranche and later milestones.
6. Submit milestone evidence with:
   - fresh site photos
   - claimed location details
   - the milestone-specific proof code or marker visible in at least one image if possible
7. Review the AI panel, authenticity checks, and geospatial review.
8. Vote as a donor.
9. Resolve the milestone when the vote completes or when all donor weight has voted.
10. Inspect the audit trail and donor-facing verification output.

## Development notes

- The contract test suite passes with `61 passing`.
- The client production build is clean.
- Each campaign uses one primary category for cleaner discovery and filtering.
- Campaign media is proxied through the app for safer display on restrictive networks.
- Some older campaigns deployed before the newer unlock model may still behave differently from current campaigns.

## Repository

- GitHub: [https://github.com/Arav-Arun/VeraFund](https://github.com/Arav-Arun/VeraFund)
