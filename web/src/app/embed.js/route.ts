// /embed.js — small JS that an agent drops on their own site. Reads
// data-chain + data-agent-id from its own <script> tag, inserts a tier-
// colored Caliber badge as an <a>-wrapped <img> linking to the Passport.
//
// Usage:
//   <script src="https://caliber.poko.blue/embed.js"
//           data-chain="arc" data-agent-id="1317" async></script>
//
// Result rendered at the script's location:
//   <a href="https://caliber.poko.blue/passport/arc/1317"
//      target="_blank" rel="noopener" class="caliber-badge">
//     <img src="https://caliber.poko.blue/badge/arc/1317"
//          alt="Caliber rating: Proven" width="200" height="56" />
//   </a>

const ORIGIN = 'https://caliber.poko.blue';

const JS = `(function () {
  try {
    var s = document.currentScript;
    if (!s) return;
    var chain = s.getAttribute('data-chain') || 'arc';
    var id = s.getAttribute('data-agent-id');
    if (!id) return;
    var v = s.getAttribute('data-version') || Math.floor(Date.now() / 300000); // 5-min bust
    var origin = '${ORIGIN}';

    var a = document.createElement('a');
    a.href = origin + '/passport/' + chain + '/' + id;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'caliber-badge';
    a.setAttribute('aria-label', 'Caliber rating');
    a.style.display = 'inline-block';
    a.style.lineHeight = '0';

    var img = document.createElement('img');
    img.src = origin + '/badge/' + chain + '/' + id + '?v=' + v;
    img.alt = 'Caliber rating';
    img.width = 200;
    img.height = 56;
    img.loading = 'lazy';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.border = '0';

    a.appendChild(img);
    s.parentNode.insertBefore(a, s);
  } catch (e) {
    // Best-effort. We don't want a broken badge to break the host site.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[caliber embed]', e);
    }
  }
})();`;

export const dynamic = 'force-static';

export async function GET() {
  return new Response(JS, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // Bust frequently — agents will mostly hot-link; we control the source.
      'cache-control': 'public, max-age=600, s-maxage=600',
      'access-control-allow-origin': '*',
    },
  });
}
