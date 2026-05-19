# ArcAgents Rating Service

On-chain credit rating for ERC-8004 AI agents. Computes PD (Probability of Default), LGD (Loss Given Default), and EAD (Exposure At Default) from agent feedback history, validation status, and job performance, then assigns a tier from Arc-AAA to Arc-D.

## API

`GET /api/v1/agents/:id/rating` — returns rating for a single agent.

## Engine

| Module | Purpose | Status |
|--------|---------|--------|
| `pd.ts` | Probability of Default | Stub — Friday |
| `lgd.ts` | Loss Given Default | Stub — Friday |
| `ead.ts` | Exposure At Default | Stub — Friday |
| `rating.ts` | Tier assignment | Stub — Friday |
