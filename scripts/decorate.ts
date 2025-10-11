import { glob } from 'node:fs/promises';

import { dequal } from 'dequal';

import { findExternalReferences, lexiconDoc } from '@atcute/lexicon-doc';

import { type ScrapedEntry, scrapedEntrySchema } from '../types.ts';

/** Convert NSID to file path */
const nsidToPath = (nsid: string): string => {
	return `lexicons/${nsid.replaceAll('.', '/')}.json`;
};

/** Parse a ref string into NSID and defId (defaults to 'main' if no hash) */
const parseRef = (ref: string): { nsid: string; defId: string } => {
	const hashIndex = ref.indexOf('#');
	if (hashIndex === -1) {
		return { nsid: ref, defId: 'main' };
	}
	return {
		nsid: ref.slice(0, hashIndex),
		defId: ref.slice(hashIndex + 1),
	};
};

/** Recursively crawl all transitive dependencies for a given reference */
async function* crawlReferences(
	ref: string,
	visited: Set<string>,
): AsyncGenerator<string> {
	// Normalize ref to include #defId
	if (!ref.includes('#')) {
		ref = `${ref}#main`;
	}

	// Cycle detection
	if (visited.has(ref)) {
		return;
	}

	visited.add(ref);
	yield ref;

	const { nsid, defId } = parseRef(ref);
	const path = nsidToPath(nsid);

	// Try to load the referenced schema
	let entry: ScrapedEntry;
	try {
		const raw = await Deno.readTextFile(path);
		const json = JSON.parse(raw);
		entry = scrapedEntrySchema.parse(json, { mode: 'passthrough' });
	} catch (err) {
		// Only stop if the file doesn't exist, otherwise rethrow
		if (err instanceof Deno.errors.NotFound) {
			return;
		}

		throw err;
	}

	// Skip if schema is null
	if (entry.schema === null) {
		return;
	}

	// Parse schema as LexiconDoc
	const schema = lexiconDoc.parse(entry.schema, { mode: 'passthrough' });

	// Find external references in the specific def
	const externalRefs = findExternalReferences(schema, defId);

	// Recursively crawl each external reference
	for (const externalRef of externalRefs) {
		yield* crawlReferences(externalRef, visited);
	}
}

// Main processing
const entries = await Array.fromAsync(glob('**/*.json', { cwd: 'lexicons/' }));
const sortedEntries = entries.toSorted();

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

	// Build references for each def
	const references: Record<string, string[]> = {};

	// Parse schema as LexiconDoc
	const schema = lexiconDoc.parse(doc.schema, { mode: 'passthrough' });

	for (const defId in schema.defs) {
		const directRefs = findExternalReferences(schema, defId);

		// Collect all transitive dependencies (unique NSIDs only)
		const visited = new Set<string>();
		const allRefs = new Set<string>();

		for (const directRef of directRefs) {
			for await (const ref of crawlReferences(directRef, visited)) {
				// Filter out internal references (same document)
				const { nsid } = parseRef(ref);
				if (nsid !== schema.id) {
					allRefs.add(nsid);
				}
			}
		}

		references[defId] = Array.from(allRefs).sort();
		console.log(`  ${defId}: ${allRefs.size} references`);
	}

	// Add references to document
	(doc as Record<string, unknown>).references = references;

	// Only write if changed
	if (!dequal(originalDoc, doc)) {
		const json = JSON.stringify(doc, null, '\t');
		await Deno.writeTextFile(absname, json);
		console.log(`  updated`);
	} else {
		console.log(`  no changes`);
	}
}

console.log('done');
