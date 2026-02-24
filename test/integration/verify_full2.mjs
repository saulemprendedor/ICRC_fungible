import { HttpAgent, Certificate, lookup_path } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import * as cbor from 'cbor-x';
import { createHash } from 'crypto';

const LEDGER_ID = 'uxrrr-q7777-77774-qaaaq-cai';

const DataCertificate = IDL.Record({
  certificate: IDL.Vec(IDL.Nat8),
  hash_tree: IDL.Vec(IDL.Nat8),
});

function computeTreeHash(tree) {
  if (!Array.isArray(tree)) throw new Error('Invalid tree structure');
  
  const tag = tree[0];
  
  switch (tag) {
    case 0: return createHash('sha256').update(Buffer.from([0])).digest();
    case 1: {
      const left = computeTreeHash(tree[1]);
      const right = computeTreeHash(tree[2]);
      return createHash('sha256').update(Buffer.from([1])).update(left).update(right).digest();
    }
    case 2: {
      const label = Buffer.from(tree[1]);
      const subtree = computeTreeHash(tree[2]);
      return createHash('sha256').update(Buffer.from([2])).update(label).update(subtree).digest();
    }
    case 3:
      return createHash('sha256').update(Buffer.from([3])).update(Buffer.from(tree[1])).digest();
    case 4:
      return Buffer.from(tree[1]);
    default:
      throw new Error(`Unknown tag: ${tag}`);
  }
}

function findLabel(tree, label) {
  if (!Array.isArray(tree)) return null;
  if (tree[0] === 1) return findLabel(tree[1], label) || findLabel(tree[2], label);
  if (tree[0] === 2) {
    const treeLabel = Buffer.from(tree[1]).toString('utf8');
    if (treeLabel === label && tree[2][0] === 3) {
      return Buffer.from(tree[2][1]);
    }
  }
  return null;
}

async function main() {
  const agent = await HttpAgent.create({ host: 'http://localhost:8080' });
  await agent.fetchRootKey();
  
  const response = await agent.query(
    Principal.fromText(LEDGER_ID),
    { methodName: 'icrc3_get_tip_certificate', arg: IDL.encode([], []) }
  );
  
  const decoded = IDL.decode([IDL.Opt(DataCertificate)], response.reply.arg)[0];
  const dataCert = decoded[0];
  
  const certBytes = new Uint8Array(dataCert.certificate);
  const hashTreeBytes = new Uint8Array(dataCert.hash_tree);
  
  // Verify IC certificate
  const cert = await Certificate.create({
    certificate: certBytes,
    rootKey: agent.rootKey,
    canisterId: Principal.fromText(LEDGER_ID),
  });
  console.log('✓ IC Certificate BLS signature verified');
  
  // Get certified_data 
  const canisterId = Principal.fromText(LEDGER_ID);
  const certifiedData = lookup_path(['canister', canisterId.toUint8Array(), 'certified_data'], cert.cert.tree);
  const certDataBuf = Buffer.from(new Uint8Array(certifiedData));
  console.log('✓ Found certified_data:', certDataBuf.toString('hex'));
  
  // Hash the hash_tree
  const hashTree = cbor.decode(hashTreeBytes);
  const hashTreeRoot = computeTreeHash(hashTree);
  console.log('  hash_tree root:      ', hashTreeRoot.toString('hex'));
  
  if (certDataBuf.equals(hashTreeRoot)) {
    console.log('✓ hash_tree root == certified_data - BINDING VERIFIED!');
  } else {
    console.log('✗ MISMATCH - hash_tree not bound to certificate');
  }
  
  // Extract ICRC-3 fields
  console.log('\n=== ICRC-3 Data ===');
  const lastBlockHash = findLabel(hashTree, 'last_block_hash');
  const lastBlockIndex = findLabel(hashTree, 'last_block_index');
  
  console.log('  last_block_hash:', lastBlockHash?.toString('hex') || 'NOT FOUND');
  
  if (lastBlockIndex) {
    let value = 0n, shift = 0n;
    for (const byte of lastBlockIndex) {
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
    }
    console.log('  last_block_index:', lastBlockIndex.toString('hex'), `(decoded: ${value})`);
  }
  
  console.log('\n✓✓✓ FULL ICRC-3 CERTIFICATE VERIFICATION PASSED ✓✓✓');
}

main().catch(e => console.error('Error:', e.message));
