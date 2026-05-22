ALTER TABLE "agents" ADD COLUMN "embedding" vector(384);
--> statement-breakpoint
-- ivfflat index for cosine-distance similarity. lists=20 is a reasonable
-- starting point at our scale (~2K embedded agents); raise to sqrt(N)
-- when the population grows. Use vector_cosine_ops to match the engine's
-- distance function (1 - cosine(a, b)).
CREATE INDEX "idx_agents_embedding_cosine" ON "agents"
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 20);