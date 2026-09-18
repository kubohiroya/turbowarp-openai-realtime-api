import type { Plugin } from 'vite';
export declare const EXTENSION_MANIFEST_FORMAT_VERSION: 1;
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
export declare function createExtensionManifest(id: string, definitions: unknown): ExtensionManifest;
export declare function serializeExtensionManifest(id: string, definitions: unknown): string;
export declare function extensionManifestPlugin(options: ExtensionManifestPluginOptions): Plugin;
