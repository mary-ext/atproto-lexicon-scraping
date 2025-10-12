import {
	type CanonicalResourceUri,
	type Datetime,
	type Did,
	type Nsid,
	parseCanonicalResourceUri,
	type ParsedCanonicalResourceUri,
} from '@atcute/lexicons';
import { isNsid } from '@atcute/lexicons/syntax';

import { ScrapedEntry } from '../types.ts';

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

console.log(`starting slices backfill at ${startedAt}`);

let cursor: string | undefined;
do {
	console.log(`fetching ${cursor ?? '<root>'}`);

	const response = await fetch(`https://api.slices.network/xrpc/com.atproto.lexicon.schema.getRecords`, {
		method: 'post',
		headers: {
			'content-type': 'application/json',
			'user-agent': 'github:mary-ext/atproto-lexicon-scraping',
		},
		body: JSON.stringify({
			slice: 'at://did:plc:fpruhuo22xkm5o7ttr2ktxdo/network.slices.slice/3m2f7adwhp22a',
			limit: 200,
			cursor: cursor,
		}),
	});

	const data = await response.json() as {
		cursor: string | undefined;
		records: {
			cid: string;
			collection: Nsid;
			did: Did;
			indexedAt: Datetime;
			uri: CanonicalResourceUri;
			value: unknown;
		}[];
	};

	for (const record of data.records) {
		const { rkey: nsid } = assertCanonicalResourceUri(record.uri);
		if (!isNsid(nsid)) {
			continue;
		}

		if (foundNsids.has(nsid)) {
			continue;
		}

		console.log(`  found ${nsid}`);
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
		} catch (err) {
			if (err instanceof Deno.errors.AlreadyExists) {
				continue;
			}

			throw err;
		}
	}

	if (cursor !== data.cursor) {
		cursor = data.cursor;
	} else {
		cursor = undefined;
	}
} while (cursor !== undefined);
