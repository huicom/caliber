// Lazy-loaded embedding pipeline using @xenova/transformers (all-MiniLM-L6-v2).
// 384-dim sentence embeddings, runs on CPU via ONNX Runtime. First call
// downloads + initializes the model (~80 MB); subsequent calls are ~5-20 ms.
//
// Shared by the F2-style backfill script and the runtime search API.

type FeatureExtractionPipeline = (
  text: string | string[],
  options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    // Cache the model under the repo's web/.cache so the production server
    // doesn't have to re-download on each cold start.
    env.cacheDir = `${process.cwd()}/.cache/transformers`;
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    return (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as unknown as FeatureExtractionPipeline;
  })();
  return pipelinePromise;
}

export async function embedText(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const out = await pipe(text.slice(0, 4000), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const pipe = await getPipeline();
  // The pipeline supports batch input but returns a flattened tensor; we
  // call one-at-a-time to keep memory bounded for the small numbers we
  // handle. At our corpus size (~2K) total time is still under 2 min.
  const out: number[][] = [];
  for (const t of texts) {
    const r = await pipe(t.slice(0, 4000), { pooling: 'mean', normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

// Build the embedding input from an agent's natural-language description.
// Concatenates name + agent_type + capabilities + description. Whichever
// of these are present.
export function agentEmbeddingInput(row: {
  name?: string | null;
  agent_type?: string | null;
  capabilities?: string[] | null;
  description?: string | null;
}): string {
  const parts: string[] = [];
  if (row.name) parts.push(row.name);
  if (row.agent_type) parts.push(`type: ${row.agent_type}`);
  if (row.capabilities && row.capabilities.length > 0) {
    parts.push(`capabilities: ${row.capabilities.join(', ')}`);
  }
  if (row.description) parts.push(row.description);
  return parts.join(' · ');
}

// Pgvector literal — turns a JS number[] into the '[1,2,3,...]' string
// pgvector expects. Use with raw SQL: `embedding = ${toVectorLiteral(...)}::vector`
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}
