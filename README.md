# ImpactFund 🌱

> **Milestone-gated donation escrow on the blockchain.**
> Donors lock funds in a smart contract. NGOs unlock them — one verified milestone at a time.

---

## The Problem

Traditional NGO donations are a black box. You send money and hope for the best. There's no accountability mechanism, no proof of progress, and no way to pause funding if something goes wrong. ImpactFund makes accountability structural — not optional.

---

## How It Works

```
Many donors contribute → Crowdfunding goal hit → Bootstrap grant released to NGO
→ NGO does work → Submits image evidence to IPFS → GPT-4o analyzes evidence
→ 7-day donor vote opens → Quorum check → Funds released or rejected
→ Repeat per milestone
```

### Three Key Design Decisions

1. **Bootstrap Grant (Milestone 0)** — A configurable % (1-15%) released immediately when the funding goal is hit, giving the NGO operating capital to start work. No voting required — agreed upfront by donors.

2. **Crowdfunding** — Any number of donors contribute to a single campaign. Each receives a soulbound DonorNFT (ERC-5192) that grants voting rights weighted by donation size.

3. **Quorum + AI Fallback** — If fewer than 30% of donors vote in the 7-day window, GPT-4o's AI verdict becomes the tiebreaker instead of stalling the campaign forever.

---

## Demo

| Action              | Transaction              |
| ------------------- | ------------------------ |
| Campaign deployed   | [View on Etherscan ↗](#) |
| Donation made       | [View on Etherscan ↗](#) |
| Bootstrap released  | [View on Etherscan ↗](#) |
| Milestone submitted | [View on Etherscan ↗](#) |
| Funds released      | [View on Etherscan ↗](#) |

> **Contract Address:** `0x...` — [View on Sepolia Etherscan ↗](#)

---

## Features

- **Escrow-based donations** — ETH locked in smart contract until milestones are verified
- **Bootstrap grant** — Configurable % released immediately on funding goal hit for NGO operating costs
- **IPFS evidence storage** — Images and documents stored decentrally via Pinata
- **AI verification** — GPT-4o analyzes milestone evidence and returns a confidence score
- **7-day voting window** — Time-bounded donor voting with quorum requirements
- **Weighted donor voting** — Donation size determines voting power
- **AI tiebreaker** — If quorum fails, AI score ≥ 70 auto-approves; < 70 auto-rejects
- **Soulbound DonorNFT** — Non-transferable proof of donation and voting rights (ERC-5192)
- **Full on-chain trail** — Every donation, submission, vote, and release is a real transaction
- **Refund protection** — Donors can reclaim funds if campaign is cancelled or deadline passes

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

Core escrow logic. Holds donated ETH, manages bootstrap grants, milestone submissions, 7-day voting windows with quorum checks, AI tiebreaker resolution, and tranche releases.

**Key functions:**

```solidity
donate()                                        // payable, records donor, mints DonorNFT, triggers bootstrap if goal hit
submitMilestone(milestoneId, ipfsHash)           // NGO only, opens 7-day voting window
vote(milestoneId, approve)                       // donor only, weighted by donation
setAIScore(milestoneId, score)                   // backend signer only, stores AI score for tiebreaker
resolveVote(milestoneId)                         // anyone, after voting window closes
refund()                                         // donor pull if campaign cancelled
```

**Resolution logic:**
```
Quorum reached (30%+ voted)?
├── YES → 60%+ approve? → Release tranche / Reject
└── NO  → AI score ≥ 70? → Auto-approve / Auto-reject
```

### `DonorNFT.sol`

Soulbound ERC-5192 token. One per donor per campaign. Proves voting rights. Non-transferable.

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
├── test/
│   └── ImpactFund.test.js         ← 49 tests
├── server/
│   ├── index.js
│   ├── routes/
│   │   ├── upload.js              ← POST /upload-evidence
│   │   └── verify.js             ← POST /verify-milestone, GET /verdict, POST /resolve-vote
│   └── .env.example
├── src/                           ← Frontend (React + Tailwind)
│   ├── constants.js
│   ├── hooks/
│   └── pages/
├── hardhat.config.js
└── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js v18+
- MetaMask browser extension
- Sepolia testnet ETH (get from [sepoliafaucet.com](https://sepoliafaucet.com))
- OpenAI API key with GPT-4o access
- Pinata account for IPFS uploads

### 1. Clone and install

```bash
git clone https://github.com/Arav-Arun/ImpactFund.git
cd ImpactFund
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Fill in your keys in both `.env` files.

### 3. Compile and test contracts

```bash
npx hardhat compile
npx hardhat test
```

### 4. Deploy contracts to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

Copy the output contract addresses into `src/constants.js`.

Verify on Etherscan:

```bash
npx hardhat verify --network sepolia <DonorNFT_ADDRESS>
npx hardhat verify --network sepolia <Factory_ADDRESS> "<DonorNFT_ADDRESS>" "<BACKEND_SIGNER_ADDRESS>"
```

### 5. Start the backend

```bash
cd server
node index.js
# Running on http://localhost:3001
```

### 6. Start the frontend

```bash
npm run dev
# Running on http://localhost:5173
```

---

## API Reference

### `POST /upload-evidence`

Upload milestone evidence to IPFS via Pinata.

**Request:** `multipart/form-data` with image files (field: `files`)

**Response:**

```json
{
  "cids": ["QmXyz123...", "QmAbc456..."]
}
```

---

### `POST /verify-milestone`

Run AI verification on submitted evidence using GPT-4o vision. Writes AI score on-chain.

**Request:**

```json
{
  "milestoneId": 1,
  "campaignAddress": "0x...",
  "cids": ["QmXyz123..."],
  "milestoneDescription": "Complete foundation work for 3 wells"
}
```

**Response:**

```json
{
  "score": 78,
  "verdict": "Verified",
  "summary": "Images show clear excavation work. Visible progress across 3 sites."
}
```

---

### `GET /verdict/:campaignAddress/:milestoneId`

Returns cached AI verdict. 404 if not yet verified.

---

### `POST /resolve-vote`

Trigger on-chain vote resolution after the 7-day window closes.

**Request:**

```json
{
  "campaignAddress": "0x...",
  "milestoneId": 1
}
```

**Response:**

```json
{
  "txHash": "0x...",
  "outcome": "approved",
  "resolvedByAI": false
}
```

---

## How the AI Verification Works

When an NGO submits a milestone, GPT-4o vision receives:

- The milestone description (what was promised)
- The submitted images fetched from IPFS (what was delivered)

It returns a **confidence score (0–100)**, a **verdict** (`Verified` / `Inconclusive` / `Flagged`), and a **summary**.

- If quorum is reached (30%+ voted): donor vote decides
- If quorum is NOT reached: AI score becomes the tiebreaker
  - Score ≥ 70 → auto-approve, release tranche
  - Score < 70 → auto-reject, NGO can resubmit

The AI advises — donors decide. Fund release is always gated by the smart contract.

---

## Why This Is Genuinely Decentralized

| Claim                            | How it's proven                          |
| -------------------------------- | ---------------------------------------- |
| Funds never touch a middleman    | ETH held only by the smart contract      |
| Bootstrap is agreed upfront      | % set at creation, visible to all donors |
| NGO cannot self-approve releases | Contract requires donor vote or AI check |
| Evidence is permanent            | Stored on IPFS, hash recorded on-chain   |
| History is tamper-proof          | Every action is an immutable on-chain tx |
| Anyone can verify                | All tx hashes link to public Etherscan   |

---

## Team

Built at KJSSE GajShield Hack X by team _Deploy For Good_.

---

## License

MIT
