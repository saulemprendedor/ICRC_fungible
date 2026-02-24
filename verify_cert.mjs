#!/usr/bin/env node
// Complete certificate verification for ICRC-3 following IC spec

import { createHash } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Domain separators from IC spec
const DOMAIN_IC_HASHTREE_EMPTY = 'ic-hashtree-empty';
const DOMAIN_IC_HASHTREE_FORK = 'ic-hashtree-fork';
const DOMAIN_IC_HASHTREE_LABELED = 'ic-hashtree-labeled';
const DOMAIN_IC_HASHTREE_LEAF = 'ic-hashtree-leaf';

// Hash functions exactly as per IC spec
function domainSeparator(domain) {
    // Domain separator: single byte length followed by domain string
    return Buffer.concat([Buffer.from([domain.length]), Buffer.from(domain)]);
}

function hashEmpty() {
    const h = createHash('sha256');
    h.update(domainSeparator(DOMAIN_IC_HASHTREE_EMPTY));
    return h.digest();
}

function hashFork(left, right) {
    const h = createHash('sha256');
    h.update(domainSeparator(DOMAIN_IC_HASHTREE_FORK));
    h.update(left);
    h.update(right);
    return h.digest();
}

function hashLabeled(label, subtreeHash) {
    const h = createHash('sha256');
    h.update(domainSeparator(DOMAIN_IC_HASHTREE_LABELED));
    h.update(typeof label === 'string' ? Buffer.from(label) : label);
    h.update(subtreeHash);
    return h.digest();
}

function hashLeaf(data) {
    const h = createHash('sha256');
    h.update(domainSeparator(DOMAIN_IC_HASHTREE_LEAF));
    h.update(data);
    return h.digest();
}

// Compute root hash of MixedHashTree (the "reconstruct" function from IC spec)
function reconstruct(tree) {
    if (tree === null || tree === undefined) {
        return hashEmpty();
    }
    
    // Handle array format from CBOR: [tag, ...data]
    if (Array.isArray(tree)) {
        const tag = tree[0];
        switch (tag) {
            case 0: // Empty
                return hashEmpty();
            case 1: // Fork
                return hashFork(reconstruct(tree[1]), reconstruct(tree[2]));
            case 2: // Labeled
                const label = tree[1];
                const subtree = tree[2];
                return hashLabeled(label, reconstruct(subtree));
            case 3: // Leaf
                return hashLeaf(tree[1]);
            case 4: // Pruned - the data IS the hash
                return Buffer.from(tree[1]);
            default:
                throw new Error(`Unknown tree tag: ${tag}`);
        }
    }
    
    throw new Error(`Unknown tree format: ${JSON.stringify(tree)}`);
}

// Parse CBOR hex to JS object
function parseCBOR(hexString) {
    // We need a CBOR parser - let's use a simple inline one for the hash tree format
    const bytes = Buffer.from(hexString.replace(/\s/g, ''), 'hex');
    return decodeCBOR(bytes, 0)[0];
}

function decodeCBOR(buf, offset) {
    const initial = buf[offset];
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;
    
    let value, length;
    
    // Get length/value
    if (additionalInfo < 24) {
        value = additionalInfo;
        length = 1;
    } else if (additionalInfo === 24) {
        value = buf[offset + 1];
        length = 2;
    } else if (additionalInfo === 25) {
        value = buf.readUInt16BE(offset + 1);
        length = 3;
    } else if (additionalInfo === 26) {
        value = buf.readUInt32BE(offset + 1);
        length = 5;
    } else if (additionalInfo === 27) {
        // 64-bit - for simplicity read as number (may lose precision for very large values)
        const high = buf.readUInt32BE(offset + 1);
        const low = buf.readUInt32BE(offset + 5);
        value = high * 0x100000000 + low;
        length = 9;
    } else {
        throw new Error(`Unsupported additional info: ${additionalInfo}`);
    }
    
    switch (majorType) {
        case 0: // Unsigned integer
            return [value, offset + length];
            
        case 2: // Byte string
            const byteData = buf.slice(offset + length, offset + length + value);
            return [byteData, offset + length + value];
            
        case 3: // Text string
            const textData = buf.slice(offset + length, offset + length + value).toString('utf8');
            return [textData, offset + length + value];
            
        case 4: // Array
            const arr = [];
            let pos = offset + length;
            for (let i = 0; i < value; i++) {
                const [item, newPos] = decodeCBOR(buf, pos);
                arr.push(item);
                pos = newPos;
            }
            return [arr, pos];
            
        case 5: // Map
            const map = {};
            let mapPos = offset + length;
            for (let i = 0; i < value; i++) {
                const [key, keyPos] = decodeCBOR(buf, mapPos);
                const [val, valPos] = decodeCBOR(buf, keyPos);
                map[key] = val;
                mapPos = valPos;
            }
            return [map, mapPos];
            
        case 6: // Tag
            // Tag value is in 'value', content follows
            // We skip the tag and just return the content
            // Tag 55799 (0xd9d9f7) is CBOR self-describe tag
            return decodeCBOR(buf, offset + length);
            
        default:
            throw new Error(`Unsupported major type: ${majorType}`);
    }
}

async function main() {
    console.log('=== ICRC-3 Certificate Verification ===\n');
    
    // Get the certificate from the canister
    const canisterId = 'uzt4z-lp777-77774-qaabq-cai';
    console.log(`Fetching tip certificate from ${canisterId}...`);
    
    try {
        const { stdout } = await execAsync(`dfx canister call ${canisterId} icrc3_get_tip_certificate '()' --output json`);
        const result = JSON.parse(stdout);
        
        if (!result || result.length === 0 || !result[0]) {
            console.log('No certificate returned (ledger may be empty)');
            return;
        }
        
        const cert = result[0];
        const certificateHex = Buffer.from(cert.certificate).toString('hex');
        const hashTreeHex = Buffer.from(cert.hash_tree).toString('hex');
        
        console.log('\n--- Raw Data ---');
        console.log('certificate (first 100 hex):', certificateHex.slice(0, 100) + '...');
        console.log('hash_tree hex:', hashTreeHex);
        
        // Parse the hash_tree CBOR
        console.log('\n--- Parsing hash_tree CBOR ---');
        const hashTree = parseCBOR(hashTreeHex);
        console.log('Parsed tree structure:', JSON.stringify(hashTree, (k, v) => {
            if (Buffer.isBuffer(v)) {
                return `<Buffer ${v.toString('hex').slice(0, 40)}${v.length > 20 ? '...' : ''}>`;
            }
            return v;
        }, 2));
        
        // Compute the root hash
        console.log('\n--- Computing root hash ---');
        const rootHash = reconstruct(hashTree);
        console.log('Computed root hash:', rootHash.toString('hex'));
        
        // Parse the certificate to get certified_data
        console.log('\n--- Parsing certificate CBOR ---');
        const certificate = parseCBOR(certificateHex);
        console.log('Certificate keys:', Object.keys(certificate));
        
        // The certificate contains a 'tree' field which is also a hash tree
        if (certificate.tree) {
            console.log('\nCertificate tree structure:', JSON.stringify(certificate.tree, (k, v) => {
                if (Buffer.isBuffer(v)) {
                    return `<Buffer ${v.toString('hex').slice(0, 40)}${v.length > 20 ? '...' : ''}>`;
                }
                return v;
            }, 2).slice(0, 2000) + '...');
            
            // Look up certified_data in the certificate tree
            // Path: canister -> <canister_id> -> certified_data
            console.log('\n--- Looking up certified_data ---');
            const certTree = certificate.tree;
            const certifiedData = lookupPath(certTree, ['canister', Buffer.from(canisterId.replace(/-/g, ''), 'hex'), 'certified_data']);
            
            if (certifiedData) {
                console.log('certified_data from certificate:', certifiedData.toString('hex'));
                console.log('computed root hash:            ', rootHash.toString('hex'));
                
                if (rootHash.equals(certifiedData)) {
                    console.log('\n✅ VERIFICATION PASSED: hash_tree.digest() === certified_data');
                } else {
                    console.log('\n❌ VERIFICATION FAILED: hashes do not match');
                }
            } else {
                console.log('Could not find certified_data in certificate tree');
                console.log('Trying to decode canister ID...');
                
                // The canister ID needs to be decoded differently
                const principalBytes = decodePrincipal(canisterId);
                console.log('Principal bytes:', principalBytes.toString('hex'));
                
                const certifiedData2 = lookupPath(certTree, ['canister', principalBytes, 'certified_data']);
                if (certifiedData2) {
                    console.log('certified_data from certificate:', certifiedData2.toString('hex'));
                    console.log('computed root hash:            ', rootHash.toString('hex'));
                    
                    if (rootHash.equals(certifiedData2)) {
                        console.log('\n✅ VERIFICATION PASSED: hash_tree.digest() === certified_data');
                    } else {
                        console.log('\n❌ VERIFICATION FAILED: hashes do not match');
                    }
                } else {
                    console.log('Still could not find certified_data');
                    
                    // Let's walk the tree manually
                    console.log('\n--- Manual tree walk ---');
                    walkTree(certTree, '');
                }
            }
        }
        
    } catch (err) {
        console.error('Error:', err.message);
        if (err.stderr) console.error('stderr:', err.stderr);
    }
}

// Decode a textual principal ID to bytes
function decodePrincipal(textual) {
    // Remove dashes
    const withoutDashes = textual.replace(/-/g, '');
    
    // Base32 decode (IC uses a specific variant)
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
    const chars = withoutDashes.toLowerCase().split('');
    
    let bits = '';
    for (const c of chars) {
        const idx = ALPHABET.indexOf(c);
        if (idx === -1) throw new Error(`Invalid base32 character: ${c}`);
        bits += idx.toString(2).padStart(5, '0');
    }
    
    // Pad to multiple of 8
    while (bits.length % 8 !== 0) {
        bits = bits.slice(0, -1);
    }
    
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    
    // First 4 bytes are CRC32, rest is the principal
    const principalBytes = Buffer.from(bytes.slice(4));
    return principalBytes;
}

// Look up a path in a hash tree
function lookupPath(tree, path) {
    if (path.length === 0) {
        // We're at the target - extract the value
        if (Array.isArray(tree) && tree[0] === 3) {
            return tree[1]; // Leaf value
        }
        return tree;
    }
    
    const [first, ...rest] = path;
    const labelToFind = typeof first === 'string' ? Buffer.from(first) : first;
    
    if (!Array.isArray(tree)) return null;
    
    const tag = tree[0];
    
    if (tag === 2) {
        // Labeled node
        const label = tree[1];
        const labelBuf = typeof label === 'string' ? Buffer.from(label) : label;
        
        if (labelBuf.equals(labelToFind)) {
            return lookupPath(tree[2], rest);
        }
        return null;
    }
    
    if (tag === 1) {
        // Fork - search both branches
        const left = lookupPath(tree[1], path);
        if (left !== null) return left;
        return lookupPath(tree[2], path);
    }
    
    return null;
}

function walkTree(tree, indent) {
    if (!Array.isArray(tree)) {
        console.log(`${indent}value: ${tree}`);
        return;
    }
    
    const tag = tree[0];
    switch (tag) {
        case 0:
            console.log(`${indent}Empty`);
            break;
        case 1:
            console.log(`${indent}Fork:`);
            console.log(`${indent}  left:`);
            walkTree(tree[1], indent + '    ');
            console.log(`${indent}  right:`);
            walkTree(tree[2], indent + '    ');
            break;
        case 2:
            const label = tree[1];
            const labelStr = Buffer.isBuffer(label) ? label.toString('utf8') : label;
            const labelHex = Buffer.isBuffer(label) ? label.toString('hex') : Buffer.from(label).toString('hex');
            console.log(`${indent}Labeled: "${labelStr}" (${labelHex})`);
            walkTree(tree[2], indent + '  ');
            break;
        case 3:
            const data = tree[1];
            const dataHex = Buffer.isBuffer(data) ? data.toString('hex') : Buffer.from(data).toString('hex');
            console.log(`${indent}Leaf: ${dataHex.slice(0, 64)}${dataHex.length > 64 ? '...' : ''} (${data.length} bytes)`);
            break;
        case 4:
            const hash = tree[1];
            const hashHex = Buffer.isBuffer(hash) ? hash.toString('hex') : Buffer.from(hash).toString('hex');
            console.log(`${indent}Pruned: ${hashHex}`);
            break;
        default:
            console.log(`${indent}Unknown tag ${tag}:`, tree);
    }
}

main().catch(console.error);
