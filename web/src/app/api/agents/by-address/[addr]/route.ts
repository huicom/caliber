import { NextRequest, NextResponse } from 'next/server';
import { db, agents } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ addr: string }> },
) {
  const { addr } = await params;
  const address = decodeURIComponent(addr).toLowerCase();

  const [row] = await db
    .select({
      agentId: agents.agentId,
      chainId: agents.chainId,
      name: agents.name,
      ownerAddress: agents.ownerAddress,
    })
    .from(agents)
    .where(eq(sql`LOWER(${agents.ownerAddress})`, address))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });
  }

  return NextResponse.json({
    agentId: String(row.agentId),
    chainId: row.chainId,
    name: row.name,
    ownerAddress: row.ownerAddress,
  });
}