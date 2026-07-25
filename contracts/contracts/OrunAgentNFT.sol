// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Fallback minimale ERC-7857-style (subset: mint con dati intelligenti + authorizeUsage).
/// Usato SOLO se il vendor 0gfoundation/0g-agent-nft non compila/deploya (vedi docs/decisions.md).
contract OrunAgentNFT is ERC721 {
    struct IntelligentData { string dataDescription; bytes32 dataHash; }

    uint256 public nextId = 1;
    mapping(uint256 => IntelligentData[]) private _data;
    mapping(uint256 => mapping(address => bool)) public authorizedUsageOf;

    event Minted(uint256 indexed tokenId, address indexed to);
    event UsageAuthorized(uint256 indexed tokenId, address indexed executor);

    constructor() ERC721("0run Coach", "0RUN") {}

    function mint(IntelligentData[] calldata iDatas, address to) external payable returns (uint256 tokenId) {
        tokenId = nextId++;
        _safeMint(to, tokenId);
        for (uint256 i = 0; i < iDatas.length; i++) _data[tokenId].push(iDatas[i]);
        emit Minted(tokenId, to);
    }

    function intelligentDatasOf(uint256 tokenId) external view returns (IntelligentData[] memory) {
        _requireOwned(tokenId);
        return _data[tokenId];
    }

    function authorizeUsage(uint256 tokenId, address executor) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        authorizedUsageOf[tokenId][executor] = true;
        emit UsageAuthorized(tokenId, executor);
    }
}
