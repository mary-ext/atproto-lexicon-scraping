import '@atcute/atproto';

import { Client, ClientResponseError, ok, simpleFetchHandler } from '@atcute/client';
import { type DidDocument, getAtprotoHandle, getPdsEndpoint } from '@atcute/identity';
import { type Nsid, parseCanonicalResourceUri, type ParsedCanonicalResourceUri } from '@atcute/lexicons';
import { type AtprotoDid, isNsid } from '@atcute/lexicons/syntax';

import { didDocumentResolver } from '../doc.ts';
import { ScrapedEntry } from '../types.ts';

const relayClient = new Client({
	handler: simpleFetchHandler({ service: 'https://relay1.us-west.bsky.network' }),
});

const assert: {
	(condition: boolean, message?: string): asserts condition;
} = (condition, message) => {
	if (!condition) {
		throw new Error(message ? `Assertion failed: ${message}` : `Assertion failed`);
	}
};

const assertCanonicalResourceUri = (input: string): ParsedCanonicalResourceUri => {
	const result = parseCanonicalResourceUri(input);
	if (!result.ok) {
		assert(false, result.error);
	}

	return result.value;
};

const foundNsids = new Set<Nsid>();
const startedAt = Date.now();

console.log(`starting backfill at ${startedAt}`);

let repoCursor: string | undefined;
do {
	const backfills = await ok(relayClient.get('com.atproto.sync.listReposByCollection', {
		headers: {
			'user-agent': 'github:mary-ext/atproto-lexicon-scraping',
		},
		params: {
			collection: 'com.atproto.lexicon.schema',
			cursor: repoCursor,
			limit: 2_000,
		},
	}));

	repoCursor = backfills.cursor;

	for (const { did } of backfills.repos) {
		console.log(`processing ${did}`);

		let didDocument: DidDocument;
		try {
			didDocument = await didDocumentResolver.resolve(did as AtprotoDid, {
				signal: AbortSignal.timeout(5_000),
			});
		} catch (err) {
			console.log(`  failed to retrieve did document`);
			console.error(err);
			continue;
		}

		const handle = getAtprotoHandle(didDocument);
		console.log(`  resolved document with a handle of ${handle || `<no handle>`}`);

		const pdsUrl = getPdsEndpoint(didDocument);
		if (pdsUrl === undefined) {
			console.log(`  no pds endpoint found`);
			continue;
		}

		console.log(`  pds endpoint on ${pdsUrl}`);

		const pdsClient = new Client({
			handler: simpleFetchHandler({ service: pdsUrl }),
		});

		try {
			let cursor: string | undefined;
			do {
				const data = await ok(
					pdsClient.get('com.atproto.repo.listRecords', {
						signal: AbortSignal.timeout(5_000),
						headers: {
							'user-agent': 'github:mary-ext/atproto-lexicon-scraping',
						},
						params: {
							repo: did,
							collection: 'com.atproto.lexicon.schema',
							cursor: cursor,
							limit: 100,
						},
					}),
				);

				cursor = data.cursor;

				for (const { uri } of data.records) {
					const { rkey: nsid } = assertCanonicalResourceUri(uri);
					if (!isNsid(nsid)) {
						continue;
					}

					if (foundNsids.has(nsid)) {
						continue;
					}

					foundNsids.add(nsid);

					const doc: ScrapedEntry = {
						authority: null,
						schema: null,
						meta: {},
					};

					const segments = nsid.split('.');

					const dirname = `lexicons/${segments.slice(0, -1).join('/')}`;
					const filename = `${dirname}/${segments.at(-1)!}.json`;

					const json = JSON.stringify(doc, null, '\t');

					await Deno.mkdir(dirname, { recursive: true });

					try {
						await Deno.writeTextFile(filename, json, { createNew: true });
						console.log(`  found ${nsid} [new]`);
					} catch (err) {
						if (err instanceof Deno.errors.AlreadyExists) {
							console.log(`  found ${nsid}`);
							continue;
						}

						throw err;
					}
				}
			} while (cursor !== undefined);
		} catch (err) {
			if (err instanceof ClientResponseError) {
				console.log(`  pds responded with ${err.status}`);
			} else {
				console.log(`  pds failed to respond`);
			}

			console.error(err);
			continue;
		}
	}

	repoCursor = backfills.cursor;
} while (repoCursor !== undefined);
