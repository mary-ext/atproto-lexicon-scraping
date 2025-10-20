import { glob } from 'node:fs/promises';

import { findExternalReferences, lexiconDoc } from '@atcute/lexicon-doc';
import { Nsid } from '@atcute/lexicons';

import { type ScrapedEntry, scrapedEntrySchema } from '../types.ts';

const parseRef = (ref: string): { nsid: Nsid; defId: string } => {
	const hashIndex = ref.indexOf('#');
	if (hashIndex === -1) {
		return { nsid: ref as Nsid, defId: 'main' };
	}
	return {
		nsid: ref.slice(0, hashIndex) as Nsid,
		defId: ref.slice(hashIndex + 1),
	};
};

const entries = await Array.fromAsync(glob('**/*.json', { cwd: 'lexicons/' }));
const sortedEntries = entries.toSorted();

const foundNsids = new Set<Nsid>();

console.log(`processing ${sortedEntries.length} entries`);

for await (const relname of sortedEntries) {
	const absname = `lexicons/${relname}`;
	console.log(`processing ${relname}`);

	let originalDoc: ScrapedEntry;
	let doc: ScrapedEntry;

	{
		const raw = await Deno.readTextFile(absname);
		const json = JSON.parse(raw);

		originalDoc = scrapedEntrySchema.parse(json, { mode: 'passthrough' });
		doc = structuredClone(originalDoc);
	}

	// Skip if schema is null
	if (doc.schema === null) {
		console.log(`  skipping (schema is null)`);
		continue;
	}

	const schema = lexiconDoc.parse(doc.schema, { mode: 'passthrough' });
	const refs = findExternalReferences(schema);

	for (const ref of refs) {
		const { nsid } = parseRef(ref);

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
}
