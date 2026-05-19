import { readFileSync } from 'node:fs';

const source = readFileSync('testdata/contract-fixtures.json', 'utf8');
const targets = [
  'python/tests/fixtures/contract-fixtures.json',
  'go/testdata/fixtures/contract-fixtures.json',
];

const mismatches = targets.filter((target) => readFileSync(target, 'utf8') !== source);

if (mismatches.length) {
  console.error('Contract fixtures are out of sync:');
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch}`);
  }
  console.error('Run: pnpm run sync:fixtures');
  process.exit(1);
}
