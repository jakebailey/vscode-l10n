/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "path";
import { parseArgs, ParseArgsOptionsConfig } from "util";

const commands = ['export', 'generate-xlf', 'import-xlf', 'generate-pseudo', 'generate-azure'] as const;
const defaultLanguages = ['fr', 'it', 'de', 'es', 'ru', 'zh-cn', 'zh-tw', 'ja', 'ko', 'cs', 'pt-br', 'tr', 'pl'];

export const cliHelp = `vscode-l10n-dev <cmd> [args]

Commands:
  export <path..>           Export strings from source files
  generate-xlf <path..>     Generate an XLF file
  import-xlf <path..>       Import XLF files into localization JSON files
  generate-pseudo <path..>  Generate pseudo-localized JSON files
  generate-azure <path..>   Generate translations with Azure AI Translator

Options:
  -v, --verbose             Enable verbose logging
  -d, --debug               Enable debug logging
  -h, --help                Show help
      --version             Show version number`;

type Command = typeof commands[number];
export type CliInvocation =
	| { command: 'export'; paths: string[]; outDir?: string; verbose: boolean; debug: boolean }
	| { command: 'generate-xlf'; paths: string[]; outFile: string; language: string; verbose: boolean; debug: boolean }
	| { command: 'import-xlf'; paths: string[]; outDir: string; verbose: boolean; debug: boolean }
	| { command: 'generate-pseudo'; paths: string[]; language: string; verbose: boolean; debug: boolean }
	| { command: 'generate-azure'; paths: string[]; languages: string[]; key: string; region: string; verbose: boolean; debug: boolean }
	| { command: 'help' }
	| { command: 'version' };

const commonOptions = {
	verbose: { type: 'boolean', short: 'v' },
	debug: { type: 'boolean', short: 'd' },
	help: { type: 'boolean', short: 'h' },
	version: { type: 'boolean' },
} as const;

function normalizePaths(paths: string[]): string[] {
	return paths.map(value => path.normalize(value));
}

function requirePaths(paths: string[]): string[] {
	if (paths.length === 0) {
		throw new Error('At least one path is required.');
	}
	return paths;
}

function parseCommandArgs<const T extends ParseArgsOptionsConfig>(args: string[], options: T) {
	return parseArgs({
		args,
		allowPositionals: true,
		options: { ...commonOptions, ...options },
	});
}

export function parseCliArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliInvocation | undefined {
	if (args.length === 0) {
		return undefined;
	}

	const commandIndex = args.findIndex(value => commands.includes(value as Command));
	if (commandIndex === -1) {
		const { values, positionals } = parseArgs({
			args,
			allowPositionals: true,
			options: commonOptions,
		});
		if (values.help) {
			return { command: 'help' };
		}
		if (values.version) {
			return { command: 'version' };
		}
		throw new Error(positionals.length > 0 ? `Unknown command: ${positionals[0]}` : 'A command is required.');
	}

	const command = args[commandIndex] as Command;
	const commandArgs = [...args.slice(0, commandIndex), ...args.slice(commandIndex + 1)];
	if (command === 'export') {
		const { values, positionals } = parseCommandArgs(commandArgs, {
			outDir: { type: 'string', short: 'o' },
		});
		if (values.help || values.version) {
			return { command: values.help ? 'help' : 'version' };
		}
		return {
			command,
			paths: requirePaths(positionals),
			outDir: values.outDir,
			verbose: values.verbose ?? false,
			debug: values.debug ?? false,
		};
	}
	if (command === 'generate-xlf') {
		const { values, positionals } = parseCommandArgs(commandArgs, {
			outFile: { type: 'string', short: 'o' },
			language: { type: 'string', short: 'l' },
		});
		if (values.help || values.version) {
			return { command: values.help ? 'help' : 'version' };
		}
		if (!values.outFile) {
			throw new Error('The --outFile option is required.');
		}
		return {
			command,
			paths: normalizePaths(requirePaths(positionals)),
			outFile: values.outFile,
			language: values.language ?? 'en',
			verbose: values.verbose ?? false,
			debug: values.debug ?? false,
		};
	}
	if (command === 'import-xlf') {
		const { values, positionals } = parseCommandArgs(commandArgs, {
			outDir: { type: 'string', short: 'o' },
		});
		if (values.help || values.version) {
			return { command: values.help ? 'help' : 'version' };
		}
		return {
			command,
			paths: normalizePaths(requirePaths(positionals)),
			outDir: values.outDir ?? '.',
			verbose: values.verbose ?? false,
			debug: values.debug ?? false,
		};
	}
	if (command === 'generate-pseudo') {
		const { values, positionals } = parseCommandArgs(commandArgs, {
			language: { type: 'string', short: 'l' },
			outDir: { type: 'string', short: 'o' },
		});
		if (values.help || values.version) {
			return { command: values.help ? 'help' : 'version' };
		}
		return {
			command,
			paths: normalizePaths(requirePaths(positionals)),
			language: values.language ?? 'qps-ploc',
			verbose: values.verbose ?? false,
			debug: values.debug ?? false,
		};
	}

	const { values, positionals } = parseCommandArgs(commandArgs, {
		languages: { type: 'string', short: 'l', multiple: true },
		key: { type: 'string' },
		region: { type: 'string' },
		outDir: { type: 'string', short: 'o' },
	});
	if (values.help || values.version) {
		return { command: values.help ? 'help' : 'version' };
	}
	const key = values.key ?? env.AZURE_TRANSLATOR_KEY;
	const region = values.region ?? env.AZURE_TRANSLATOR_REGION;
	if (!key) {
		throw new Error('AZURE_TRANSLATOR_KEY environment variable is not defined.');
	}
	if (!region) {
		throw new Error('AZURE_TRANSLATOR_REGION environment variable is not defined.');
	}
	return {
		command,
		paths: normalizePaths(requirePaths(positionals)),
		languages: values.languages ?? defaultLanguages,
		key,
		region,
		verbose: values.verbose ?? false,
		debug: values.debug ?? false,
	};
}
