const path = require('path');
const fs = require('fs');

const dtsFiles = ['dist/index.d.cts', 'dist/index.d.mts'];

for (const file of dtsFiles) {
  const filePath = path.resolve(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const updatedContent = content
      .split('\n')
      .filter((line) => !line.startsWith('import * as srk'))
      .join('\n');
    fs.writeFileSync(filePath, updatedContent.trim() + '\n', 'utf8');
    console.log(`Updated ${filePath}`);
  }
}
