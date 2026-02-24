#!/usr/bin/env node
// Step-by-step hash computation with debug output

import { createHash } from 'crypto';

// Domain separators from IC spec
const DOMAIN_IC_HASHTREE_EMPTY = 'ic-hashtree-empty';
const DOMAIN_IC_HASHTREE_FORK = 'ic-hashtree-fork';
const DOMAIN_IC_HASHTREE_LABELED = 'ic-hashtree-labeled';
const DOMAIN_IC_HASHTREE_LEAF = 'ic-hashtree-leaf';

function domainSeparator(domain) {
    return Buffer.concat([Buffer.from([domain.length]), Buffer.from(domain)]);
}

function hashLeaf(data) {
    const sep = domainSeparator(DOMAIN_IC_HASHTREE_LEAF);
    console.log(`  hashLeaf input: ${Buffer.isBuffer(data) ? data.toString('hex') : data}`);
    console.log(`  hashLeaf separator: ${sep.toString('hex')} ("${DOMAIN_IC_HASHTREE_LEAF}" len=${DOMAIN_IC_HASHTREE_LEAF.length})`);
    const h = createHash('sha256');
    h.update(sep);
    h.update(data);
    const result = h.digest();
    console.log(`  hashLeaf result: ${result.toString('hex')}`);
    return result;
}

function hashLabeled(label, subtreeHash) {
    const sep = domainSeparator(DOMAIN_IC_HASHTREE_LABELED);
    const labelBuf = typeof label === 'string' ? Buffer.from(label) : label;
    console.log(`  hashLabeled label: "${labelBuf.toString()}" (${labelBuf.toString('hex')})`);
    console.log(`  hashLabeled subtreeHash: ${subtreeHash.toString('hex')}`);
    console.log(`  hashLabeled separator: ${sep.toString('hex')}`);
    const h = createHash('sha256');
    h.update(sep);
    h.update(labelBuf);
    h.update(subtreeHash);
    const result = h.digest();
    console.log(`  hashLabeled result: ${result.toString('hex')}`);
    return result;
}

function hashFork(left, right) {
    const sep = domainSeparator(DOMAIN_IC_HASHTREE_FORK);
    console.log(`  hashFork left: ${left.toString('hex')}`);
    console.log(`  hashFork right: ${right.toString('hex')}`);
    console.log(`  hashFork separator: ${sep.toString('hex')}`);
    const h = createHash('sha256');
    h.update(sep);
    h.update(left);
    h.update(right);
    const result = h.digest();
    console.log(`  hashFork result: ${result.toString('hex')}`);
    return result;
}

console.log('=== Step-by-step hash computation ===\n');

// Data from the hash_tree:
// Fork(
//   Labeled("last_block_hash", Leaf(0c9b560047c2d582ff3f854da8487312ccab4d2d74bedea432990af054214367)),
//   Labeled("last_block_index", Leaf(00))
// )

const lastBlockHash = Buffer.from('0c9b560047c2d582ff3f854da8487312ccab4d2d74bedea432990af054214367', 'hex');
const lastBlockIndex = Buffer.from('00', 'hex');

console.log('Step 1: Hash the last_block_hash leaf');
const hashLeafBlockHash = hashLeaf(lastBlockHash);

console.log('\nStep 2: Hash the last_block_index leaf');
const hashLeafBlockIndex = hashLeaf(lastBlockIndex);

console.log('\nStep 3: Hash the labeled node for last_block_hash');
const hashLabeledBlockHash = hashLabeled('last_block_hash', hashLeafBlockHash);

console.log('\nStep 4: Hash the labeled node for last_block_index');
const hashLabeledBlockIndex = hashLabeled('last_block_index', hashLeafBlockIndex);

console.log('\nStep 5: Hash the fork');
const rootHash = hashFork(hashLabeledBlockHash, hashLabeledBlockIndex);

console.log('\n=== Final Results ===');
console.log('Computed root hash:', rootHash.toString('hex'));
console.log('Expected (from Motoko):', '7f807290d8d621d23e253ab70b52255c46a15dc9be05a48127cd1acc26eb9d7f');

if (rootHash.toString('hex') === '7f807290d8d621d23e253ab70b52255c46a15dc9be05a48127cd1acc26eb9d7f') {
    console.log('\n✅ MATCH!');
} else {
    console.log('\n❌ NO MATCH');
    
    // Let's check what Motoko's debug output shows
    console.log('\n=== Comparing with Motoko pruned values ===');
    console.log('Motoko says hashLabeledBlockHash pruned = 4dc75fd8cb279803f12292fadc82d0a35620e51e5d923e632acc2e05769841ae');
    console.log('Motoko says hashLabeledBlockIndex pruned = 24f166b9e9b3b976fd70fae270cd68566df41190e8bedd755917c2180db9b50d');
    console.log('');
    console.log('Our hashLabeledBlockHash =', hashLabeledBlockHash.toString('hex'));
    console.log('Our hashLabeledBlockIndex =', hashLabeledBlockIndex.toString('hex'));
}
