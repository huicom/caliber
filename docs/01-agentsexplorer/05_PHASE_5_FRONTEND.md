# Phase 5 — Frontend UI

> **Goal:** Build the public-facing site with polished pages for agent listing, detail, jobs, and live feed.

**Estimated time:** 6 hours
**Output:** Beautiful, mobile-responsive UI consuming all Phase 4 APIs.

---

## 🎯 Outcomes of Phase 5

After this phase:

1. ✅ Polished homepage with stats hero + live feed + leaderboard
2. ✅ Agent listing page with search/filter/sort
3. ✅ Agent detail page with all data + 4 tabs
4. ✅ Jobs listing + detail with visual timeline
5. ✅ Live feed page with real-time SSE updates
6. ✅ Stats analytics page with charts
7. ✅ Fully responsive (mobile + desktop)
8. ✅ Loading states + empty states + error handling
9. ✅ Looks production-quality

---

## 📋 Pre-Phase Checklist

- [ ] Phase 4 complete — all API endpoints working
- [ ] `pnpm dev:web` runs cleanly
- [ ] You can hit `/api/agents/14176` and get your agent

---

## 🎨 Design Principles

| Principle | Why |
|---|---|
| Dark-first | Matches Arc's brand, easier on eyes for long sessions |
| Mono for addresses | Differentiate identifiers from prose |
| Live data visible | Live counters, recent events build trust |
| Empty states with CTAs | Don't leave users stranded |
| No skeuomorphism | Flat, technical aesthetic — this is infrastructure |
| Fast > pretty | If a feature can't render fast, defer it |

---

## Step 5.1 — Install shadcn/ui Components (Claude Code, 20 min)

### CLAUDE CODE PROMPT #5.1 — shadcn setup

> Add shadcn/ui to `apps/web`. Initialize with the New York style and Tailwind v4-compatible config.
>
> Install these components:
> - `button`
> - `card`
> - `badge`
> - `input`
> - `select`
> - `tabs`
> - `table`
> - `dialog`
> - `tooltip`
> - `skeleton`
> - `avatar`
> - `sonner` (toasts)
> - `separator`
> - `dropdown-menu`
>
> Use the command:
> ```bash
> cd apps/web
> npx shadcn@latest init
> npx shadcn@latest add button card badge input select tabs table dialog tooltip skeleton avatar sonner separator dropdown-menu
> ```
>
> After install, verify components live at `src/components/ui/`.
>
> Set up `<Toaster />` in the root layout.

### YOU: Run shadcn init

Choose defaults except:
- Style: **New York**
- Base color: **Slate**
- CSS variables: **Yes**

---

## Step 5.2 — Layout + Navigation (Claude Code, 30 min)

### CLAUDE CODE PROMPT #5.2 — Site shell

> Build the global layout: sticky top navigation, footer, and route shell.
>
> ## `src/components/site/Nav.tsx`
>
> Sticky nav with these links: `Home`, `Agents`, `Jobs`, `Live Feed`, `Stats`. Use Next.js `<Link>` + `usePathname()` for active highlighting.
>
> Right side:
> - GitHub icon link (`https://github.com/huicom/arc-agents-explorer`)
> - Twitter icon link
> - Small "Bangkok 🇹🇭" indicator
>
> Logo on left: text "ArcAgents" with a small purple square mark. Click navigates to home.
>
> Mobile: collapse links into a hamburger menu using shadcn `DropdownMenu`.
>
> ```tsx
> 'use client';
>
> import Link from 'next/link';
> import { usePathname } from 'next/navigation';
> import { Github, Menu } from 'lucide-react';
> import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
> import { cn } from '@/lib/utils';
>
> const NAV_LINKS = [
>   { href: '/', label: 'Home' },
>   { href: '/agents', label: 'Agents' },
>   { href: '/jobs', label: 'Jobs' },
>   { href: '/live', label: 'Live Feed' },
>   { href: '/stats', label: 'Stats' },
> ];
>
> export function Nav() {
>   const pathname = usePathname();
>   return (
>     <nav className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur">
>       <div className="mx-auto max-w-7xl flex items-center justify-between px-4 h-14">
>         <Link href="/" className="flex items-center gap-2">
>           <span className="inline-block w-6 h-6 rounded bg-gradient-to-br from-brand to-purple-700" aria-hidden />
>           <span className="font-semibold text-lg">ArcAgents</span>
>         </Link>
>
>         <div className="hidden md:flex items-center gap-1">
>           {NAV_LINKS.map(l => (
>             <Link
>               key={l.href}
>               href={l.href}
>               className={cn(
>                 'px-3 py-1.5 rounded text-sm transition',
>                 pathname === l.href ? 'text-text bg-bg-muted' : 'text-text-muted hover:text-text hover:bg-bg-subtle'
>               )}
>             >
>               {l.label}
>             </Link>
>           ))}
>         </div>
>
>         <div className="flex items-center gap-3">
>           <span className="hidden md:inline text-xs text-text-dim">Bangkok 🇹🇭</span>
>           <a href="https://github.com/huicom/arc-agents-explorer" target="_blank" rel="noreferrer" className="text-text-muted hover:text-text">
>             <Github className="w-4 h-4" />
>           </a>
>           <DropdownMenu>
>             <DropdownMenuTrigger className="md:hidden">
>               <Menu className="w-5 h-5" />
>             </DropdownMenuTrigger>
>             <DropdownMenuContent align="end">
>               {NAV_LINKS.map(l => (
>                 <DropdownMenuItem key={l.href} asChild>
>                   <Link href={l.href}>{l.label}</Link>
>                 </DropdownMenuItem>
>               ))}
>             </DropdownMenuContent>
>           </DropdownMenu>
>         </div>
>       </div>
>     </nav>
>   );
> }
> ```
>
> ## `src/components/site/Footer.tsx`
>
> ```tsx
> import Link from 'next/link';
>
> export function Footer() {
>   return (
>     <footer className="border-t border-border mt-16 py-8 text-sm text-text-dim">
>       <div className="mx-auto max-w-7xl px-4 grid gap-6 md:grid-cols-3">
>         <div>
>           <p className="font-semibold text-text mb-1">ArcAgents</p>
>           <p>First agent explorer for Arc.</p>
>           <p className="mt-2">Built solo from Bangkok 🇹🇭</p>
>         </div>
>         <div>
>           <p className="font-semibold text-text mb-1">Resources</p>
>           <ul className="space-y-1">
>             <li><a href="https://arc.network" target="_blank" rel="noreferrer" className="hover:text-text">Arc Network</a></li>
>             <li><a href="https://docs.arc.network" target="_blank" rel="noreferrer" className="hover:text-text">Arc Docs</a></li>
>             <li><a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer" className="hover:text-text">ArcScan Testnet</a></li>
>             <li><a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noreferrer" className="hover:text-text">ERC-8004</a></li>
>           </ul>
>         </div>
>         <div>
>           <p className="font-semibold text-text mb-1">Community</p>
>           <ul className="space-y-1">
>             <li><a href="https://discord.gg/buildonarc" target="_blank" rel="noreferrer" className="hover:text-text">Arc Discord</a></li>
>             <li><a href="https://community.arc.io" target="_blank" rel="noreferrer" className="hover:text-text">Arc House</a></li>
>             <li><a href="https://github.com/huicom/arc-agents-explorer" target="_blank" rel="noreferrer" className="hover:text-text">GitHub</a></li>
>           </ul>
>         </div>
>       </div>
>       <div className="mx-auto max-w-7xl px-4 mt-6 text-center text-xs text-text-dim">
>         Not affiliated with Circle or the Arc team. Built by an independent Architect.
>       </div>
>     </footer>
>   );
> }
> ```
>
> ## Update `app/layout.tsx` to wrap children with Nav + Footer + Toaster

---

## Step 5.3 — Shared Helpers (Claude Code, 20 min)

### CLAUDE CODE PROMPT #5.3 — Common UI utils

> Build helpers used across all pages.
>
> ## `src/lib/api.ts` — Client-side API wrapper
>
> ```typescript
> async function fetcher<T>(path: string): Promise<T> {
>   const res = await fetch(path, { cache: 'no-store' });
>   if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
>   return res.json();
> }
>
> export const api = {
>   stats: () => fetcher<StatsResponse>('/api/stats'),
>   agents: (params: Record<string, string | number>) => {
>     const qs = new URLSearchParams(params as any).toString();
>     return fetcher<AgentsListResponse>(`/api/agents?${qs}`);
>   },
>   agent: (id: string) => fetcher<AgentDetailResponse>(`/api/agents/${id}`),
>   agentFeedback: (id: string, params: Record<string, string | number> = {}) => {
>     const qs = new URLSearchParams(params as any).toString();
>     return fetcher(`/api/agents/${id}/feedback?${qs}`);
>   },
>   jobs: (params: Record<string, string | number> = {}) => {
>     const qs = new URLSearchParams(params as any).toString();
>     return fetcher(`/api/jobs?${qs}`);
>   },
>   job: (id: string) => fetcher(`/api/jobs/${id}`),
>   feed: () => fetcher('/api/feed'),
> };
>
> // (define response types matching the API output)
> ```
>
> ## `src/components/ui/AgentAvatar.tsx`
>
> ```tsx
> export function AgentAvatar({ id, size = 40 }: { id: string; size?: number }) {
>   const url = `https://api.dicebear.com/9.x/bottts/svg?seed=Agent+${id}`;
>   return (
>     <img
>       src={url}
>       width={size}
>       height={size}
>       alt={`Agent ${id} avatar`}
>       className="rounded-md bg-bg-muted"
>     />
>   );
> }
> ```
>
> ## `src/components/ui/Address.tsx`
>
> Display address with copy-to-clipboard and link to arcscan:
>
> ```tsx
> 'use client';
> import { useState } from 'react';
> import { Copy, ExternalLink, Check } from 'lucide-react';
> import { truncateAddress, arcscanAddressUrl } from '@/lib/format';
> import { toast } from 'sonner';
>
> export function Address({ value, full = false }: { value: string; full?: boolean }) {
>   const [copied, setCopied] = useState(false);
>
>   return (
>     <span className="inline-flex items-center gap-1.5 font-mono text-sm">
>       <span>{full ? value : truncateAddress(value)}</span>
>       <button
>         onClick={async () => {
>           await navigator.clipboard.writeText(value);
>           setCopied(true);
>           toast.success('Address copied');
>           setTimeout(() => setCopied(false), 1500);
>         }}
>         className="text-text-dim hover:text-text"
>       >
>         {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
>       </button>
>       <a href={arcscanAddressUrl(value)} target="_blank" rel="noreferrer" className="text-text-dim hover:text-text">
>         <ExternalLink className="w-3 h-3" />
>       </a>
>     </span>
>   );
> }
> ```
>
> ## `src/components/ui/TxLink.tsx` — same pattern for tx hashes
>
> ## `src/components/ui/StatusBadge.tsx`
>
> Visual badge for job status:
>
> ```tsx
> import { Badge } from '@/components/ui/badge';
> import { cn } from '@/lib/utils';
>
> const STATUS_STYLES: Record<string, string> = {
>   Open: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
>   Funded: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
>   Submitted: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
>   Completed: 'bg-success/10 text-success border-success/30',
>   Rejected: 'bg-danger/10 text-danger border-danger/30',
>   Expired: 'bg-text-dim/10 text-text-dim border-text-dim/30',
> };
>
> export function StatusBadge({ status }: { status: string }) {
>   return (
>     <Badge variant="outline" className={cn('font-mono text-xs', STATUS_STYLES[status])}>
>       {status}
>     </Badge>
>   );
> }
> ```
>
> ## `src/components/ui/ReputationStars.tsx`
>
> Visual reputation score with stars:
>
> ```tsx
> import { Star } from 'lucide-react';
> import { cn } from '@/lib/utils';
>
> export function ReputationStars({ score }: { score: number | null }) {
>   if (score === null) return <span className="text-text-dim text-sm">No reputation yet</span>;
>
>   const stars = Math.round((score / 100) * 5);
>   return (
>     <span className="inline-flex items-center gap-1">
>       {[1, 2, 3, 4, 5].map(i => (
>         <Star
>           key={i}
>           className={cn('w-4 h-4', i <= stars ? 'fill-warning text-warning' : 'text-text-dim')}
>         />
>       ))}
>       <span className="font-mono text-sm ml-1">{score.toFixed(1)}</span>
>     </span>
>   );
> }
> ```

---

## Step 5.4 — Homepage (Claude Code, 60 min)

### CLAUDE CODE PROMPT #5.4 — Homepage

> Build a stunning homepage at `app/page.tsx`. This is the first impression — it must communicate immediately what this is and why it matters.
>
> **Layout (top to bottom):**
>
> ### Hero section
> - Big headline: "Every AI agent on Arc, in one place."
> - Subhead: "Browse identities, reputation, jobs, and earnings from every ERC-8004 agent on Arc testnet."
> - 4 stat cards in a row (full width on desktop, 2x2 on mobile):
>   - Total Agents (live count, e.g. "14,180")
>   - Total Jobs (e.g. "20,051")
>   - USDC Volume (e.g. "$12,450")
>   - Active in last 24h (e.g. "320 events")
>
> Each card has a tiny icon, the value in large mono, and the label below.
>
> ### Two-column grid below hero
>
> **Left column (60%):**
> - "Top Agents by Reputation" leaderboard (top 10)
>   - Rank number, avatar, name, reputation stars, jobs completed, USDC earned
>   - Click row → goes to agent detail
>
> **Right column (40%):**
> - "Live Activity" stream (last 8 events)
>   - Each event: icon (🤖 for new agent, ⭐ for feedback, 💼 for new job, 💸 for completed), short text, time ago
>   - Auto-updates via `EventSource('/api/live')`
> - Below it: "Watch live feed →" link to `/live`
>
> ### CTA section at bottom
> - "Build your own AI agent on Arc"
> - 2 buttons: "View open-source demo" (links to your GitHub repo) and "Read ERC-8004 spec"
>
> ## Implementation
>
> Use Server Components for the initial render (fast first paint), then add a Client Component for the live feed widget.
>
> ```tsx
> // app/page.tsx (Server Component)
> import { Suspense } from 'react';
> import { HeroStats } from '@/components/home/HeroStats';
> import { TopAgents } from '@/components/home/TopAgents';
> import { LiveFeedWidget } from '@/components/home/LiveFeedWidget';
> import { CTASection } from '@/components/home/CTASection';
>
> export default function HomePage() {
>   return (
>     <main className="mx-auto max-w-7xl px-4 py-8">
>       <section className="mb-12">
>         <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">
>           Every AI agent on Arc, in one place.
>         </h1>
>         <p className="text-text-muted text-lg mb-8 max-w-2xl">
>           Browse identities, reputation, jobs, and earnings from every ERC-8004 agent on Arc testnet. Live-streamed from a Bangkok-based Arc node.
>         </p>
>         <Suspense fallback={<StatsSkeleton />}>
>           <HeroStats />
>         </Suspense>
>       </section>
>
>       <section className="grid gap-8 md:grid-cols-[1.6fr_1fr] mb-16">
>         <Suspense fallback={<TopAgentsSkeleton />}>
>           <TopAgents />
>         </Suspense>
>         <LiveFeedWidget />
>       </section>
>
>       <CTASection />
>     </main>
>   );
> }
> ```
>
> ### `components/home/HeroStats.tsx` (async Server Component)
>
> Fetch stats via API, render 4 cards.
>
> ### `components/home/TopAgents.tsx` (async Server Component)
>
> Fetch top 10 by reputation, render leaderboard rows.
>
> ### `components/home/LiveFeedWidget.tsx` (Client Component)
>
> ```tsx
> 'use client';
> import { useEffect, useState } from 'react';
>
> interface LiveEvent {
>   kind: string;
>   blockNumber: string;
>   timestamp: number;
>   // ...
> }
>
> export function LiveFeedWidget() {
>   const [events, setEvents] = useState<LiveEvent[]>([]);
>
>   useEffect(() => {
>     const es = new EventSource('/api/live');
>
>     es.addEventListener('arc_event', (e) => {
>       try {
>         const payload = JSON.parse((e as MessageEvent).data);
>         // payload.events is array
>         setEvents(prev => [...payload.events.map((ev: any) => ({ ...ev, timestamp: payload.timestamp })), ...prev].slice(0, 8));
>       } catch (err) {
>         console.error('Failed to parse live event', err);
>       }
>     });
>
>     es.onerror = (err) => {
>       console.warn('SSE error, reconnecting...', err);
>     };
>
>     return () => es.close();
>   }, []);
>
>   return (
>     <div className="border border-border rounded-lg p-4">
>       <div className="flex items-center justify-between mb-3">
>         <h3 className="font-semibold">Live Activity</h3>
>         <span className="flex items-center gap-1.5 text-xs text-success">
>           <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
>           Live
>         </span>
>       </div>
>       <ul className="space-y-2 text-sm">
>         {events.length === 0 && <li className="text-text-dim">Waiting for next event...</li>}
>         {events.map((e, i) => (
>           <li key={i} className="border-l-2 border-brand pl-3 py-1">
>             <EventLine event={e} />
>           </li>
>         ))}
>       </ul>
>       <a href="/live" className="text-brand text-sm mt-3 inline-block hover:underline">Watch live feed →</a>
>     </div>
>   );
> }
>
> function EventLine({ event }: { event: any }) {
>   const icons: Record<string, string> = {
>     AgentRegistered: '🤖',
>     FeedbackGiven: '⭐',
>     JobCreated: '💼',
>     JobCompleted: '💸',
>     JobSubmitted: '📦',
>     JobFunded: '🔒',
>   };
>   const labels: Record<string, string> = {
>     AgentRegistered: 'New agent registered',
>     FeedbackGiven: 'Reputation feedback recorded',
>     JobCreated: 'New job posted',
>     JobCompleted: 'Job completed, USDC released',
>     JobSubmitted: 'Deliverable submitted',
>     JobFunded: 'Job escrow funded',
>   };
>   return (
>     <div className="flex items-start gap-2">
>       <span>{icons[event.kind] ?? '⚡'}</span>
>       <div className="flex-1">
>         <p>{labels[event.kind] ?? event.kind}</p>
>         <p className="text-xs text-text-dim">Block {event.blockNumber}</p>
>       </div>
>     </div>
>   );
> }
> ```
>
> Make everything responsive (use Tailwind breakpoints). Test on mobile width (375px) and desktop (1280px+).

### YOU: View it

```bash
pnpm dev:web
# Open http://localhost:3000
```

✅ Should see a polished homepage. Open another terminal and run `npm run register` in your demo project — within 5s the live feed widget should show the new event.

---

## Step 5.5 — Agents Pages (Claude Code, 90 min)

### CLAUDE CODE PROMPT #5.5 — Agent list + detail

> Build `/agents` (list) and `/agents/[id]` (detail).
>
> ## `app/agents/page.tsx`
>
> Search bar at top. Filter pills: "All", "Validated only", "High rep (90+)". Sort dropdown: Recent / Reputation / Earnings / Jobs.
>
> Table:
> | # | Agent | Reputation | Capabilities | Owner | Jobs | Earned | |
> |---|---|---|---|---|---|---|---|
>
> Each row clickable → goes to `/agents/<id>`.
>
> Pagination at bottom (Prev / 1 / 2 / 3 / Next).
>
> Use Client Component for interactive filters (server-side rendering won't reflect URL state immediately).
>
> URL state: `?sort=reputation&search=...&page=2`
>
> Show skeleton rows while loading. Empty state if no results.
>
> ## `app/agents/[id]/page.tsx`
>
> ### Header section
> - Avatar (96x96)
> - Agent name + #ID
> - Reputation stars + score
> - Validation status badge ("✓ KYC VERIFIED" if PASSED, else "Unvalidated")
> - Below: agent_type badge, capability badges
> - Right side: "View on ArcScan →" button
>
> ### Stats row (4 cards)
> - Total Feedback Count
> - Jobs Completed
> - USDC Earned (large)
> - Registered (date)
>
> ### Tabs (use shadcn Tabs)
> 1. **Overview** — metadata JSON pretty-printed, owner address, registered tx
> 2. **Reputation** — timeline of all feedback events (paginated)
> 3. **Jobs** — table of jobs where this agent was provider
> 4. **Validations** — list of all validations with status + timestamps
>
> ### Sidebar (right, sticky on desktop)
> - Card: "Hire this agent" with a "Coming soon" placeholder button (real flow in roadmap)
> - Card: Owner info with address
> - Card: Quick links — ArcScan, IPFS metadata
>
> ```tsx
> // app/agents/[id]/page.tsx
> export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
>   const { id } = await params;
>   const data = await api.agent(id);  // server-side fetch
>
>   if (!data?.agent) return notFound();
>
>   return (
>     <main className="mx-auto max-w-7xl px-4 py-8">
>       <AgentHeader agent={data.agent} />
>       <AgentStats agent={data.agent} />
>       <div className="grid md:grid-cols-[1fr_320px] gap-8 mt-8">
>         <AgentTabs agent={data.agent} feedback={data.feedback} validations={data.validations} jobs={data.recentJobs} />
>         <AgentSidebar agent={data.agent} />
>       </div>
>     </main>
>   );
> }
> ```
>
> Make each component its own file in `src/components/agent/`. Use server components by default, client only where needed (tabs interaction).
>
> Test by visiting `/agents/14176` — should show your translation agent in full glory.

### YOU: Visit your agent page

```
http://localhost:3000/agents/14176
```

✅ Verify all data displays correctly. Screenshot this page — you'll use it in the launch tweet.

---

## Step 5.6 — Jobs Pages (Claude Code, 60 min)

### CLAUDE CODE PROMPT #5.6 — Jobs list + detail

> Build `/jobs` and `/jobs/[id]`.
>
> ## `app/jobs/page.tsx`
>
> Filter: Status pills (All / Open / Funded / Submitted / Completed / Rejected). Sort: Recent / Biggest budget.
>
> Table:
> | Job # | Description (truncated) | Status | Budget | Provider | Created |
> |---|---|---|---|---|---|
>
> Row click → `/jobs/<id>`.
>
> ## `app/jobs/[id]/page.tsx`
>
> ### Header
> - Job # large
> - StatusBadge
> - Budget USDC (large)
> - Description (full text)
>
> ### Visual timeline
> Show the job lifecycle as a horizontal stepper:
>
> ```
> Open ──→ Funded ──→ Submitted ──→ Completed
>  ●         ●         ●            ●
> ```
>
> Each step has icon + label + timestamp (when reached). Future steps are grayed out.
>
> ### Parties table
> | Role | Address |
> |---|---|
> | Client | (with Address component) |
> | Provider | (with Address + link to agent page if matched) |
> | Evaluator | (with Address) |
>
> ### Event timeline
> Vertical timeline of every event from `jobEvents` table:
> - `created`, `budgetSet`, `funded`, `submitted`, `completed`, `rejected`
> - Each item: timestamp, event name, actor address, tx hash with link
>
> ### Deliverable section
> If `deliverableHash` exists, show it in mono with link to ArcScan transaction.
>
> Test with your job: `/jobs/20049`.

### YOU: Visit your job

```
http://localhost:3000/jobs/20049
```

✅ Should see the full lifecycle timeline.

---

## Step 5.7 — Live Feed Page (Claude Code, 30 min)

### CLAUDE CODE PROMPT #5.7 — Live feed page

> Build `/live` as a full-screen real-time event stream.
>
> Same SSE pattern as homepage widget, but unlimited history (keep last 200 events in memory).
>
> Top bar:
> - "Live Feed" title
> - Connection indicator: green dot pulsing when connected, red when disconnected
> - Filter dropdown: All / New Agents / Feedback / Jobs / Completed
> - Pause button (stops scrolling new events)
> - "X events streamed in this session" counter
>
> Main list:
> Each event card:
> - Big icon based on type
> - Headline ("New translation agent registered" / "Job #20049 completed, 5 USDC paid")
> - Meta: timestamp, block #, tx hash link
> - Click → goes to relevant detail page
>
> Animations: new events fade in from top.
>
> Empty state: "Waiting for first event... 🤖" with pulsing animation.

---

## Step 5.8 — Stats Page (Claude Code, 60 min)

### CLAUDE CODE PROMPT #5.8 — Analytics dashboard

> Build `/stats` with charts using recharts.
>
> ## Add API for time-series
>
> First, add `/api/stats/timeseries` in `app/api/stats/timeseries/route.ts`:
>
> ```typescript
> // Query daily counts of agent registrations and jobs over last 30 days
> const result = await db.execute(sql`
>   WITH days AS (
>     SELECT generate_series(NOW()::date - INTERVAL '29 days', NOW()::date, INTERVAL '1 day')::date AS day
>   ),
>   agent_counts AS (
>     SELECT created_at::date AS day, COUNT(*) AS count
>     FROM agents WHERE created_at >= NOW() - INTERVAL '30 days'
>     GROUP BY 1
>   ),
>   job_counts AS (
>     SELECT created_at::date AS day, COUNT(*) AS count
>     FROM jobs WHERE created_at >= NOW() - INTERVAL '30 days'
>     GROUP BY 1
>   ),
>   usdc_volume AS (
>     SELECT created_at::date AS day, SUM(budget_usdc) AS volume
>     FROM jobs WHERE status = 'Completed' AND created_at >= NOW() - INTERVAL '30 days'
>     GROUP BY 1
>   )
>   SELECT
>     d.day,
>     COALESCE(a.count, 0) AS agents,
>     COALESCE(j.count, 0) AS jobs,
>     COALESCE(u.volume, 0) AS usdc
>   FROM days d
>   LEFT JOIN agent_counts a ON a.day = d.day
>   LEFT JOIN job_counts j ON j.day = d.day
>   LEFT JOIN usdc_volume u ON u.day = d.day
>   ORDER BY d.day;
> `);
> ```
>
> ## `/stats` page sections
>
> 1. **Line chart: Agent registrations per day** (last 30 days)
> 2. **Bar chart: Jobs per day** (stacked: completed vs other)
> 3. **Area chart: USDC volume per day**
> 4. **Top validators leaderboard** (most feedback given)
> 5. **Most active clients** (most jobs created)
> 6. **Capability distribution** (donut chart of agent_type counts)
>
> Use recharts. Style charts to match dark theme.

---

## Step 5.9 — Polish & Mobile (Claude Code + YOU, 60 min)

### CLAUDE CODE PROMPT #5.9 — Final polish

> Final polish pass. Address each:
>
> 1. **Loading states** — every async component must have a Skeleton variant
> 2. **Error boundaries** — wrap pages with error.tsx files
> 3. **Empty states** — list pages with no results show friendly message + CTA
> 4. **404 page** — `not-found.tsx` with link back to home
> 5. **Mobile responsiveness** — test every page at 375px width, fix anything broken
> 6. **Loading.tsx files** — fast skeleton screens for instant feedback
> 7. **Meta tags** — each page has unique `<title>` and OG image
> 8. **Accessibility** — keyboard nav works, ARIA labels on icons, color contrast passes
> 9. **Console errors** — open browser devtools, fix any errors/warnings
>
> Run Lighthouse: `Performance > 90`, `Accessibility > 95`.

### YOU: Test thoroughly

Test on:
- Desktop Chrome (1920x1080)
- Desktop Safari
- Mobile Chrome (real phone via local network)
- Mobile Safari (real iPhone)

Test scenarios:
- Cold load homepage
- Navigate to agent #14176
- Search for "translation"
- Click through to a job from agent's jobs tab
- Watch live feed for 1 minute
- Trigger an event in `~/arc-agent-demo` and watch it appear

---

## ✅ Phase 5 Definition of Done

- [ ] Homepage looks polished with live stats + leaderboard + feed
- [ ] `/agents` lists agents with working search/sort/filter
- [ ] `/agents/14176` shows your agent beautifully with all 4 tabs working
- [ ] `/jobs` lists jobs with status filter
- [ ] `/jobs/20049` shows your job with visual timeline
- [ ] `/live` streams events in real time with reconnect
- [ ] `/stats` shows charts with real data
- [ ] All pages render correctly on mobile (375px width)
- [ ] No console errors
- [ ] Loading skeletons appear during navigation
- [ ] Toast notifications work (copy address triggers toast)
- [ ] Lighthouse Performance > 90
- [ ] Committed to Git

### Git commit

```bash
git add .
git commit -m "feat: polished frontend UI (Phase 5)

- shadcn/ui dark theme with Arc-inspired palette
- Homepage: hero stats + live feed widget + top agents leaderboard
- /agents: searchable, filterable, sortable agent list
- /agents/[id]: detail page with 4 tabs (Overview, Reputation, Jobs, Validations)
- /jobs: filterable list with provider agent join
- /jobs/[id]: visual lifecycle timeline + event log
- /live: full-screen real-time event stream via SSE
- /stats: analytics dashboard with recharts (30-day time series)
- Mobile responsive, accessible, < 2s first paint"
git push
```

---

## 🔥 Common Issues & Fixes

### Live feed flickers on every event
You're causing full re-renders. Use `useCallback` and `React.memo` on event card components.

### Hydration mismatch warnings
Server renders `Date.now()` differently than client. Use `useEffect` to set timestamps client-side, or wrap in `<Suspense>`.

### Charts look bad in dark mode
Set chart colors explicitly via Tailwind classes or chart `stroke` props. Recharts defaults are light-mode.

### SSE doesn't work in Safari
Safari is stricter about SSE. Test with a different browser. The fallback is polling `/api/feed` every 5 seconds.

---

**Next →** Open `06_PHASE_6_DEPLOY.md` to take it live at arcagents.io.
