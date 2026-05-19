const BASE = process.env.API_BASE ?? 'http://localhost:3000';

interface Test {
  name: string;
  path: string;
  check: (res: Record<string, unknown>) => boolean | string;
}

const tests: Test[] = [
  {
    name: 'Health',
    path: '/api/health',
    check: (r) =>
      r.status === 'ok' || `status: ${String(r.status)}`,
  },
  {
    name: 'Stats',
    path: '/api/stats',
    check: (r) => {
      const t = r.totals as Record<string, unknown> | undefined;
      return typeof t?.agents === 'number' || 'no totals.agents';
    },
  },
  {
    name: 'List Agents (recent)',
    path: '/api/agents?sort=recent&limit=5',
    check: (r) => Array.isArray(r.agents) || 'agents not array',
  },
  {
    name: 'List Agents (reputation)',
    path: '/api/agents?sort=reputation&limit=5',
    check: (r) => Array.isArray(r.agents) || 'agents not array',
  },
  {
    name: 'Search Agents',
    path: '/api/agents?search=translation',
    check: (r) => Array.isArray(r.agents) || 'agents not array',
  },
  {
    name: 'Agent Detail',
    path: '/api/agents/14176',
    check: (r) => {
      const a = r.agent as Record<string, unknown> | undefined;
      return a?.agentId === '14176' || `agentId: ${String(a?.agentId)}`;
    },
  },
  {
    name: 'Agent Feedback',
    path: '/api/agents/14176/feedback',
    check: (r) => Array.isArray(r.feedback) || 'feedback not array',
  },
  {
    name: 'List Jobs',
    path: '/api/jobs?sort=recent&limit=5',
    check: (r) => Array.isArray(r.jobs) || 'jobs not array',
  },
  {
    name: 'Job Detail',
    path: '/api/jobs/20049',
    check: (r) => {
      const j = r.job as Record<string, unknown> | undefined;
      return j?.jobId === '20049' || `jobId: ${String(j?.jobId)}`;
    },
  },
  {
    name: 'Feed',
    path: '/api/feed',
    check: (r) => Array.isArray(r.feed) || 'feed not array',
  },
];

async function run() {
  let pass = 0;
  let fail = 0;

  console.log(`\n🧪 Testing API at ${BASE}\n`);
  for (const t of tests) {
    try {
      const res = await fetch(BASE + t.path);
      const json = (await res.json()) as Record<string, unknown>;
      const result = t.check(json);
      if (result === true) {
        console.log(`  ✅ ${t.name}`);
        pass++;
      } else {
        console.log(`  ❌ ${t.name}: ${result}`);
        fail++;
      }
    } catch (err) {
      console.log(`  ❌ ${t.name}: ${(err as Error).message}`);
      fail++;
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

run();
