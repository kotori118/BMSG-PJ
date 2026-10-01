import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const files = walk(root);
const gasFiles = files.filter((file) => path.extname(file) === '.gs');
const htmlFiles = files.filter((file) => path.extname(file) === '.html');
const errors = [];
const serverFunctionOwners = new Map();
const clientFunctionOwners = new Map();

gasFiles.forEach((file) => {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  try {
    new vm.Script(source, { filename: relative });
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
  }

  for (const match of source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = match[1];
    if (serverFunctionOwners.has(name)) {
      errors.push(`${relative}: function ${name} は ${serverFunctionOwners.get(name)} と重複しています。`);
    } else {
      serverFunctionOwners.set(name, relative);
    }
  }
});

htmlFiles.forEach((file) => {
  const relative = path.relative(root, file);
  const html = fs.readFileSync(file, 'utf8');
  let scriptIndex = 0;
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    scriptIndex++;
    const source = match[1];
    try {
      new vm.Script(source, { filename: `${relative}#script-${scriptIndex}` });
    } catch (error) {
      errors.push(`${relative}#script-${scriptIndex}: ${error.message}`);
    }

    for (const functionMatch of source.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = functionMatch[1];
      const owner = `${relative}#script-${scriptIndex}`;
      if (clientFunctionOwners.has(name)) {
        errors.push(`${owner}: function ${name} は ${clientFunctionOwners.get(name)} と重複しています。`);
      } else {
        clientFunctionOwners.set(name, owner);
      }
    }
  }
});

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
} catch (error) {
  errors.push(`appsscript.json: ${error.message}`);
}

const library = manifest?.dependencies?.libraries?.find((item) => item.userSymbol === 'BMSGDB');
if (!library || !Number.isInteger(Number(library.version)) || Number(library.version) < 1 || library.developmentMode !== false) {
  errors.push('appsscript.json: BMSGDBは固定の正整数version・developmentMode=falseで参照してください。');
}

const userIdLiteral = "Object.freeze(['U001','U002','U003'])";
const compactUserIdLiteral = "Object.freeze(['U001', 'U002', 'U003'])";
files.filter((file) => path.extname(file) === '.gs' && path.basename(file) !== 'Config.gs').forEach((file) => {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(userIdLiteral) || source.includes(compactUserIdLiteral)) {
    errors.push(`${path.relative(root, file)}: 利用ユーザー一覧はConfig.gsのUNIVERSE_CONFIG.USER_IDSを参照してください。`);
  }
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${gasFiles.length} GAS files, ${htmlFiles.length} HTML files, and the BMSGDB dependency contract.`);
