/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DOMParser, type Element } from '@xmldom/xmldom';
import * as crypto from 'crypto';
import { Line } from "./line";
import { l10nJsonDetails, l10nJsonFormat, l10nJsonMessageFormat } from "../common";

const hashedIdSignal = '++CODE++';
const hashedIdLength = 72; // 64 because it was a SHA256 hash + hashedIdSignal.length

interface Item {
	id: string;
	message: string;
	comment?: string;
}

function getMessage(value: l10nJsonMessageFormat): string {
	return typeof value === 'string' ? value : value.message;
}
function getComment(value: l10nJsonMessageFormat): string[] | undefined {
	return typeof value === 'string' ? undefined : value.comment;
}

function getChildElements(element: Element, localName: string): Element[] {
	const result: Element[] = [];
	for (let child = element.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1 && child.localName === localName) {
			result.push(child as Element);
		}
	}
	return result;
}

function getChildElement(element: Element, localName: string): Element | undefined {
	return getChildElements(element, localName)[0];
}

function getValue(element: Element | undefined): string | undefined {
	return element?.textContent ?? undefined;
}

export class XLF {
	private buffer: string[] = [];
	private files = new Map<string, Item[]>();
	private sourceLanguage: string;

	constructor(options?: { sourceLanguage?: string; }) {
		this.sourceLanguage = options?.sourceLanguage ?? 'en';
	}

	public toString(): string {
		this.appendHeader();

		const filesSorted = [...this.files].sort((a, b) => (a[0] > b[0] ? 1 : -1));
		for (const [ file, items ] of filesSorted) {
			this.appendNewLine(`<file original="${file}" source-language="${this.sourceLanguage}" datatype="plaintext"><body>`, 2);
			const itemsSorted = items.sort((a, b) => a.message > b.message ? 1 : -1);
			for (const item of itemsSorted) {
				this.addStringItem(item);
			}
			this.appendNewLine('</body></file>', 2);
		}

		this.appendFooter();
		return this.buffer.join('\r\n');
	}

	public addFile(key: string, bundle: l10nJsonFormat): void {
		if (Object.keys(bundle).length === 0) {
			return;
		}
		this.files.set(key, []);
		const existingKeys: Set<string> = new Set();

		for (const id in bundle) {
			if (existingKeys.has(id)) {
				continue;
			}
			existingKeys.add(id);

			const message = encodeEntities(getMessage(bundle[id]!));
			const comment = getComment(bundle[id]!)?.map(c => encodeEntities(c)).join(`\r\n`);
			this.files.get(key)!.push({ id: encodeEntities(id), message, comment });
		}
	}

	private addStringItem(item: Item): void {
		if (!item.id || !item.message) {
			throw new Error('No item ID or value specified.');
		}

		// package.nls.json files use the id as it is defined by the user so we don't use a placeholder id in that case
		const id = item.id.startsWith(item.message)
			? hashedIdSignal + crypto.createHash('sha256').update(item.id, 'binary').digest('hex')
			: item.id;
		this.appendNewLine(`<trans-unit id="${encodeEntities(id)}">`, 4);
		this.appendNewLine(`<source xml:lang="${this.sourceLanguage}">${item.message}</source>`, 6);

		if (item.comment) {
			this.appendNewLine(`<note>${item.comment}</note>`, 6);
		}

		this.appendNewLine('</trans-unit>', 4);
	}

	private appendHeader(): void {
		this.appendNewLine('<?xml version="1.0" encoding="utf-8"?>', 0);
		this.appendNewLine('<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">', 0);
	}

	private appendFooter(): void {
		this.appendNewLine('</xliff>', 0);
	}

	private appendNewLine(content: string, indent?: number): void {
		const line = new Line(indent);
		line.append(content);
		this.buffer.push(line.toString());
	}

	static async parse(xlfString: string): Promise<l10nJsonDetails[]> {
		const files: l10nJsonDetails[] = [];
		const document = new DOMParser({
			onError: (_level, message) => {
				throw new Error(message);
			}
		}).parseFromString(xlfString.trimStart(), 'application/xml');

		const root = document.documentElement;
		const fileNodes = root?.localName === 'xliff' ? getChildElements(root, 'file') : [];
		if (fileNodes.length === 0) {
			throw new Error('XLIFF file does not contain "xliff" or "file" node(s) required for parsing.');
		}

		fileNodes.forEach((file) => {
			const name = file.getAttribute('original');
			if (!name) {
				throw new Error('XLIFF file node does not contain original attribute to determine the original location of the resource file.');
			}
			const language = file.getAttribute('target-language')?.toLowerCase();
			if (!language) {
				throw new Error('XLIFF file node does not contain target-language attribute to determine translated language.');
			}

			const messagesMap = new Map<string, string>();
			const body = getChildElement(file, 'body');
			const transUnits = body ? getChildElements(body, 'trans-unit') : [];
			if (transUnits.length > 0) {
				transUnits.forEach((unit) => {
					const targetElement = getChildElement(unit, 'target');
					if (!targetElement) {
						return; // No translation available
					}

					const target = getValue(targetElement);
					if (!target) {
						throw new Error('XLIFF file does not contain full localization data. target node in one of the trans-unit nodes is not present.');
					}

					const id = unit.getAttribute('id');
					if (!id) {
						throw new Error('XLIFF file does not contain full localization data. id attribute in one of the trans-unit nodes is not present.');
					}

					let key: string;
					if (!id.startsWith(hashedIdSignal) || id.length !== hashedIdLength) {
						key = id;
					} else {
						const source = getValue(getChildElement(unit, 'source'));
						if (!source) {
							throw new Error('XLIFF file does not contain full localization data. source node in one of the trans-unit nodes is not present.');
						}
	
						const note = getValue(getChildElement(unit, 'note'));
						key = source;
						if (note) {
							key += '/' + note.replace(/\r?\n/g, ''); // remove newlines
						}
					}

					messagesMap.set(key, decodeEntities(target));
				});

				// Sort result so it's predictable
				const messages: { [key: string]: string } = {};
				for (const key of [...messagesMap.keys()].sort()) {
					messages[key] = messagesMap.get(key)!;
				}

				files.push({ messages, name, language });
			}
		});

		return files.sort((a, b) => a.name.localeCompare(b.name));
	}
}

function encodeEntities(value: string): string {
	const result: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const ch = value[i]!;
		switch (ch) {
			case '"':
				result.push('&quot;');
				break;
			case "'":
				result.push('&apos;');
				break;
			case '<':
				result.push('&lt;');
				break;
			case '>':
				result.push('&gt;');
				break;
			case '&':
				result.push('&amp;');
				break;
			case '\n':
				result.push('&#10;');
				break;
			case '\r':
				result.push('&#13;');
				break;
			default:
				result.push(ch);
		}
	}
	return result.join('');
}

function decodeEntities(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#10;/g, '\n')
		.replace(/&#13;/g, '\r')
		.replace(/&amp;/g, '&');
}
