import {readFile, writeFile} from 'node:fs/promises';
import process from 'node:process';

interface BlockArgument {
  type: string;
  defaultValue?: boolean | number | string;
  menu?: string;
}

interface BlockDefinition {
  opcode: string;
  blockType: string;
  text: string;
  description: string;
  descriptionJa: string;
  arguments: Record<string, BlockArgument>;
}

interface MenuDefinition {
  acceptReporters: boolean;
  items: string[];
}

interface BlockDefinitions {
  extensionName: string;
  blocks: BlockDefinition[];
  menus?: Record<string, MenuDefinition>;
}

interface Locale {
  file: string;
  description: (block: BlockDefinition) => string;
  property: string;
  value: string;
  type: string;
  opcode: string;
  blockTypes: Record<string, string>;
  argumentTypes: Record<string, string>;
  defaultLabel: string;
  choicesLabel: string;
}

const START = '<!-- BEGIN GENERATED BLOCKS -->';
const END = '<!-- END GENERATED BLOCKS -->';
const checkOnly = process.argv.includes('--check');

const LOCALES: Locale[] = [
  {
    file: 'README.md',
    description: (block) => block.description,
    property: 'Property',
    value: 'Value',
    type: 'Type',
    opcode: 'Opcode',
    blockTypes: {COMMAND: 'Command', REPORTER: 'Reporter', BOOLEAN: 'Boolean', HAT: 'Hat'},
    argumentTypes: {STRING: 'String', NUMBER: 'Number', BOOLEAN: 'Boolean'},
    defaultLabel: 'default',
    choicesLabel: 'choices'
  },
  {
    file: 'README.ja.md',
    description: (block) => block.descriptionJa,
    property: '項目',
    value: '値',
    type: '種類',
    opcode: 'Opcode',
    blockTypes: {COMMAND: 'コマンド', REPORTER: '値ブロック', BOOLEAN: '真偽値ブロック', HAT: 'ハット'},
    argumentTypes: {STRING: '文字列', NUMBER: '数値', BOOLEAN: '真偽値'},
    defaultLabel: '既定値',
    choicesLabel: '選択肢'
  }
];

const definitions = JSON.parse(
  await readFile(new URL('../src/block-definitions.json', import.meta.url), 'utf8')
) as BlockDefinitions;

const errors: string[] = [];
for (const block of definitions.blocks) {
  if (typeof block.descriptionJa !== 'string' || block.descriptionJa.trim().length === 0) {
    errors.push(`Block ${block.opcode} must have descriptionJa.`);
  }
}

for (const locale of LOCALES) {
  const readmeUrl = new URL(`../${locale.file}`, import.meta.url);
  const readme = await readFile(readmeUrl, 'utf8');
  if (!readme.includes(START) || !readme.includes(END)) {
    throw new Error(`${locale.file} does not contain the generated block markers.`);
  }
  const generated = definitions.blocks.map((block) => renderBlock(block, locale)).join('\n\n');
  const next = readme.replace(
    new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}`),
    `${START}\n\n${generated}\n\n${END}`
  );
  if (checkOnly) {
    if (next !== readme) errors.push(`${locale.file} generated block reference is not up to date.`);
  } else {
    await writeFile(readmeUrl, next);
  }
}

if (errors.length > 0) {
  throw new Error(errors.join('\n'));
}

function renderBlock(block: BlockDefinition, locale: Locale): string {
  const rows = [
    [locale.type, locale.blockTypes[block.blockType] ?? block.blockType],
    [locale.opcode, `\`${block.opcode}\``]
  ];
  for (const [name, argument] of Object.entries(block.arguments ?? {})) {
    const parts = [
      locale.argumentTypes[argument.type] ?? argument.type,
      `${locale.defaultLabel}: \`${formatDefault(argument.defaultValue)}\``
    ];
    const menu = argument.menu ? definitions.menus?.[argument.menu] : undefined;
    if (menu) parts.push(`${locale.choicesLabel}: ${menu.items.map((item) => `\`${item}\``).join(', ')}`);
    rows.push([`\`${name}\``, parts.join(', ')]);
  }
  return [
    `### \`${block.text}\``,
    '',
    locale.description(block),
    '',
    `| ${locale.property} | ${locale.value} |`,
    '|---|---|',
    ...rows.map(([name, value]) => `| ${name} | ${value} |`)
  ].join('\n');
}

function formatDefault(value: BlockArgument['defaultValue']): string {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('`', '\\`');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
