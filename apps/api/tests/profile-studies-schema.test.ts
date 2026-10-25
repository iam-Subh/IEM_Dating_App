import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateProfileSchema} from '../src/schemas/profile.schema';

test('Profile accepts typed studies outside the old menu limits', () => {
  assert.equal(updateProfileSchema.safeParse({body: {degree: 'Bachelor of Architecture', yearOfStudy: 5, graduationYear: 2037}}).success, true);
  assert.equal(updateProfileSchema.safeParse({body: {degree: 'MBA', graduationYear: 2018}}).success, true);
});

test('Profile rejects cleared study values', () => {
  for (const body of [{degree: null}, {yearOfStudy: null}, {graduationYear: null}, {degree: ''}]) {
    assert.equal(updateProfileSchema.safeParse({body}).success, false);
  }
});

test('Profile rejects invalid study values', () => {
  for (const body of [{yearOfStudy: 0}, {yearOfStudy: 11}, {yearOfStudy: 2.5}, {graduationYear: 1899}, {graduationYear: 2101}, {graduationYear: '2027'}, {degree: 'x'.repeat(256)}]) assert.equal(updateProfileSchema.safeParse({body}).success, false);
});
