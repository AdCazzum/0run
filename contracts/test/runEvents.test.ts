import { expect } from "chai";
import { ethers } from "hardhat";

describe("RunEvents", () => {
  async function setup() {
    const [backend, alice, bob] = await ethers.getSigners();
    const ev = await (await ethers.getContractFactory("RunEvents", backend)).deploy(backend.address);
    const now = Math.floor(Date.now() / 1000);
    await ev.connect(alice).createEvent("EthLisbon Morning Run", now - 60, now + 3600, "ipfs://x");
    return { ev, backend, alice, bob, eventId: 1n };
  }

  // Il backend firma (eventId, claimant, nullifier): solo una proof World verificata
  // lato server produce questa firma, quindi il contratto non deve fidarsi del chiamante.
  async function sign(backend: any, eventId: bigint, claimant: string, nullifier: string) {
    const digest = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32"], [eventId, claimant, nullifier],
    );
    return backend.signMessage(ethers.getBytes(digest));
  }

  it("chiunque crea eventi; il claim con firma valida registra il partecipante", async () => {
    const { ev, backend, bob, eventId } = await setup();
    const nul = ethers.keccak256(ethers.toUtf8Bytes("nullifier-bob"));
    const sig = await sign(backend, eventId, bob.address, nul);
    await expect(ev.connect(bob).claim(eventId, nul, sig)).to.emit(ev, "Claimed").withArgs(eventId, bob.address, nul);
    expect(await ev.hasClaimed(eventId, bob.address)).to.equal(true);
    expect(await ev.claimantsOf(eventId)).to.deep.equal([bob.address]);
  });

  it("rifiuta una firma non del backend", async () => {
    const { ev, alice, bob, eventId } = await setup();
    const nul = ethers.keccak256(ethers.toUtf8Bytes("n2"));
    const badSig = await sign(alice, eventId, bob.address, nul); // firmata da alice, non dal backend
    await expect(ev.connect(bob).claim(eventId, nul, badSig)).to.be.revertedWith("bad signature");
  });

  it("rifiuta il riuso dello stesso nullifier sullo stesso evento", async () => {
    const { ev, backend, alice, bob, eventId } = await setup();
    const nul = ethers.keccak256(ethers.toUtf8Bytes("shared"));
    await ev.connect(bob).claim(eventId, nul, await sign(backend, eventId, bob.address, nul));
    await expect(
      ev.connect(alice).claim(eventId, nul, await sign(backend, eventId, alice.address, nul)),
    ).to.be.revertedWith("nullifier used");
  });

  it("rifiuta il claim fuori dalla finestra temporale", async () => {
    const [backend, alice] = await ethers.getSigners();
    const ev = await (await ethers.getContractFactory("RunEvents", backend)).deploy(backend.address);
    const past = Math.floor(Date.now() / 1000) - 7200;
    await ev.connect(alice).createEvent("Old", past, past + 60, "");
    const nul = ethers.keccak256(ethers.toUtf8Bytes("late"));
    const digest = ethers.solidityPackedKeccak256(["uint256", "address", "bytes32"], [1n, alice.address, nul]);
    const sig = await backend.signMessage(ethers.getBytes(digest));
    await expect(ev.connect(alice).claim(1n, nul, sig)).to.be.revertedWith("claim window closed");
  });
});
