import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = resolve('go');
const goCache = resolve('go', '.gocache');
mkdirSync(goCache, { recursive: true });

const result = spawnSync('go', ['test', './...'], {
  cwd,
  env: {
    ...process.env,
    GOCACHE: goCache,
  },
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
