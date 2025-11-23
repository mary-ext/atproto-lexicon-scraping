import { glob } from 'node:fs/promises';

import { differenceInDays } from 'date-fns/differenceInDays';
import { dequal } from 'dequal';

import { refineLexiconDoc } from '@atcute/lexicon-doc';
import {
	DohJsonLexiconAuthorityResolver,
	LexiconSchemaResolver,
	type ResolvedSchema,
} from '@atcute/lexicon-resolver';
import { type AtprotoDid, isNsid, type Nsid } from '@atcute/lexicons/syntax';

import { didDocumentResolver } from '../doc.ts';
import { BareDocument, type ScrapedEntry, scrapedEntrySchema } from '../types.ts';

const authorityResolver = new DohJsonLexiconAuthorityResolver({
	dohUrl: 'https://mozilla.cloudflare-dns.com/dns-query',
});

const schemaResolver = new LexiconSchemaResolver({
	didDocumentResolver: didDocumentResolver,
});

const assert: {
	(condition: boolean, message?: string): asserts condition;
} = (condition, message) => {
	if (!condition) {
		throw new Error(message ? `Assertion failed: ${message}` : `Assertion failed`);
	}
};

/** If now and `errorAt` has passed this amount of days, it should stop tracking. */
const MAX_FAILURE_DAYS = 14;

const entries = await Array.fromAsync(glob('**/*.json', { cwd: 'lexicons/' }));
const sortedEntries = entries.toSorted();
const startedAt = Date.now();

console.log(`starting refresh at ${startedAt}`);

for await (const relname of sortedEntries) {
	const absname = `lexicons/${relname}`;

	let originalDoc: ScrapedEntry;
	let doc: ScrapedEntry;
	let nsid: Nsid;
	let status: 'ok' | 'fail' | undefined;

	{
		const raw = relname.replace(/\.json$/, '').replaceAll('/', '.');
		assert(isNsid(raw));

		nsid = raw;
	}

	console.log(`processing ${nsid}`);

	{
		const raw = await Deno.readTextFile(absname);
		const json = JSON.parse(raw);

		originalDoc = scrapedEntrySchema.parse(json, { mode: 'passthrough' });
		doc = structuredClone(originalDoc);
	}

	main: {
		let authority: AtprotoDid;
		try {
			authority = await authorityResolver.resolve(nsid, {
				signal: AbortSignal.timeout(5_000),
			});
		} catch (err) {
			console.log(`  failed to resolve authority`);
			console.error(err);

			break main;
		}

		console.log(`  authority is ${authority}`);
		doc.authority = authority;

		let resolved: ResolvedSchema;
		try {
			resolved = await schemaResolver.resolve(authority, nsid, {
				signal: AbortSignal.timeout(5_000),
			});
		} catch (err) {
			console.log(`  failed to resolve schema`);
			console.error(err);

			break main;
		}

		const issues = refineLexiconDoc(resolved.schema, true);
		if (issues.length > 0) {
			console.log(`  found linting errors`);

			for (const issue of issues) {
				console.log(`    - .${issue.path.join('.')}: ${issue.message}`);
			}

			break main;
		}

		if (!dequal(resolved.schema, doc.schema)) {
			doc.schema = resolved.schema as BareDocument;
			doc.meta.indexedAt = startedAt;
		}

		status = 'ok';
	}

	if (status === undefined) {
		if (doc.authority === null || doc.schema === null) {
			status = 'fail';
		} else {
			const errorAt = doc.meta.errorAt;

			if (errorAt === undefined) {
				doc.meta.errorAt = startedAt;
			} else if (differenceInDays(startedAt, errorAt) > MAX_FAILURE_DAYS) {
				status = 'fail';
			}
		}
	}

	if (status === 'fail') {
		try {
			await Deno.remove(absname);
		} catch (err) {
			if (err instanceof Deno.errors.NotFound) {
				continue;
			}

			throw err;
		}
	} else if (!dequal(originalDoc, doc)) {
		const json = JSON.stringify(doc, null, '\t');

		await Deno.writeTextFile(absname, json);
	}
}
