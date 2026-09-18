import {readFile, writeFile} from 'node:fs/promises';

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
  arguments: Record<string, BlockArgument>;
}

interface BlockDefinitions {
  extensionName: string;
  blocks: BlockDefinition[];
}

const START = '<!-- BEGIN GENERATED BLOCKS -->';
const END = '<!-- END GENERATED BLOCKS -->';

const definitions = JSON.parse(
  await readFile(new URL('../src/block-definitions.json', import.meta.url), 'utf8')
) as BlockDefinitions;
const readmeUrl = new URL('../README.md', import.meta.url);
const readme = await readFile(readmeUrl, 'utf8');

const generated = definitions.blocks.map(renderBlock).join('\n\n');
const replacement = `${START}\n\n${generated}\n\n${END}`;

if (!readme.includes(START) || !readme.includes(END)) {
  throw new Error('README.md does not contain the generated block markers.');
}

const next = readme.replace(
  new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}`),
  replacement
);
await writeFile(readmeUrl, next);

function renderBlock(block: BlockDefinition): string {
  const rows = [
    ['Type', titleCase(block.blockType)],
    ['Opcode', `\`${block.opcode}\``]
  ];
  for (const [name, argument] of Object.entries(block.arguments ?? {})) {
    rows.push([
      `\`${name}\``,
      `${titleCase(argument.type)}, default: \`${formatDefault(argument.defaultValue)}\``
    ]);
  }
  return [
    `### \`${block.text}\``,
    '',
    block.description,
    '',
    '| Property | Value |',
    '|---|---|',
    ...rows.map(([name, value]) => `| ${name} | ${value} |`)
  ].join('\n');
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatDefault(value: BlockArgument['defaultValue']): string {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('`', '\\`');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
