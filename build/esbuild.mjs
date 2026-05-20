// build/esbuild.mjs
// Builds src/main.ts → build/dist/main.js (Obsidian plugin format)
// Usage:
//   node build/esbuild.mjs            # single build
//   node build/esbuild.mjs --watch    # watch mode (development)

import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

const manifest = JSON.parse(readFileSync(resolve(root, 'src/manifest.json'), 'utf8'));

/** @type {import('esbuild').BuildOptions} */
const options = {
	entryPoints: [resolve(root, 'src/main.ts')],
	bundle: true,
	// Obsidian loads plugins as CommonJS modules
	format: 'cjs',
	// node: lets esbuild use the real require() for Node built-ins (child_process,
	// fs, path, …) so they resolve via Electron's nodeIntegration at runtime.
	// platform:'browser' generates a polyfilled __require that cannot load them.
	platform: 'node',
	target: 'es2020',
	outfile: resolve(root, 'build/dist/main.js'),
	// With platform:'node', all Node built-ins are automatically external.
	// Only list Obsidian-ecosystem packages that must stay external.
	external: [
		'obsidian',
		'electron',
		'@codemirror/*',
		'@lezer/*',
	],
	minify: false,
	sourcemap: false,
	logLevel: 'info',
	define: {
		'process.env.PLUGIN_VERSION': JSON.stringify(manifest.version),
	},
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log('Watching for changes…  (Ctrl+C to stop)');
} else {
	await esbuild.build(options);
	console.log(`Built → build/dist/main.js  (v${manifest.version})`);
}
