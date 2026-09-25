/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { globSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { cliHelp, parseCliArgs } from "./cliArgs";
import { getL10nAzureLocalized, getL10nFilesFromXlf, getL10nJson, getL10nPseudoLocalized, getL10nXlf, l10nJsonFormat } from "./main";
import { logger, LogLevel } from "./logger";

function findFiles(patterns: string[]): string[] {
	return globSync(patterns.map(pattern => pattern.replace(/\\/g, '/'))).map(match => path.resolve(match));
}

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
	const invocation = parseCliArgs(args);
	if (!invocation) {
		return;
	}
	if (invocation.command === 'help') {
		console.log(cliHelp);
		return;
	}
	if (invocation.command === 'version') {
		const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
		console.log(packageJson.version);
		return;
	}

	if (invocation.debug) {
		logger.setLogLevel(LogLevel.Debug);
	} else if (invocation.verbose) {
		logger.setLogLevel(LogLevel.Verbose);
	}

	switch (invocation.command) {
		case 'export':
			await l10nExportStrings(invocation.paths, invocation.outDir);
			break;
		case 'generate-xlf':
			l10nGenerateXlf(invocation.paths, invocation.language, invocation.outFile);
			break;
		case 'import-xlf':
			await l10nImportXlf(invocation.paths, invocation.outDir);
			break;
		case 'generate-pseudo':
			l10nGeneratePseudo(invocation.paths, invocation.language);
			break;
		case 'generate-azure':
			await l10nGenerateTranslationService(invocation.paths, invocation.languages, invocation.key, invocation.region);
			break;
	}
}

if (require.main === module) {
	void runCli().catch(error => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

export async function l10nExportStrings(paths: string[], outDir?: string): Promise<void> {
	logger.log('Searching for TypeScript/JavaScript files...');

	const matches = findFiles(paths.map(p => /\.(ts|tsx|js|jsx)$/.test(p) ? p : path.posix.join(p, '{,**}', '*.{ts,tsx,js,jsx}')));
	const tsFileContents = matches.map(m => ({
		extension: path.extname(m),
		contents: readFileSync(path.resolve(m), 'utf8')
	}));

	if (!tsFileContents.length) {
		logger.log('No TypeScript files found.');
		return;
	}

	logger.log(`Found ${tsFileContents.length} TypeScript files. Extracting strings...`);
	const jsonResult = await getL10nJson(tsFileContents);

	const stringsFound = Object.keys(jsonResult).length;
	if (!stringsFound) {
		logger.log('No strings found. Skipping writing to a bundle.l10n.json.');
		return;
	}
	logger.log(`Extracted ${stringsFound} strings...`);

	let packageJSON;
	try {
		packageJSON = JSON.parse(readFileSync('package.json').toString('utf-8'));
	} catch {
		// Ignore
	}
	if (packageJSON) {
		if (outDir) {
			if (!packageJSON.l10n || path.resolve(packageJSON.l10n) !== path.resolve(outDir)) {
				console.warn('The l10n property in the package.json does not match the outDir specified. For an extension to work correctly, l10n must be set to the location of the bundle files.');
			}
		} else {
			outDir = packageJSON.l10n ?? '.';
		}
	} else {
		if (!outDir) {
			console.debug('No package.json found in directory and no outDir specified. Using the current directory.');
			return;
		}
		outDir = outDir ?? '.';
	}
	const resolvedOutFile = path.resolve(path.join(outDir!, 'bundle.l10n.json'));
	console.info(`Writing exported strings to: ${resolvedOutFile}`);
	mkdirSync(path.resolve(outDir!), { recursive: true });
	writeFileSync(resolvedOutFile, JSON.stringify(jsonResult, undefined, 2));
}

export function l10nGenerateXlf(paths: string[], language: string, outFile: string): void {
	logger.log('Searching for L10N JSON files...');

	const matches = findFiles(paths.map(p => /(\.l10n\.json|package\.nls\.json)$/.test(p) ? p : path.posix.join(p, `{,!(node_modules)/**}`, '{*.l10n.json,package.nls.json}')));

	const l10nFileContents = new Map<string, l10nJsonFormat>();
	for (const match of matches) {
		if (match.endsWith('.l10n.json')) {
			const name = path.basename(match).split('.l10n.json')[0] ?? '';
			l10nFileContents.set(name, JSON.parse(readFileSync(path.resolve(match), 'utf8')));
		} else if (match.endsWith('package.nls.json')) {
			l10nFileContents.set('package', JSON.parse(readFileSync(path.resolve(match), 'utf8')));
		}
	}

	if (!l10nFileContents.size) {
		logger.log('No L10N JSON files found so skipping generating XLF.');
		return;
	}
	logger.log(`Found ${l10nFileContents.size} L10N JSON files. Generating XLF...`);

	const result = getL10nXlf(l10nFileContents, { sourceLanguage: language });
	writeFileSync(path.resolve(outFile), result);
	logger.log(`Wrote XLF file to: ${outFile}`);
}

export async function l10nImportXlf(paths: string[], outDir: string): Promise<void> {
	logger.log('Searching for XLF files...');

	const matches = findFiles(paths.map(p => /\.xlf$/.test(p) ? p : path.posix.join(p, `{,!(node_modules)/**}`, '*.xlf')));
	const xlfFiles = matches.map(m => readFileSync(path.resolve(m), 'utf8'));
	if (!xlfFiles.length) {
		logger.log('No XLF files found.');
		return;
	}

	logger.log(`Found ${xlfFiles.length} XLF files. Generating localized L10N JSON files...`);
	let count = 0;

	if (xlfFiles.length) {
		mkdirSync(path.resolve(outDir), { recursive: true });
	}

	for (const xlfContents of xlfFiles) {
		const details = await getL10nFilesFromXlf(xlfContents);
		count += details.length;
		for (const detail of details) {
			const type = detail.name === 'package' ? 'nls' : 'l10n';
			writeFileSync(
				path.resolve(path.join(outDir, `${detail.name}.${type}.${detail.language}.json`)),
				JSON.stringify(detail.messages, undefined, 2)
			);
		}
	}
	logger.log(`Wrote ${count} localized L10N JSON files to: ${outDir}`);
}

export function l10nGeneratePseudo(paths: string[], language: string): void {
	logger.log('Searching for L10N JSON files...');

	const matches = findFiles(paths.map(p => /(\.l10n\.json|package\.nls\.json)$/.test(p) ? p : path.posix.join(p, `{,!(node_modules)/**}`, '{*.l10n.json,package.nls.json}')));

	for (const match of matches) {
		const contents = getL10nPseudoLocalized(JSON.parse(readFileSync(path.resolve(match), 'utf8')));
		if (match.endsWith('.l10n.json')) {
			const name = path.basename(match).split('.l10n.json')[0] ?? '';
			writeFileSync(
				path.resolve(path.join(path.dirname(match), `${name}.l10n.${language}.json`)),
				JSON.stringify(contents, undefined, 2)
			);
		} else if (path.basename(match) === 'package.nls.json') {
			writeFileSync(
				path.resolve(path.join(path.dirname(match), `package.nls.${language}.json`)),
				JSON.stringify(contents, undefined, 2)
			);
		}
	}

	if (!matches.length) {
		logger.log('No L10N JSON files.');
		return;
	}
	logger.log(`Wrote ${matches.length} L10N JSON files.`);
}

export async function l10nGenerateTranslationService(paths: string[], languages: string[], key: string, region: string): Promise<void> {
	logger.log('Searching for L10N JSON files...');

	const matches = findFiles(paths.map(p => /(\.l10n\.json|package\.nls\.json)$/.test(p) ? p : path.posix.join(p, `{,!(node_modules)/**}`, '{*.l10n.json,package.nls.json}')));

	for (const match of matches) {
		const contents = await getL10nAzureLocalized(
			JSON.parse(readFileSync(path.resolve(match), 'utf8')),
			languages,
			{ azureTranslatorKey: key, azureTranslatorRegion: region }
		);
		for (let i = 0; i < languages.length; i++) {
			const language = languages[i];
			if (match.endsWith('.l10n.json')) {
				const name = path.basename(match).split('.l10n.json')[0] ?? '';
				writeFileSync(
					path.resolve(path.join(path.dirname(match), `${name}.l10n.${language}.json`)),
					JSON.stringify(contents[i], undefined, 2)
				);
			} else if (path.basename(match) === 'package.nls.json') {
				writeFileSync(
					path.resolve(path.join(path.dirname(match), `package.nls.${language}.json`)),
					JSON.stringify(contents[i], undefined, 2)
				);
			}
		}
	}

	if (!matches.length) {
		logger.log('No L10N JSON files.');
		return;
	}
	logger.log(`Wrote ${matches.length * languages.length} L10N JSON files.`);
}
