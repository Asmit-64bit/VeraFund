const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, ".env") });

const uploadRoutes = require("./routes/upload");
const verifyRoutes = require("./routes/verify");
const campaignProfileRoutes = require("./routes/campaignProfile");
const campaignReadRoutes = require("./routes/campaignReads");
const ipfsAssetRoutes = require("./routes/ipfsAsset");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Root route
app.get("/", (_req, res) => {
  res.json({
    name: "VeraFund Backend API",
    status: "running",
    endpoints: {
      "GET /campaigns": "Read campaign list from Sepolia through backend RPC failover",
      "GET /campaign": "Read one campaign and its milestones from Sepolia",
      "GET /campaign-audit": "Read human-readable audit trail entries for a campaign",
      "GET /ipfs-asset": "Proxy pinned IPFS media through the backend",
      "POST /upload-evidence": "Upload images to IPFS via Pinata",
      "POST /upload-campaign-profile": "Upload campaign profile metadata and cover image",
      "POST /verify-milestone": "AI verification via GPT-4o",
      "GET /verdict/:addr/:id": "Cached AI verdict",
      "GET /health": "Health check",
    },
  });
});

// Routes
app.use("/", uploadRoutes);
app.use("/", verifyRoutes);
app.use("/", campaignProfileRoutes);
app.use("/", campaignReadRoutes);
app.use("/", ipfsAssetRoutes);

// Error handler
app.use((err, _req, res, _next) => {
  console.error("Server error:", err.message);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`VeraFund backend running on http://localhost:${PORT}`);
  console.log(`  POST /upload-evidence     — Upload images to IPFS`);
  console.log(`  POST /upload-campaign-profile — Upload campaign profile metadata`);
  console.log(`  GET  /ipfs-asset          — Proxy pinned campaign media`);
  console.log(`  POST /verify-milestone    — AI verification via GPT-4o`);
  console.log(`  GET  /verdict/:addr/:id   — Cached AI verdict`);
});
