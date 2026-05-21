// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;

    function setBalance(address account, uint256 amount) external {
        balances[account] = amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        require(balances[sender] >= amount, "insufficient balance");
        require(allowances[sender][msg.sender] >= amount, "insufficient allowance");
        unchecked { balances[sender] -= amount; }
        unchecked { balances[recipient] += amount; }
        allowances[sender][msg.sender] -= amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "insufficient balance");
        unchecked { balances[msg.sender] -= amount; }
        unchecked { balances[recipient] += amount; }
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }
}

contract MockERC8183 {
    // Status codes mirror the ERC-8183 reference deployment used on Arc.
    uint8 public constant STATUS_OPEN = 0;
    uint8 public constant STATUS_FUNDED = 1;
    uint8 public constant STATUS_SUBMITTED = 2;
    uint8 public constant STATUS_COMPLETED = 3;
    uint8 public constant STATUS_REJECTED = 4;
    uint8 public constant STATUS_EXPIRED = 5;

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
            status: STATUS_OPEN,
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
        jobs[jobId].status = STATUS_FUNDED;
        fundedCalled[jobId][msg.sender] = true;
        emit JobFunded(jobId, msg.sender, jobs[jobId].budget);
    }

    // Test-only helpers so CaliberEscrow tests can simulate ERC-8183 state
    // transitions without wiring the full job lifecycle.
    function setStatus(uint256 jobId, uint8 newStatus) external {
        require(jobs[jobId].id != 0, "Job not found");
        jobs[jobId].status = newStatus;
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
