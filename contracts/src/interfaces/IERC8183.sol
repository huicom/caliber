// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8183 {
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId);

    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;

    function fund(uint256 jobId, bytes calldata optParams) external;

    function getJob(uint256 jobId)
        external
        view
        returns (
            uint256 id,
            address client,
            address provider,
            address evaluator,
            string memory description,
            uint256 budget,
            uint256 expiredAt,
            uint8 status,
            address hook
        );
}
