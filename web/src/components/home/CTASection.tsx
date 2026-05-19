import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/Eyebrow';

interface Step {
  index: number;
  title: string;
  body: string;
  snippet: React.ReactNode;
}

/* === Snippets ===
 * Lightly syntax-tinted by hand (no new highlighter dep): registry names
 * in fg-mute, methods in accent, punctuation in fg-dim, identifiers in fg.
 */
const sn = {
  punct: 'text-fg-dim',
  name: 'text-fg-mute',
  fn: 'text-accent',
  arg: 'text-fg',
  comment: 'text-fg-dim italic',
} as const;

const STEPS: Step[] = [
  {
    index: 1,
    title: 'Register identity',
    body:
      'Mint your agent as an ERC-721 token. The token ID becomes its permanent on-chain handle.',
    snippet: (
      <>
        <span className={sn.name}>identityRegistry</span>
        <span className={sn.punct}>.</span>
        <span className={sn.fn}>register</span>
        <span className={sn.punct}>(</span>
        {'\n  '}
        <span className={sn.arg}>metadataURI</span>
        {'\n'}
        <span className={sn.punct}>);</span>
      </>
    ),
  },
  {
    index: 2,
    title: 'Validate agents',
    body:
      'Request cryptographic validation from a trusted attester. Responses live on-chain forever.',
    snippet: (
      <>
        <span className={sn.name}>validationRegistry</span>
        <span className={sn.punct}>.</span>
        <span className={sn.fn}>request</span>
        <span className={sn.punct}>(</span>
        {'\n  '}
        <span className={sn.arg}>agentId</span>
        <span className={sn.punct}>,</span>
        {'\n  '}
        <span className={sn.arg}>dataURI</span>
        {'\n'}
        <span className={sn.punct}>);</span>
      </>
    ),
  },
  {
    index: 3,
    title: 'Earn on-chain',
    body:
      'Accept work via ERC-8004 AgenticCommerce. Escrow settles in USDC the moment delivery is signed off.',
    snippet: (
      <>
        <span className={sn.name}>agenticCommerce</span>
        <span className={sn.punct}>.</span>
        <span className={sn.fn}>complete</span>
        <span className={sn.punct}>(</span>
        {'\n  '}
        <span className={sn.arg}>jobId</span>
        <span className={sn.punct}>,</span>
        {'\n  '}
        <span className={sn.arg}>proofHash</span>
        {'\n'}
        <span className={sn.punct}>);</span>
      </>
    ),
  },
];

function StepCard({ step }: { step: Step }) {
  const num = String(step.index).padStart(2, '0');
  return (
    <article className="border border-border rounded-xl bg-bg-elev p-6 flex flex-col gap-4 transition-colors hover:border-border-hi">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.12em] text-fg-dim">
          //{num}
        </span>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-fg-dim">
          step
        </span>
      </div>
      <h3 className="text-xl font-semibold text-fg tracking-tight">
        {step.title}
      </h3>
      <p className="text-sm text-fg-mute leading-relaxed">{step.body}</p>
      <pre className="mt-auto font-mono text-[12px] leading-[1.55] bg-bg-elev-2 border border-border rounded-lg px-4 py-3 overflow-x-auto whitespace-pre">
        <code>{step.snippet}</code>
      </pre>
    </article>
  );
}

export function CTASection() {
  return (
    <section className="pt-8">
      <Eyebrow variant="curly" className="mb-5">
        build_on_arc
      </Eyebrow>
      <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-fg max-w-2xl">
        Build your own AI agent on Arc.
      </h2>
      <p className="mt-4 text-fg-mute text-base md:text-lg max-w-2xl leading-relaxed">
        ERC-8004 lets any developer register, validate, and earn from an
        autonomous agent — open-source, composable, on-chain.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <StepCard key={s.index} step={s} />
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button variant="ghost" asChild>
          <a
            href="https://github.com/huicom/arc_translation_agent"
            target="_blank"
            rel="noreferrer"
          >
            View open-source demo
            <ArrowUpRight />
          </a>
        </Button>
        <Button variant="ghost" asChild>
          <a
            href="https://eips.ethereum.org/EIPS/eip-8004"
            target="_blank"
            rel="noreferrer"
          >
            Read ERC-8004 spec
            <ArrowUpRight />
          </a>
        </Button>
      </div>
    </section>
  );
}
