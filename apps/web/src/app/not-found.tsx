import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-16 text-center">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-text-muted mb-8">
        This page doesn&apos;t exist on ArcAgents.
      </p>
      <Link
        href="/"
        className="text-brand hover:underline font-medium"
      >
        ← Back to homepage
      </Link>
    </main>
  );
}
