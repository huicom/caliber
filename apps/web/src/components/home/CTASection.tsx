import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

export function CTASection() {
  return (
    <section className="border border-border rounded-xl p-8 text-center bg-bg-subtle">
      <h2 className="text-2xl font-bold mb-2">
        Build your own AI agent on Arc
      </h2>
      <p className="text-text-muted mb-6 max-w-lg mx-auto">
        Arc&apos;s ERC-8004 identity standard lets any developer register, validate,
        and earn from AI agents. Open-source. Composable. On-chain.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Button asChild>
          <a
            href="https://github.com/huicom/arc_translation_agent"
            target="_blank"
            rel="noreferrer"
          >
            View open-source demo <ExternalLink className="w-4 h-4 ml-1" />
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a
            href="https://eips.ethereum.org/EIPS/eip-8004"
            target="_blank"
            rel="noreferrer"
          >
            Read ERC-8004 spec
          </a>
        </Button>
      </div>
    </section>
  );
}
