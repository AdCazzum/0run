import { ethers } from "hardhat";

// Deploy-only script for RunEvents, used instead of the full deploy.ts to avoid
// redeploying OrunAgentNFT/CoachRegistry (already live in production; CoachRegistry
// currently backs a real coach at tokenId 3 — redeploying would orphan it).
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address, "balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  // backend = treasury/deployer address: la stessa chiave co-firma i claim World ID lato server.
  const runEvents = await (await ethers.getContractFactory("RunEvents")).deploy(deployer.address);
  await runEvents.waitForDeployment();
  const tx = runEvents.deploymentTransaction();
  console.log("RUN_EVENTS_ADDRESS=", await runEvents.getAddress());
  console.log("RUN_EVENTS_DEPLOY_TX=", tx?.hash);
}
main().catch((e) => { console.error(e); process.exit(1); });
