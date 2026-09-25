/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from '@jest/globals';
import path from 'path';
import { parseCliArgs } from '../cliArgs';

describe('parseCliArgs', () => {
	it('parses export options and paths', () => {
		expect(parseCliArgs(['--verbose', 'export', '-o', 'l10n', 'src', 'other.ts'])).toEqual({
			command: 'export',
			paths: ['src', 'other.ts'],
			outDir: 'l10n',
			verbose: true,
			debug: false,
		});
	});

	it('parses generate-xlf defaults', () => {
		expect(parseCliArgs(['generate-xlf', '-o', 'translations.xlf', 'bundle.l10n.json'])).toEqual({
			command: 'generate-xlf',
			paths: [path.normalize('bundle.l10n.json')],
			outFile: 'translations.xlf',
			language: 'en',
			verbose: false,
			debug: false,
		});
	});

	it('parses Azure options and environment variables', () => {
		expect(parseCliArgs(
			['generate-azure', '-l', 'fr', '-l', 'de', 'bundle.l10n.json'],
			{ AZURE_TRANSLATOR_KEY: 'key', AZURE_TRANSLATOR_REGION: 'region' }
		)).toEqual({
			command: 'generate-azure',
			paths: [path.normalize('bundle.l10n.json')],
			languages: ['fr', 'de'],
			key: 'key',
			region: 'region',
			verbose: false,
			debug: false,
		});
	});

	it('validates required arguments', () => {
		expect(() => parseCliArgs(['export'])).toThrow('At least one path is required.');
		expect(() => parseCliArgs(['generate-xlf', 'bundle.l10n.json'])).toThrow('The --outFile option is required.');
		expect(() => parseCliArgs(['unknown'])).toThrow('Unknown command: unknown');
	});
});
