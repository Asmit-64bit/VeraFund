const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // Backend signer address — set this to your backend wallet address
  // For dev/testing, using deployer as backend signer
  const BACKEND_SIGNER = process.env.BACKEND_SIGNER_ADDRESS || deployer.address;
  console.log("Backend signer:", BACKEND_SIGNER);

  // 1. Deploy DonorNFT
  console.log("\n1. Deploying DonorNFT...");
  const DonorNFT = await hre.ethers.getContractFactory("DonorNFT");
  const donorNFT = await DonorNFT.deploy();
  await donorNFT.waitForDeployment();
  const donorNFTAddress = await donorNFT.getAddress();
  console.log("   DonorNFT deployed to:", donorNFTAddress);

  // 2. Deploy ImpactFundFactory (pass DonorNFT + backend signer)
  console.log("\n2. Deploying ImpactFundFactory...");
  const Factory = await hre.ethers.getContractFactory("ImpactFundFactory");
  const factory = await Factory.deploy(donorNFTAddress, BACKEND_SIGNER);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("   ImpactFundFactory deployed to:", factoryAddress);

  // 3. Transfer DonorNFT ownership to Factory
  console.log("\n3. Transferring DonorNFT ownership to Factory...");
  const tx = await donorNFT.transferOwnership(factoryAddress);
  await tx.wait();
  console.log("   DonorNFT ownership transferred to Factory");

  // 4. Summary
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`  DonorNFT:          ${donorNFTAddress}`);
  console.log(`  ImpactFundFactory: ${factoryAddress}`);
  console.log(`  Backend Signer:    ${BACKEND_SIGNER}`);
  console.log("=".repeat(60));
  console.log("\nNext steps:");
  console.log("  1. Copy addresses into src/constants.js");
  console.log("  2. Verify on Etherscan:");
  console.log(`     npx hardhat verify --network sepolia ${donorNFTAddress}`);
  console.log(`     npx hardhat verify --network sepolia ${factoryAddress} "${donorNFTAddress}" "${BACKEND_SIGNER}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
