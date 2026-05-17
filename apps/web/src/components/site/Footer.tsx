export function Footer() {
  return (
    <footer className="border-t border-border mt-16 py-8 text-sm text-text-dim">
      <div className="mx-auto max-w-7xl px-4 grid gap-6 md:grid-cols-3">
        <div>
          <p className="font-semibold text-text mb-1">ArcAgents</p>
          <p>First agent explorer for Arc.</p>
          <p className="mt-2">Built solo from Bangkok 🇹🇭</p>
        </div>
        <div>
          <p className="font-semibold text-text mb-1">Resources</p>
          <ul className="space-y-1">
            <li>
              <a href="https://arc.network" target="_blank" rel="noreferrer" className="hover:text-text">
                Arc Network
              </a>
            </li>
            <li>
              <a href="https://docs.arc.network" target="_blank" rel="noreferrer" className="hover:text-text">
                Arc Docs
              </a>
            </li>
            <li>
              <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer" className="hover:text-text">
                ArcScan Testnet
              </a>
            </li>
            <li>
              <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noreferrer" className="hover:text-text">
                ERC-8004
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-text mb-1">Community</p>
          <ul className="space-y-1">
            <li>
              <a href="https://discord.gg/buildonarc" target="_blank" rel="noreferrer" className="hover:text-text">
                Arc Discord
              </a>
            </li>
            <li>
              <a href="https://community.arc.io" target="_blank" rel="noreferrer" className="hover:text-text">
                Arc House
              </a>
            </li>
            <li>
              <a href="https://github.com/huicom/arc-agents-explorer" target="_blank" rel="noreferrer" className="hover:text-text">
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 mt-6 text-center text-xs text-text-dim">
        Not affiliated with Circle or the Arc team. Built by an independent
        Architect.
      </div>
    </footer>
  );
}
