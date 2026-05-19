import { copyFileSync } from 'node:fs';

const source = 'testdata/contract-fixtures.json';
const targets = [
  'python/tests/fixtures/contract-fixtures.json',
  'go/testdata/fixtures/contract-fixtures.json',
];

for (const target of targets) {
  copyFileSync(source, target);
}
