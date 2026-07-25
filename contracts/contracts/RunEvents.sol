// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Eventi di corsa creabili da chiunque. Il claim richiede la co-firma del backend,
/// che la produce solo dopo aver verificato una proof World ID (cloud-verify): il contratto
/// non può verificare la proof on-chain perché su 0G non esiste un WorldIDRouter.
/// Garanzia offerta: una persona reale unica per evento. NON garantisce la partecipazione.
contract RunEvents {
    using ECDSA for bytes32;

    struct Event { address creator; string name; uint64 startsAt; uint64 endsAt; string uri; }

    address public immutable backend;
    uint256 public nextEventId = 1;

    mapping(uint256 => Event) public eventOf;
    mapping(uint256 => address[]) private _claimants;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    mapping(uint256 => mapping(bytes32 => bool)) public nullifierUsed;

    event EventCreated(uint256 indexed eventId, address indexed creator, string name);
    event Claimed(uint256 indexed eventId, address indexed claimant, bytes32 nullifierHash);

    constructor(address _backend) { backend = _backend; }

    function createEvent(string calldata name, uint64 startsAt, uint64 endsAt, string calldata uri)
        external returns (uint256 eventId)
    {
        require(endsAt > startsAt, "bad window");
        eventId = nextEventId++;
        eventOf[eventId] = Event(msg.sender, name, startsAt, endsAt, uri);
        emit EventCreated(eventId, msg.sender, name);
    }

    function claim(uint256 eventId, bytes32 nullifierHash, bytes calldata backendSig) external {
        Event memory e = eventOf[eventId];
        require(e.endsAt != 0, "unknown event");
        require(block.timestamp >= e.startsAt && block.timestamp <= e.endsAt, "claim window closed");
        require(!hasClaimed[eventId][msg.sender], "already claimed");
        require(!nullifierUsed[eventId][nullifierHash], "nullifier used");

        bytes32 digest = keccak256(abi.encodePacked(eventId, msg.sender, nullifierHash));
        require(
            MessageHashUtils.toEthSignedMessageHash(digest).recover(backendSig) == backend,
            "bad signature"
        );

        hasClaimed[eventId][msg.sender] = true;
        nullifierUsed[eventId][nullifierHash] = true;
        _claimants[eventId].push(msg.sender);
        emit Claimed(eventId, msg.sender, nullifierHash);
    }

    function claimantsOf(uint256 eventId) external view returns (address[] memory) {
        return _claimants[eventId];
    }
}
