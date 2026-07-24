import { expect } from "chai";
import { ethers } from "hardhat";

describe("OrunAgentNFT", () => {
  it("minta con IntelligentData e li espone; ownerOf corretto", async () => {
    const [deployer, user] = await ethers.getSigners();
    const nft = await (await ethers.getContractFactory("OrunAgentNFT", deployer)).deploy();
    const data = [{ dataDescription: "0g://storage/0xabc", dataHash: ethers.keccak256(ethers.toUtf8Bytes("ct")) }];
    const tx = await nft.mint(data, user.address);
    await expect(tx).to.emit(nft, "Minted").withArgs(1n, user.address);
    expect(await nft.ownerOf(1)).to.equal(user.address);
    const stored = await nft.intelligentDatasOf(1);
    expect(stored[0].dataDescription).to.equal("0g://storage/0xabc");
  });
});
