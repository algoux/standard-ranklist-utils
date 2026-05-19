import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const venvPython = process.platform === 'win32'
  ? join('python', '.venv', 'Scripts', 'python.exe')
  : join('python', '.venv', 'bin', 'python');

const python = existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3';
const result = spawnSync(python, ['-m', 'pytest', 'python/tests'], {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
