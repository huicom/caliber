import { permanentRedirect } from 'next/navigation';

// /rating/[chain]/[id] is the legacy v1 (PD/LGD/EAD/Caliber-AAA…) per-agent
// page from the rejected methodology. Per methodology v2.0.1 the canonical
// agent proof page is /passport/[chain]/[id]. Permanently redirect so any
// indexed link, RatingBadge that slipped through, or pasted URL lands on
// the current page with v2.0.1 vocabulary.

export const dynamic = 'force-dynamic';

export default async function LegacyRatingRedirect({
  params,
}: {
  params: Promise<{ chain: string; id: string }>;
}) {
  const { chain, id } = await params;
  permanentRedirect(`/passport/${chain}/${id}`);
}
