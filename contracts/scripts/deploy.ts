import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address, "balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  // Se il vendor è utilizzabile (docs/decisions.md), sostituire "OrunAgentNFT" col contratto vendor e i suoi parametri di init.
  const nft = await (await ethers.getContractFactory("OrunAgentNFT")).deploy();
  await nft.waitForDeployment();
  const reg = await (await ethers.getContractFactory("CoachRegistry")).deploy(deployer.address);
  await reg.waitForDeployment();
  console.log("AGENT_NFT_ADDRESS=", await nft.getAddress());
  console.log("COACH_REGISTRY_ADDRESS=", await reg.getAddress());
}
main().catch((e) => { console.error(e); process.exit(1); });
