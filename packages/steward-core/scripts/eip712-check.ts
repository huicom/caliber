// Self-contained assertions for the Steward EIP-712 module (Phase 2, WS-0).
//
//   tsx scripts/eip712-check.ts
//
// No test framework — a tiny assert helper, exit 1 on the first failure.
// Covers: build/sign/verify a DeliverySpec (true), tamper a field (false),
// the deliverySpecHash is a 32-byte hex; build/sign an EvidenceAttestation and
// verifyEvidence → valid=true with the right recovered signer, valid=false for
// a wrong expectedSigner.

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { isHex } from 'viem';
import {
  caliberDomain,
  buildDeliverySpec,
  deliverySpecHash,
  signDeliverySpec,
  verifyDeliverySpecSig,
  buildEvidenceAttestation,
  signEvidenceAttestation,
  verifyEvidence,
  VERDICT,
  type ConformanceExpect,
} from '../src/index.js';

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok: ${msg}`);
}

async function main() {
  const domain = caliberDomain('arc');
  console.log(`domain = ${JSON.stringify(domain)}`);

  // --- DeliverySpec ---------------------------------------------------------
  console.log('\nDeliverySpec:');
  const buyerAcct = privateKeyToAccount(generatePrivateKey());
  const sellerAcct = privateKeyToAccount(generatePrivateKey());

  const expect: ConformanceExpect = {
    json: true,
    maxBytes: 65536,
    deadlineMs: 5000,
    okField: true,
  };

  const spec = buildDeliverySpec({
    chain: 'arc',
    buyer: buyerAcct.address,
    seller: sellerAcct.address,
    sellerUrl: 'https://Seller.Example.com/api/quote/',
    expect,
    maxBytes: 65536,
    deadlineMs: 5000,
    requireJson: true,
    requireOkField: true,
    validUntil: Math.floor(Date.now() / 1000) + 600,
    nonce: 1,
  });
  console.log(`  spec.sellerUrlHash = ${spec.sellerUrlHash}`);
  console.log(`  spec.schemaHash    = ${spec.schemaHash}`);

  const sig = await signDeliverySpec(spec, buyerAcct, domain);
  const okSig = await verifyDeliverySpecSig(spec, sig, buyerAcct.address, domain);
  assert(okSig === true, 'valid buyer signature verifies true');

  const wrongSigner = await verifyDeliverySpecSig(
    spec,
    sig,
    sellerAcct.address,
    domain,
  );
  assert(wrongSigner === false, 'verifying against a different signer is false');

  // tamper a field -> signature no longer verifies
  const tampered = { ...spec, maxBytes: spec.maxBytes + 1 };
  const tamperedOk = await verifyDeliverySpecSig(
    tampered,
    sig,
    buyerAcct.address,
    domain,
  );
  assert(tamperedOk === false, 'tampered maxBytes fails verification');

  // deliverySpecHash is a 32-byte hex
  const specHash = deliverySpecHash(spec, domain);
  console.log(`  deliverySpecHash = ${specHash}`);
  assert(
    isHex(specHash) && specHash.length === 66,
    'deliverySpecHash is a 32-byte (66-char) hex',
  );

  // seller also signs the same spec (used for the evidence commitments)
  const sellerSpecSig = await signDeliverySpec(spec, sellerAcct, domain);
  assert(
    (await verifyDeliverySpecSig(spec, sellerSpecSig, sellerAcct.address, domain)) ===
      true,
    'seller signature over the same spec verifies true',
  );

  // --- EvidenceAttestation --------------------------------------------------
  console.log('\nEvidenceAttestation:');
  const stewardAcct = privateKeyToAccount(generatePrivateKey());
  const otherAcct = privateKeyToAccount(generatePrivateKey());

  const att = buildEvidenceAttestation({
    chain: 'arc',
    paymentId: 42,
    agentId: 1234,
    specHash,
    // sha256 of delivered bytes — any 32-byte hex stands in here
    responseHash:
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    verdict: VERDICT.CONFORMS,
    verifyingTier: 1,
    buyerSpecSignature: sig,
    sellerSpecSignature: sellerSpecSig,
    methodologyVersion: '2.0.1',
    nonce: 7,
  });
  console.log(`  att.buyerSig (commitment)  = ${att.buyerSig}`);
  console.log(`  att.sellerSig (commitment) = ${att.sellerSig}`);
  console.log(`  att.methodologyVersion     = ${att.methodologyVersion}`);

  const envelope = await signEvidenceAttestation(att, stewardAcct, domain);

  const good = await verifyEvidence(envelope, {
    expectedSigner: stewardAcct.address,
    domain,
  });
  console.log(`  verifyEvidence(correct signer) = ${JSON.stringify(good)}`);
  assert(good.valid === true, 'evidence verifies valid=true for the real signer');
  assert(
    good.recovered?.toLowerCase() === stewardAcct.address.toLowerCase(),
    'recovered signer == steward account',
  );

  const bad = await verifyEvidence(envelope, {
    expectedSigner: otherAcct.address,
    domain,
  });
  assert(bad.valid === false, 'evidence verifies valid=false for a wrong signer');
  assert(
    bad.recovered?.toLowerCase() === stewardAcct.address.toLowerCase(),
    'recovered signer still resolves to the true signer even when expected is wrong',
  );

  // malformed verdict is rejected even with a valid signature
  const badVerdictAtt = buildEvidenceAttestation({
    chain: 'arc',
    paymentId: 43,
    agentId: 1234,
    specHash,
    responseHash:
      '0x2222222222222222222222222222222222222222222222222222222222222222',
    verdict: 9,
    verifyingTier: 0,
    buyerSpecSignature: sig,
    sellerSpecSignature: sellerSpecSig,
    methodologyVersion: '2.0.1',
    nonce: 8,
  });
  const badVerdictEnv = await signEvidenceAttestation(
    badVerdictAtt,
    stewardAcct,
    domain,
  );
  const badVerdict = await verifyEvidence(badVerdictEnv, {
    expectedSigner: stewardAcct.address,
    domain,
  });
  assert(
    badVerdict.valid === false,
    'malformed verdict (9) makes a correctly-signed envelope invalid',
  );

  console.log(`\nALL PASS (${passed} assertions)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
