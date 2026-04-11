# 🌱 ImpactFund

**Milestone-gated donation escrow on Ethereum** — transparent, AI-verified, donor-governed.

Instead of releasing funds all at once, donated ETH is locked in a smart contract and released in tranches — only when an NGO proves real-world progress through verified evidence, AI analysis, and weighted donor voting.

---

## How It Works

```
Donors contribute ETH → Funding goal reached → Bootstrap grant auto-releases
→ NGO does work → Submits image evidence to IPFS → GPT-4o analyzes evidence
→ 7-day donor vote opens → Quorum check → Funds released or rejected
→ Repeat per milestone → Campaign completes
```

### Key Features

- **🏦 Escrow** — ETH locked in smart contracts, released only on milestone approval
- **🚀 Bootstrap Grant** — 1-15% released immediately when funding goal is hit, giving NGOs operating capital
- **🗳️ Weighted Voting** — Donor voting power proportional to donation amount (soulbound NFT)
- **🤖 AI Tiebreaker** — If quorum isn't met in 7 days, GPT-4o vision verdict decides
- **📸 IPFS Evidence** — Milestone proof uploaded to IPFS via Pinata, permanently stored
- **🔒 Soulbound NFTs** — Non-transferable donor tokens (ERC-5192) for voting rights

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Smart Contracts | Solidity 0.8.27, Hardhat, OpenZeppelin |
| Blockchain | Ethereum Sepolia Testnet |
| Frontend | React 18, TypeScript, Vite |
| UI Style | Neobrutalism (Space Grotesk, thick borders, vivid colors) |
| Wallet | MetaMask via ethers.js v6 |
| Backend | Node.js, Express |
| File Storage | IPFS via Pinata SDK |
| AI Verification | OpenAI GPT-4o (vision) |

---

## Deployed Contracts (Sepolia)

| Contract | Address | Etherscan |
|----------|---------|-----------|
| DonorNFT | `0x7ec109b7931cdc7a3869a033E4fb5cF9a934670c` | [View ↗](https://sepolia.etherscan.io/address/0x7ec109b7931cdc7a3869a033E4fb5cF9a934670c#code) |
| ImpactFundFactory | `0xC37cb2Eb3ef384906F8Cc48bCa889449B1E7F83D` | [View ↗](https://sepolia.etherscan.io/address/0xC37cb2Eb3ef384906F8Cc48bCa889449B1E7F83D#code) |

---

## Project Structure

```
ImpactFund/
├── contracts/                  # Solidity smart contracts
│   ├── ImpactFundCampaign.sol  # Campaign escrow + milestone logic
│   ├── ImpactFundFactory.sol   # Campaign deployer + registry
│   └── DonorNFT.sol            # Soulbound ERC-5192 donor token
├── test/
│   └── ImpactFund.test.js      # 49 unit tests
├── scripts/
│   └── deploy.js               # Sepolia deployment script
├── client/                     # React TypeScript frontend
│   └── src/
│       ├── pages/              # Home, CampaignDetail, CreateCampaign, Dashboard
│       ├── components/         # Navbar, Footer
│       ├── hooks/              # useWallet, useCampaign
│       ├── types/              # TypeScript type definitions
│       ├── constants.ts        # ABIs, addresses, status labels
│       └── index.css           # Neobrutalism design system
├── server/                     # Express backend
│   ├── index.js                # Server entry point
│   └── routes/
│       ├── upload.js           # IPFS upload via Pinata
│       └── verify.js           # GPT-4o verification + on-chain resolution
├── hardhat.config.js
└── .env.example
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- MetaMask browser extension
- Sepolia testnet ETH ([faucet](https://sepoliafaucet.com))

### 1. Clone & Install

```bash
git clone https://github.com/Arav-Arun/ImpactFund.git
cd ImpactFund
npm install
```

### 2. Environment Variables

```bash
# Root .env (for contract deployment)
cp .env.example .env

# Server .env (for backend)
cp server/.env.example server/.env
```

Fill in the values:

| Variable | Where to get it |
|----------|----------------|
| `SEPOLIA_RPC_URL` | [Infura](https://infura.io) or [Alchemy](https://alchemy.com) (free) |
| `PRIVATE_KEY` | MetaMask → Account Details → Show Private Key |
| `ETHERSCAN_API_KEY` | [etherscan.io/apis](https://etherscan.io/apis) (free) |
| `BACKEND_SIGNER_ADDRESS` | Your MetaMask public address (`0x...`) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |
| `PINATA_API_KEY` / `PINATA_SECRET` | [app.pinata.cloud](https://app.pinata.cloud) (free) |

### 3. Run Tests

```bash
npx hardhat test
# → 49 passing
```

### 4. Start Frontend

```bash
cd client
npm install
npm run dev
# → http://localhost:5173
```

### 5. Start Backend

```bash
cd server
npm install
node index.js
# → http://localhost:3001
```

### 6. Test the Full Flow

1. Open `http://localhost:5173` → Connect MetaMask (Sepolia)
2. **Create Campaign** → Fill the 4-step form → Deploy to blockchain
3. Switch MetaMask account → **Donate** ETH to the campaign
4. When goal is reached → bootstrap grant auto-releases
5. Switch to NGO account → **Submit milestone evidence** (uploads to IPFS + AI verification)
6. Switch to donor → **Vote** approve or challenge
7. After voting window → **Resolve vote** (quorum check or AI tiebreaker)

---

## Smart Contract Architecture

### ImpactFundCampaign.sol
- Escrow contract holding donated ETH
- Bootstrap grant (Milestone 0) auto-releases when goal is hit
- 7-day voting window per milestone with **30% quorum** and **60% approval** threshold
- AI tiebreaker: if quorum not met, GPT-4o score ≥ 70 → auto-approve
- ReentrancyGuard on all ETH transfers
- Refund when campaign cancelled or deadline passes

### ImpactFundFactory.sol
- Deploys new campaign contracts
- Validates bootstrap % (1-15%) and milestone percentages (must sum to 100%)
- Registers campaigns and authorizes DonorNFT minting

### DonorNFT.sol
- Soulbound ERC-5192 (non-transferable)
- One token per donor per campaign
- Voting weight = donation amount

---

## Backend API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/upload-evidence` | POST | Upload images to IPFS via Pinata |
| `/verify-milestone` | POST | GPT-4o vision analysis → writes AI score on-chain |
| `/verdict/:addr/:id` | GET | Cached AI verification result |
| `/resolve-vote` | POST | Triggers on-chain `resolveVote()` after voting window |
| `/health` | GET | Health check |

---

## Security

- ✅ OpenZeppelin ReentrancyGuard on all ETH transfers
- ✅ Access control: onlyNGO, onlyDonor, onlyBackendSigner modifiers
- ✅ Soulbound NFTs prevent vote manipulation via transfer
- ✅ Double-vote, double-refund, and double-release prevention
- ✅ Deployer-only milestone addition
- ✅ Vote reset on milestone resubmission
- ✅ 49 unit tests covering edge cases

---

## License

MIT
