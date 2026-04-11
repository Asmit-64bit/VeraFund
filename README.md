# ImpactFund 🌱

> **Milestone-gated donation escrow on the blockchain.**
> Donors lock funds in a smart contract. NGOs unlock them — one verified milestone at a time.

---

## The Problem

Traditional NGO donations are a black box. You send money and hope for the best. There's no accountability mechanism, no proof of progress, and no way to pause funding if something goes wrong. ImpactFund makes accountability structural — not optional.

---

## How It Works

```
Donor locks ETH into escrow
         ↓
NGO submits milestone proof (images → IPFS)
         ↓
GPT-4o analyzes evidence, returns confidence score
         ↓
Donors vote to Approve or Challenge (weighted by donation size)
         ↓
Smart contract releases tranche automatically on approval
```

Funds never touch a middleman. Every action is an on-chain transaction. Every piece of evidence is stored on IPFS. The full history is verifiable on Etherscan — forever.

---

## Demo

| Action              | Transaction              |
| ------------------- | ------------------------ |
| Campaign deployed   | [View on Etherscan ↗](#) |
| Donation made       | [View on Etherscan ↗](#) |
| Milestone submitted | [View on Etherscan ↗](#) |
| Funds released      | [View on Etherscan ↗](#) |

> **Contract Address:** `0x...` — [View on Sepolia Etherscan ↗](#)

---

## Features

- **Escrow-based donations** — ETH locked in smart contract until milestones are verified
- **IPFS evidence storage** — images and documents stored decentrally via Pinata
- **AI verification** — GPT-4o analyzes milestone evidence and returns a confidence score
- **Weighted donor voting** — donation size determines voting power, majority triggers fund release
- **Soulbound DonorNFT** — non-transferable proof of donation and voting rights (ERC-5192)
- **Full on-chain trail** — every donation, submission, vote and release is a real transaction
- **Refund protection** — donors can reclaim funds if campaign is cancelled or deadline passes

---

## Tech Stack

| Layer                 | Technology                      |
| --------------------- | ------------------------------- |
| Smart Contracts       | Solidity, Hardhat, OpenZeppelin |
| Blockchain            | Ethereum Sepolia Testnet        |
| Wallet                | MetaMask via ethers.js v6       |
| Frontend              | React 18, Tailwind CSS          |
| File Storage          | IPFS via Pinata SDK             |
| AI Verification       | OpenAI GPT-4o API               |
| Backend               | Node.js, Express                |
| Contract Verification | Etherscan Sepolia               |

---

## Smart Contracts

### `ImpactFundFactory.sol`

Entry point. Deploys individual campaign contracts and maintains a registry of all campaigns.

### `ImpactFundCampaign.sol`

Core escrow logic. Holds donated ETH, tracks milestones, manages weighted voting, and releases tranches automatically when vote threshold is met.

**Key functions:**

```solidity
donate()                                    // payable, records donor, mints DonorNFT
submitMilestone(milestoneId, ipfsHash)      // NGO only, stores evidence hash on-chain
vote(milestoneId, approve)                  // donor only, weighted by donation amount
releaseFunds(milestoneId)                   // auto-triggered after vote passes threshold
refund()                                    // donor pull if campaign cancelled
```

### `DonorNFT.sol`

Soulbound ERC-5192 token. Minted on donation. Proves voting rights. Non-transferable.

> **Deployed on Sepolia:** `0x...`
> **Verified on Etherscan:** [Link ↗](#)

---

## Project Structure

```
impactfund/
├── contracts/
│   ├── ImpactFundFactory.sol
│   ├── ImpactFundCampaign.sol
│   └── DonorNFT.sol
├── scripts/
│   └── deploy.js
├── src/
│   ├── hooks/
│   │   ├── useWallet.js
│   │   ├── useCampaign.js
│   │   ├── useDonate.js
│   │   ├── useVote.js
│   │   ├── useSubmitMilestone.js
│   │   └── useReleaseFunds.js
│   ├── pages/
│   │   ├── Home.jsx
│   │   ├── CampaignDetail.jsx
│   │   ├── DonateFlow.jsx
│   │   ├── DonorDashboard.jsx
│   │   ├── NGODashboard.jsx
│   │   ├── CreateCampaign.jsx
│   │   └── MilestoneSubmit.jsx
│   └── constants.js
└── server/
    ├── index.js
    ├── routes/
    │   ├── upload.js
    │   └── verify.js
    └── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js v18+
- MetaMask browser extension
- Sepolia testnet ETH (get from [sepoliafaucet.com](https://sepoliafaucet.com))
- OpenAI API key with GPT-4o access

### 1. Clone and install

```bash
git clone https://github.com/your-org/impactfund.git
cd impactfund
npm install
```

### 2. Set up environment variables

```bash
cp server/.env.example server/.env
```

Fill in your keys:

```env
OPENAI_API_KEY=your_openai_api_key
PINATA_API_KEY=your_pinata_key
PINATA_SECRET=your_pinata_secret
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_project_id
PRIVATE_KEY=your_deployer_wallet_private_key
```

### 3. Deploy contracts

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network sepolia
```

Copy the output contract addresses into `src/constants.js`.

### 4. Start the backend

```bash
cd server
node index.js
# Running on http://localhost:3001
```

### 5. Start the frontend

```bash
npm run dev
# Running on http://localhost:5173
```

---

## API Reference

### `POST /upload-evidence`

Upload milestone evidence to IPFS via Pinata.

**Request:** `multipart/form-data` with image files

**Response:**

```json
{
  "cids": ["QmXyz123...", "QmAbc456..."]
}
```

---

### `POST /verify-milestone`

Run AI verification on submitted milestone evidence using GPT-4o vision.

**Request:**

```json
{
  "cid": "QmXyz123...",
  "milestoneDescription": "Complete foundation work for 3 wells in Rajasthan"
}
```

**Response:**

```json
{
  "score": 78,
  "verdict": "Verified",
  "summary": "Images show clear excavation work consistent with well foundation construction. Visible progress across 3 separate sites. No red flags detected."
}
```

---

### `GET /verdict/:milestoneId`

Returns cached AI verdict for a milestone.

---

## How the AI Verification Works

When an NGO submits a milestone, GPT-4o vision receives:

- The milestone description (what was promised)
- The submitted images fetched from IPFS (what was delivered)

GPT-4o checks:

- Does the visual evidence match the stated goal?
- Is there visible progress consistent with the milestone description?
- Any signs of stock images, duplication, or inconsistencies?

It returns a **confidence score (0–100)**, a **verdict** (`Verified` / `Inconclusive` / `Flagged`), and a **plain-language summary** shown to donors before they vote.

The AI advises — donors decide. Fund release is always gated by the human vote.

---

## Why This Is Genuinely Decentralized

| Claim                            | How it's proven                          |
| -------------------------------- | ---------------------------------------- |
| Funds never touch a middleman    | ETH held only by the smart contract      |
| NGO cannot self-approve releases | Contract requires donor vote threshold   |
| Evidence is permanent            | Stored on IPFS, hash recorded on-chain   |
| History is tamper-proof          | Every action is an immutable on-chain tx |
| Anyone can verify                | All tx hashes link to public Etherscan   |

---

## Team

Built in 24 hours at KJSSE GajShield Hack X by team _Deploy For Good_.

---

## License

MIT
