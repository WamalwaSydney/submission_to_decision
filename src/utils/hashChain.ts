import { ParticipationReceipt, ChainVerificationResult } from '../types';
import { GENESIS_HASH } from '../data/seed';

// SHA-256 hash using Web Crypto API
export async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Canonical JSON for hashing (sorted keys, no whitespace)
function canonicalJSON(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const parts = sortedKeys.map(key => {
    const value = obj[key];
    return `"${key}":${JSON.stringify(value)}`;
  });
  return `{${parts.join(',')}}`;
}

// Compute the hash for a receipt
export async function computeReceiptHash(receipt: Omit<ParticipationReceipt, 'hash'>): Promise<string> {
  const content = canonicalJSON({
    receipt_id: receipt.id,
    author_id: receipt.author_id,
    legislative_item_id: receipt.legislative_item_id,
    clause_ref: receipt.clause_ref || null,
    submission_text: receipt.submission_text,
    timestamp: receipt.timestamp,
    previous_hash: receipt.previous_hash,
  });
  return computeSHA256(content);
}

// Verify the entire chain
export async function verifyChain(receipts: ParticipationReceipt[]): Promise<ChainVerificationResult> {
  const details: ChainVerificationResult['details'] = [];
  let firstBrokenIndex: number | undefined;

  for (let i = 0; i < receipts.length; i++) {
    const receipt = receipts[i];
    const expectedPreviousHash = i === 0 ? GENESIS_HASH : receipts[i - 1].hash;
    
    const expectedHash = await computeReceiptHash({
      id: receipt.id,
      public_id: receipt.public_id,
      author_id: receipt.author_id,
      legislative_item_id: receipt.legislative_item_id,
      clause_ref: receipt.clause_ref,
      submission_text: receipt.submission_text,
      lodging_status: receipt.lodging_status,
      timestamp: receipt.timestamp,
      previous_hash: expectedPreviousHash,
    });

    const linkValid = receipt.hash === expectedHash && receipt.previous_hash === expectedPreviousHash;
    
    details.push({
      index: i,
      receiptId: receipt.public_id,
      valid: linkValid,
      expectedHash,
      actualHash: receipt.hash,
    });

    if (!linkValid && firstBrokenIndex === undefined) {
      firstBrokenIndex = i;
    }
  }

  return {
    valid: firstBrokenIndex === undefined,
    firstBrokenIndex,
    totalChecked: receipts.length,
    details,
  };
}

// Generate a new receipt with proper hash chaining
export async function createReceipt(
  id: string,
  publicId: string,
  authorId: string,
  legislativeItemId: string,
  clauseRef: string | undefined,
  submissionText: string,
  previousHash: string,
  timestamp: string
): Promise<ParticipationReceipt> {
  const receiptBase = {
    id,
    public_id: publicId,
    author_id: authorId,
    legislative_item_id: legislativeItemId,
    clause_ref: clauseRef,
    submission_text: submissionText,
    lodging_status: 'pending' as const,
    timestamp,
    previous_hash: previousHash,
  };

  const hash = await computeReceiptHash(receiptBase);

  return {
    ...receiptBase,
    hash,
  };
}
