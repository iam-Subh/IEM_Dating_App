/** The published documents and the report reasons (docs/SAFETY_AND_LEGAL.md). No database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_VERSION, legalDocument, legalIndex } from '../src/legal/documents';
import { REPORT_REASONS, reasonPriority } from '../src/services/report-reasons';

test('every document is complete, with the support email filled in', () => {
  const slugs = legalIndex().map((doc) => doc.slug);
  for (const required of ['terms', 'privacy', 'guidelines', 'child-safety', 'grievance', 'safety', 'law-enforcement']) assert.ok(slugs.includes(required), required);
  for (const slug of slugs) {
    const doc = legalDocument(slug)!;
    assert.equal(doc.version, LEGAL_VERSION);
    const text = JSON.stringify(doc);
    assert.ok(!text.includes('{{'), `${slug}: a placeholder is left`);
    assert.ok(doc.sections.length > 0);
  }
  assert.ok(JSON.stringify(legalDocument('grievance')).includes('15 days'));
  assert.ok(JSON.stringify(legalDocument('child-safety')).includes('cybercrime.gov.in'));
  assert.equal(legalDocument('nope'), null);
});

test('urgent reasons come first; old free-text reasons still rank', () => {
  for (const code of ['underage', 'violence', 'intimate_images', 'self_harm']) assert.equal(reasonPriority(code), 'urgent', code);
  for (const code of ['fake', 'scam', 'harassment', 'sexual', 'hate']) assert.equal(reasonPriority(code), 'high', code);
  assert.equal(reasonPriority('spam'), 'normal');
  assert.equal(reasonPriority('Under 18'), 'urgent');
  assert.equal(reasonPriority('inappropriate_message'), 'high');
  assert.equal(reasonPriority('Reported from chat profile'), 'normal');
  assert.equal(Object.keys(REPORT_REASONS).length, 12);
});
