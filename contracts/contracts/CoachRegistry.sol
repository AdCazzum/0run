// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Registro della memoria del coach: tokenId -> hash correnti dei due strati su 0G Storage.
contract CoachRegistry {
    struct MemoryState { bytes32 memoryRoot; bytes32 profileRoot; uint32 runCount; uint64 updatedAt; }

    address public immutable backend;
    mapping(uint256 => MemoryState) public memoryOf;

    event MemoryUpdated(uint256 indexed tokenId, bytes32 memoryRoot, bytes32 profileRoot, uint32 runCount);

    constructor(address _backend) { backend = _backend; }

    function update(uint256 tokenId, bytes32 memoryRoot, bytes32 profileRoot) external {
        require(msg.sender == backend, "not backend");
        MemoryState storage s = memoryOf[tokenId];
        s.memoryRoot = memoryRoot;
        s.profileRoot = profileRoot;
        s.runCount += 1;
        s.updatedAt = uint64(block.timestamp);
        emit MemoryUpdated(tokenId, memoryRoot, profileRoot, s.runCount);
    }
}
