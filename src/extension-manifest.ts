import type {Plugin} from 'vite';

export const EXTENSION_MANIFEST_FORMAT_VERSION = 1 as const;

export interface ExtensionManifestArgument {
  id: string;
  type: string;
  menu?: string;
}

export interface ExtensionManifestBlock {
  opcode: string;
  blockType: string;
  arguments: ExtensionManifestArgument[];
}

export interface ExtensionManifestMenu {
  id: string;
  acceptReporters: boolean;
}

export interface ExtensionManifest {
  formatVersion: typeof EXTENSION_MANIFEST_FORMAT_VERSION;
  id: string;
  blocks: ExtensionManifestBlock[];
  menus: ExtensionManifestMenu[];
}

export interface ExtensionManifestPluginOptions {
  id: string;
  definitions: unknown;
  fileName?: string;
}

export function createExtensionManifest(id: string, definitions: unknown): ExtensionManifest {
  if (!/^[a-z0-9]+$/.test(id)) {
    throw new TypeError('Extension manifest ID must contain only lowercase letters and numbers.');
  }

  const source = requireRecord(definitions, 'Block definitions');
  const sourceBlocks = source.blocks;
  if (!Array.isArray(sourceBlocks)) {
    throw new TypeError('Block definitions must contain a blocks array.');
  }

  const menus = normalizeMenus(source.menus);
  const menuIds = new Set(menus.map((menu) => menu.id));
  const seenOpcodes = new Set<string>();
  const blocks = sourceBlocks.map((block, index) => {
    const normalized = normalizeBlock(block, index, menuIds);
    if (seenOpcodes.has(normalized.opcode)) {
      throw new TypeError(`Duplicate block opcode: ${normalized.opcode}`);
    }
    seenOpcodes.add(normalized.opcode);
    return normalized;
  });

  return {
    formatVersion: EXTENSION_MANIFEST_FORMAT_VERSION,
    id,
    blocks: blocks.sort((left, right) => compareIds(left.opcode, right.opcode)),
    menus
  };
}

export function serializeExtensionManifest(id: string, definitions: unknown): string {
  return `${JSON.stringify(createExtensionManifest(id, definitions), null, 2)}\n`;
}

export function extensionManifestPlugin(options: ExtensionManifestPluginOptions): Plugin {
  return {
    name: 'extension-api-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: options.fileName ?? 'extension-manifest.json',
        source: serializeExtensionManifest(options.id, options.definitions)
      });
    }
  };
}

function normalizeBlock(
  value: unknown,
  index: number,
  menuIds: ReadonlySet<string>
): ExtensionManifestBlock {
  const block = requireRecord(value, `Block at index ${index}`);
  const opcode = requireNonEmptyString(block.opcode, `Block at index ${index} opcode`);
  const blockType = requireNonEmptyString(block.blockType, `Block ${opcode} blockType`);
  const sourceArguments = block.arguments ?? {};
  const argumentRecord = requireRecord(sourceArguments, `Block ${opcode} arguments`);
  const argumentsList = Object.entries(argumentRecord).map(([argumentId, argument]) => {
    requireNonEmptyString(argumentId, `Block ${opcode} argument ID`);
    const definition = requireRecord(argument, `Block ${opcode} argument ${argumentId}`);
    const type = requireNonEmptyString(
      definition.type,
      `Block ${opcode} argument ${argumentId} type`
    );
    const menu = definition.menu;
    if (menu !== undefined && (typeof menu !== 'string' || !menuIds.has(menu))) {
      throw new TypeError(`Block ${opcode} argument ${argumentId} references unknown menu: ${menu}`);
    }
    return menu === undefined ? {id: argumentId, type} : {id: argumentId, type, menu};
  });

  return {
    opcode,
    blockType,
    arguments: argumentsList.sort((left, right) => compareIds(left.id, right.id))
  };
}

function normalizeMenus(value: unknown): ExtensionManifestMenu[] {
  const menuRecord = requireRecord(value ?? {}, 'Block definition menus');
  return Object.entries(menuRecord)
    .map(([id, menu]) => {
      requireNonEmptyString(id, 'Menu ID');
      const definition = requireRecord(menu, `Menu ${id}`);
      const acceptReporters = definition.acceptReporters ?? false;
      if (typeof acceptReporters !== 'boolean') {
        throw new TypeError(`Menu ${id} acceptReporters must be a boolean.`);
      }
      return {id, acceptReporters};
    })
    .sort((left, right) => compareIds(left.id, right.id));
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
