import { expect } from "chai";
import { ethers } from "hardhat";

describe("CoachRegistry", () => {
  it("solo il backend aggiorna; runCount incrementa; evento emesso", async () => {
    const [backend, rando] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("CoachRegistry", backend)).deploy(backend.address);
    const root1 = ethers.keccak256(ethers.toUtf8Bytes("m1"));
    const prof1 = ethers.keccak256(ethers.toUtf8Bytes("p1"));
    await expect(reg.update(1, root1, prof1)).to.emit(reg, "MemoryUpdated").withArgs(1, root1, prof1, 1);
    const s = await reg.memoryOf(1);
    expect(s.runCount).to.equal(1);
    expect(s.memoryRoot).to.equal(root1);
    await expect(reg.connect(rando).update(1, root1, prof1)).to.be.revertedWith("not backend");
  });
});
