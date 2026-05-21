// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;

    function setBalance(address account, uint256 amount) external {
        balances[account] = amount;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        require(balances[sender] >= amount, "insufficient balance");
        require(allowances[sender][msg.sender] >= amount, "insufficient allowance");
        unchecked { balances[sender] -= amount; }
        unchecked { balances[recipient] += amount; }
        allowances[sender][msg.sender] = 0;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }
}

contract MockERC8183 {
    uint256 public jobCounter;
    mapping(uint256 => Job) public jobs;

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        uint8 status;
        address hook;
    }

    mapping(uint256 => mapping(address => bool)) public fundedCalled;

    event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId) {
        jobId = ++jobCounter;
        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: 0,
            hook: hook
        });
        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata) external {
        require(jobs[jobId].id != 0, "Job not found");
        require(msg.sender == jobs[jobId].provider, "Unauthorized");
        jobs[jobId].budget = amount;
        emit BudgetSet(jobId, amount);
    }

    function fund(uint256 jobId, bytes calldata) external {
        require(jobs[jobId].id != 0, "Job not found");
        require(msg.sender == jobs[jobId].client, "Unauthorized");
        jobs[jobId].status = 1;
        fundedCalled[jobId][msg.sender] = true;
        emit JobFunded(jobId, msg.sender, jobs[jobId].budget);
    }

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
        )
    {
        Job storage j = jobs[jobId];
        return (j.id, j.client, j.provider, j.evaluator, j.description, j.budget, j.expiredAt, j.status, j.hook);
    }
}
