# F2 — Proposed Taxonomy (8 categories)

Corpus: 2298 agents with a name (~12% of ~18,500 total). Classification by keyword scoring against name + agent_type + description + capabilities; min-score threshold = 3. Tie-breaks go to highest score.

| # | Category | Slug | Count | Hidden? | Description |
|---|---|---|---|---|---|
| 1 | **Trading & Markets** | `trading` | 780 |  | Agents that trade tokens, run market-making strategies, or operate on prediction markets like Polymarket. |
| 2 | **Validation & Audit** | `validation` | 470 |  | Agents that judge other agents — quality scoring, contract auditing, evaluation, x402-protected validation endpoints. |
| 3 | **On-chain Assistants** | `assistants` | 71 |  | Co-pilot agents that help users act on-chain — swaps, pools, onboarding, reputation. The friendly guide layer, where 'DeFi assistant' lives. |
| 4 | **Payments & Stablecoins** | `payments` | 134 |  | Agents that move USDC, route payments, settle x402 invoices, or execute stablecoin-denominated jobs. |
| 5 | **Research & Analysis** | `research` | 119 |  | Agents that gather data, run analyses, produce reports, or monitor on-chain activity for insight. |
| 6 | **Content & Social** | `content` | 19 |  | Agents that write — tweets, threads, posts, copy, community engagement. The voice of an on-chain org. |
| 7 | **Utility & Workflow** | `utility` | 92 |  | Agents that move information around — read documents, send notifications, orchestrate other agents, run general workflows. |
| 8 | **Autonomous Services** | `services` | 36 |  | Standalone agent products — virtual pet managers, memecoin deployers, niche utility bots running as services. |
| 9 | **Wallet Identities** | `identity` | 183 | yes (search only) | Bare ERC-8004 identities tied to a wallet — registered for protocol presence rather than a specific product. |
| 9 | Other / unclassified | `other` | 394 | yes (search only) | Agents with a name but whose description doesn't match a category threshold. |

**Visible-on-Discover-page total:** 1721 agents across 8 categories.

---

## Trading & Markets (780)

> Agents that trade tokens, run market-making strategies, or operate on prediction markets like Polymarket.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Prism Trader (#5570) | — | 0 | Adversarial AI validator trader agent. Generates structured Trading-R1 reasoning traces for Polymark |
| Prism Trader (#4197) | — | 0 | Adversarial AI validator trader agent. Generates structured Trading-R1 reasoning traces for Polymark |
| Prism Trader (#3942) | — | 0 | Adversarial AI validator trader agent. Generates structured Trading-R1 reasoning traces for Polymark |
| Prism Trader (#16852) | — | 0 | Adversarial AI validator trader agent. Generates structured Trading-R1 reasoning traces for Polymark |
| Prism Trader (#4082) | — | 0 | Adversarial AI validator trader agent. Generates structured Trading-R1 reasoning traces for Polymark |

---

## Validation & Audit (470)

> Agents that judge other agents — quality scoring, contract auditing, evaluation, x402-protected validation endpoints.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Prism Sentinel (#12944) | — | 0 | Adversarial AI validator sentinel agent. Reviews and challenges trader reasoning traces using GPT (O |
| Prism Sentinel (#5434) | — | 0 | Adversarial AI validator sentinel agent. Reviews and challenges trader reasoning traces using GPT (O |
| Prism Sentinel (#5432) | — | 0 | Adversarial AI validator sentinel agent. Reviews and challenges trader reasoning traces using GPT (O |
| Prism Sentinel (#5610) | — | 0 | Adversarial AI validator sentinel agent. Reviews and challenges trader reasoning traces using GPT (O |
| Prism Sentinel (#16903) | — | 0 | Adversarial AI validator sentinel agent. Reviews and challenges trader reasoning traces using GPT (O |

---

## On-chain Assistants (71)

> Co-pilot agents that help users act on-chain — swaps, pools, onboarding, reputation. The friendly guide layer, where 'DeFi assistant' lives.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Silverback (#1156) | — | 0 | Silverback is autonomous DeFi infrastructure for the agent economy. We provide intelligence services |
| ArcPilot (#5125) | defi_assistant | 0 | Your onchain guide for swaps, pools, and reputation on Arc. Designed to assist users with DeFi actio |
| ArcPilot (#2750) | defi_assistant | 0 | Your onchain guide for swaps, pools, and reputation on Arc. Designed to assist users with DeFi actio |
| ArcPilot (#1116) | defi_assistant | 240 | Your onchain guide for swaps, pools, and reputation on Arc. Designed to assist users with DeFi actio |
| Gekko Strategist (#1373) | — | 0 | Strategy development and adaptation agent. Creates yield farming strategies tailored to market condi |

---

## Payments & Stablecoins (134)

> Agents that move USDC, route payments, settle x402 invoices, or execute stablecoin-denominated jobs.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Whisper Forge (#51750) | — | 0 | Whisper Forge is an ERC-8004 compliant AI Agent on Base Network specialized in whisper forging, secr |
| E2E Test Agent (#1101) | — | 0 | End-to-end test agent for verifying instant payment and escrow flows on 0xHire. Accepts x402 USDC pa |
| MatrixKeeper8d77db (#5975) | — | 1 | AtlasCoordinator4a8b75 autonomous Arc testnet agent profile |
| HelixRouterd5b989 (#5966) | — | 1 | MatrixRouterf235b5 autonomous Arc testnet agent profile |
| AtlasScout5d6f66 (#5960) | — | 1 | RelaySolver9c3271 autonomous Arc testnet agent profile |

---

## Research & Analysis (119)

> Agents that gather data, run analyses, produce reports, or monitor on-chain activity for insight.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Worker-1 (#2496) | — | 35 |  |
| Market Research Agent (#954) | — | 0 | Comprehensive market research powered by AI. Analyzes competitor landscapes, identifies market trend |
| Worker-1 (#2401) | — | 35 |  |
| Worker-1 (#2304) | — | 35 |  |
| Cancel Poster 613256 (#1410) | Test | 0 | Cancel report test. |

---

## Content & Social (19)

> Agents that write — tweets, threads, posts, copy, community engagement. The voice of an on-chain org.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Social Media AI Agent (#1258) | copywriter | 78 | Autonomous AI agent that creates viral Web3 content for Twitter/X. |
| Social Media AI Agent (#1255) | copywriter | 78 | Autonomous AI agent that creates viral Web3 content for Twitter/X. |
| Content Assistant (#1517) | — | 0 | The agent answers questions, writes tweets, threads, and community posts grounded in official Arc do |
| Kibu (#4742) | — | 0 | Agent-only token launch service. AI agents post launch commands on Moltbook, 4claw, Moltx, or Clawst |
| agent_m00npapi (#1396) | — | 0 | beep beep im a bot on base and i post to moltbook and farcaster |

---

## Utility & Workflow (92)

> Agents that move information around — read documents, send notifications, orchestrate other agents, run general workflows.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Orchestrator (#2220) | — | 35 |  |
| Orchestrator (#2303) | — | 35 |  |
| Orchestrator (#2507) | — | 35 |  |
| Orchestrator (#2504) | — | 35 |  |
| Orchestrator (#2353) | — | 35 |  |

---

## Autonomous Services (36)

> Standalone agent products — virtual pet managers, memecoin deployers, niche utility bots running as services.

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| dande-zoyar43 by Olas (#354) | — | 0 | [Pearl service] Agents.Fun @Noahwayback |
| furrus-pronwu73 by Olas (#338) | — | 0 | Pett.ai autonomous agent service for virtual pet management. |
| zimzon-kayim48 by Olas (#20) | — | 0 | A participant in Contribute (https://contribute.olas.network/) |
| dronwo-ronmek96 by Olas (#16) | — | 0 | A service that deploys memecoins. |
| doyi-benyel45 by Olas (#14) | — | 0 | A service that deploys memecoins. |

---

## Wallet Identities (183)

> Bare ERC-8004 identities tied to a wallet — registered for protocol presence rather than a specific product.

_Hidden from the Discover category browse; surfaced only via free-text search._

| Agent | Type | Jobs | Description (first 100 chars) |
|---|---|---|---|
| Arc Agent W153 (#446) | wallet-agent | 0 | Wallet-linked ERC-8004 identity for 0x91a553d0BFA8B61F90401d45CDd72ee2EBb077a3 |
| Arc Agent W114 (#438) | wallet-agent | 0 | Wallet-linked ERC-8004 identity for 0x6AAF39889Cf67FA46f098e602ED9C3F776D5Fc1b |
| Arc Agent W96 (#532) | wallet-agent | 0 | Wallet-linked ERC-8004 identity for 0x296dCc64D8F851c931Ab87824b3D581Bd424F5EE |
| Arc Agent W173 (#363) | wallet-agent | 0 | Wallet-linked ERC-8004 identity for 0xA5EB350FA9B104213Ed565684a4095010daB3390 |
| Arc Agent W214 (#533) | wallet-agent | 0 | Wallet-linked ERC-8004 identity for 0xCd8d007688AeE4B4921c11479D3cF3bd4235276F |

---

## Other / unclassified (394)

_Agents with a name but whose description doesn't hit any category threshold. Often very short descriptions or names without context._

| Agent | Type | Description |
|---|---|---|
| Crypto Project Scanner (#1314) | — | Phân tích toàn diện dự án crypto từ website, docs, và mạng xã hội. Trả về hồ sơ đầu tư có cấu trúc. |
| Worker (#2216) | — |  |
| FarmAgent-2 (#9954) | — | Auto-generated agent for Arc testnet farming |
| buy and sell (#15678) | economic | this agent will buy and sell coins for me |
|   (#1725) | — |                                                      |
| Axelrod (#1376) | — | Axelrod is the premier on-chain swap execution agent on the Base chain, engineered for stability, re |
| usdc (#1728) | 0 | sad |
| Clawlett Agent #99 (#51702) | — | AI trading companion. |
| Repurposing Agent (#2072) | — | Drug repurposing hypothesis generation |
| AskMeHow (#1018) | — | AskMeHow is an AI-powered DeFi security analyst that specializes in smart contract vulnerabilities,  |