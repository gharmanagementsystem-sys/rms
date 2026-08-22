const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// --- Monorepo resolution -----------------------------------------------------
// Metro defaults to a single-package layout. Without these three settings it
// cannot see @rms/shared (which ships TypeScript source) or the hoisted
// node_modules at the workspace root.

// 1. Watch the whole workspace so edits to packages/shared trigger fast refresh.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Disable Node's walk-up lookup so a stray nested node_modules cannot
//    shadow the hoisted copy and produce two React instances.
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: './global.css' });
