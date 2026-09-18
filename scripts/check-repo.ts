import {access, readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  packageManager?: string;
  engines?: {node?: string};
  repository?: {url?: string};
  bugs?: {url?: string};
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface RepoPolicy {
  schemaVersion: number;
  productName: string;
  packageType: string;
  licensePolicy: string;
  readmeLanguages: string[];
  canonicalReadme: string;
  localizedReadmes: {
    ja: string;
  };
  node: {
    minimum: string;
  };
  packageManager: string;
  requiredFiles: string[];
  exceptions: {
    upstreamFork: boolean;
    mixedContentLicenses: boolean;
    legacyPackageName: boolean;
    thirdPartyBundle: boolean;
  };
  migrationChecklist: string[];
}

interface PackResult {
  version: string;
  files: {path: string}[];
}

const execFileAsync = promisify(execFile);
const errors: string[] = [];

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8')) as PackageMetadata;
const policy = JSON.parse(await readFile('repo-policy.json', 'utf8')) as RepoPolicy;
const readme = await readFile(policy.canonicalReadme, 'utf8');
const readmeJa = await readFile(policy.localizedReadmes.ja, 'utf8');
const license = await readFile('LICENSE', 'utf8');
const config = await readFile('src/config.ts', 'utf8');

checkPolicy();
checkPackageMetadata();
checkReadmes();
checkLicense();
checkGeneratedArtifacts();
await checkPackContents();

if (errors.length > 0) {
  throw new Error(`Repository policy check failed:\n- ${errors.join('\n- ')}`);
}

process.stdout.write('Repository policy is aligned.\n');

function checkPolicy() {
  if (policy.schemaVersion !== 1) errors.push('repo-policy.json schemaVersion must be 1');
  if (policy.productName !== 'TurboWarp-OpenAI-Realtime-API') {
    errors.push('repo-policy.json productName must match README.md H1');
  }
  if (policy.licensePolicy !== 'mpl-2.0') {
    errors.push('repo-policy.json licensePolicy must be mpl-2.0');
  }
  if (policy.packageManager !== 'pnpm') {
    errors.push('repo-policy.json packageManager must be pnpm');
  }
  if (!Array.isArray(policy.migrationChecklist) || policy.migrationChecklist.length === 0) {
    errors.push('repo-policy.json must include a migration checklist');
  }
}

function checkPackageMetadata() {
  const requiredStrings = ['description', 'author', 'license', 'homepage', 'packageManager'] as const;
  for (const key of requiredStrings) {
    const value = packageMetadata[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`package.json ${key} must be a non-empty string`);
    }
  }
  if (packageMetadata.license !== 'MPL-2.0') errors.push('package.json license must be MPL-2.0');
  if (!packageMetadata.packageManager?.startsWith('pnpm@')) {
    errors.push('package.json packageManager must pin pnpm exactly');
  }
  if (packageMetadata.engines?.node !== '>=22.18.0') {
    errors.push('package.json engines.node must be >=22.18.0');
  }
  if (packageMetadata.repository?.url !== 'git+https://github.com/kubohiroya/turbowarp-openai-realtime-api.git') {
    errors.push('package.json repository.url must point to the current repository');
  }
  if (packageMetadata.bugs?.url !== 'https://github.com/kubohiroya/turbowarp-openai-realtime-api/issues') {
    errors.push('package.json bugs.url must point to the current issue tracker');
  }
  for (const file of policy.requiredFiles) {
    if (!packageMetadata.files?.includes(file)) {
      errors.push(`package.json files must include ${file}`);
    }
  }
  for (const command of ['docs:check', 'check', 'check:dist']) {
    if (/\bnpm run\b/u.test(packageMetadata.scripts?.[command] ?? '')) {
      errors.push(`package.json ${command} must use pnpm run`);
    }
  }
}

function checkReadmes() {
  if (!readme.startsWith(`# ${policy.productName}\n`)) {
    errors.push('README.md H1 must match repo-policy.json productName');
  }
  if (!readme.includes('[日本語](README.ja.md)')) {
    errors.push('README.md must link to README.ja.md');
  }
  if (!readme.includes('## What it does')) errors.push('README.md must include What it does');
  if (!readme.includes('## Requirements and safety')) {
    errors.push('README.md must include Requirements and safety');
  }
  if (!readme.includes('## Block reference')) {
    errors.push('README.md generated block section heading must be Block reference');
  }
  if ((readme.match(/<!-- BEGIN GENERATED BLOCKS -->/g) ?? []).length !== 1) {
    errors.push('README.md must contain exactly one generated block start marker');
  }
  if ((readme.match(/<!-- END GENERATED BLOCKS -->/g) ?? []).length !== 1) {
    errors.push('README.md must contain exactly one generated block end marker');
  }
  if (!readme.includes(`${packageMetadata.name}@${packageMetadata.version}`)) {
    errors.push('README.md must include a version-pinned package example');
  }
  if (!readme.includes('MPL-2.0')) errors.push('README.md License section must include MPL-2.0');
  if (!readmeJa.startsWith('# TurboWarp-OpenAI-Realtime-API\n')) {
    errors.push('README.ja.md must mirror the product H1');
  }
}

function checkLicense() {
  if (!license.startsWith('Mozilla Public License Version 2.0\n==================================')) {
    errors.push('LICENSE must contain the Mozilla Public License Version 2.0 full text');
  }
  if (!license.includes('Exhibit A - Source Code Form License Notice')) {
    errors.push('LICENSE must include the MPL-2.0 Exhibit A text');
  }
  if (!config.includes("license: 'MPL-2.0'")) {
    errors.push('src/config.ts must expose MPL-2.0 bundle metadata');
  }
}

function checkGeneratedArtifacts() {
  const expectedBundle = `dist/${extractConfigValue('slug')}.js`;
  if (!packageMetadata.files?.includes('dist/')) errors.push('package.json files must include dist/');
  if (!readme.includes(expectedBundle)) errors.push(`README.md must document ${expectedBundle}`);
}

async function checkPackContents() {
  const {stdout} = await execFileAsync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json']);
  const [pack] = JSON.parse(stdout) as PackResult[];
  if (!pack) {
    errors.push('npm pack must report a package');
    return;
  }
  const files = new Set(pack.files.map((file) => file.path));
  for (const file of policy.requiredFiles) {
    if (!files.has(file)) errors.push(`npm pack must include ${file}`);
  }
  if (!files.has('dist/turbowarp-openai-realtime-api.js')) {
    errors.push('npm pack must include the generated extension bundle');
  }
  await access('pnpm-lock.yaml');
}

function extractConfigValue(key: string): string {
  const match = config.match(new RegExp(`${key}: '([^']+)'`));
  if (!match?.[1]) throw new Error(`src/config.ts must define ${key}`);
  return match[1];
}
