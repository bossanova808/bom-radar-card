import { readFile, stat } from 'node:fs/promises';

const expectedTag = process.argv[2] || null;
const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [packageJsonText, packageLockText, source, readme, changelog, bugTemplate, bundle] = await Promise.all([
  readText('package.json'),
  readText('package-lock.json'),
  readText('src/bom-radar-card.js'),
  readText('README.md'),
  readText('CHANGELOG.md'),
  readText('.github/ISSUE_TEMPLATE/bug_report.yml'),
  readText('dist/bom-radar-card.js'),
]);

const packageJson = JSON.parse(packageJsonText);
const packageLock = JSON.parse(packageLockText);
const version = packageJson.version;
const expectedVersionTag = `v${version}`;
const leafletVersion = packageJson.dependencies?.leaflet;

const checks = [
  [packageLock.version === version, `package-lock.json version must be ${version}`],
  [packageLock.packages?.['']?.version === version, `package-lock.json root version must be ${version}`],
  [
    source.includes(`const CARD_VERSION = '${version}';`),
    `src/bom-radar-card.js CARD_VERSION must be ${version}`,
  ],
  [readme.includes(`**Current release: ${expectedVersionTag}**`), `README current release must be ${expectedVersionTag}`],
  [changelog.includes(`## ${expectedVersionTag} -`), `CHANGELOG must contain ${expectedVersionTag}`],
  [bugTemplate.includes(`placeholder: ${expectedVersionTag}`), `bug report placeholder must be ${expectedVersionTag}`],
  [leafletVersion === '1.9.4', 'package.json must pin bundled Leaflet to 1.9.4'],
  [packageLock.packages?.['node_modules/leaflet']?.version === '1.9.4', 'package-lock.json must resolve Leaflet 1.9.4'],
  [!source.includes('unpkg.com/leaflet'), 'src/bom-radar-card.js must not load Leaflet from a CDN'],
  [bundle.includes('Leaflet: BSD 2-Clause License'), 'dist bundle must retain the Leaflet BSD 2-Clause license'],
  [bundle.includes('Leaflet 1.9.4'), 'dist bundle must identify bundled Leaflet 1.9.4'],
  [
    bundle.includes('Copyright (c) 2010-2023, Volodymyr Agafonkin'),
    'dist bundle must retain the Leaflet copyright notice',
  ],
  [bundle.includes('All rights reserved.'), 'dist bundle must retain the complete Leaflet copyright notice'],
  [
    bundle.includes('Redistribution and use in source and binary forms'),
    'dist bundle must retain the Leaflet redistribution terms',
  ],
  [
    bundle.includes('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"'),
    'dist bundle must retain the Leaflet warranty disclaimer',
  ],
  [!bundle.includes('unpkg.com/leaflet'), 'dist bundle must not load Leaflet from a CDN'],
  [!/\bwindow\.L\s*=/.test(bundle), 'dist bundle must not assign Leaflet to window.L'],
  [
    !/\bfrom\s*["']leaflet(?:\/|["'])/.test(bundle),
    'dist bundle must not retain an external Leaflet import',
  ],
];

if (expectedTag) {
  checks.push([expectedTag === expectedVersionTag, `tag ${expectedTag} must match ${expectedVersionTag}`]);
}

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length > 0) {
  throw new Error(`Release metadata is inconsistent:\n- ${failures.join('\n- ')}`);
}

const bundleStats = await stat(new URL('../dist/bom-radar-card.js', import.meta.url));
if (!bundleStats.isFile() || bundleStats.size === 0) {
  throw new Error('dist/bom-radar-card.js is missing or empty');
}

console.log(`Release metadata is consistent for ${expectedVersionTag}`);
