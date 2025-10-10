import { JetstreamSubscription } from '@atcute/jetstream';
import { isNsid, type Nsid } from '@atcute/lexicons/syntax';

import { type ScrapedEntry, type State, stateSchema } from '../types.ts';

let state: State | undefined;
jmp: try {
	const raw = await Deno.readTextFile('state.json');
	const json = JSON.parse(raw);

	state = stateSchema.parse(json);
} catch (err) {
	if (err instanceof Deno.errors.NotFound) {
		break jmp;
	}

	throw err;
}

const subscription = new JetstreamSubscription({
	cursor: state?.jetstream.cursor,
	url: [
		'wss://jetstream1.us-east.bsky.network',
		'wss://jetstream2.us-east.bsky.network',
		'wss://jetstream1.us-west.bsky.network',
		'wss://jetstream2.us-west.bsky.network',
	],
	wantedCollections: ['com.atproto.lexicon.schema'],
});

const foundNsids = new Set<Nsid>();
const startedAt = Date.now();

console.log(`starting replay at ${startedAt}`);

for await (const evt of subscription) {
	if (evt.time_us / 1_000_000 > Date.now() / 1_000 - 3) {
		break;
	}

	if (evt.kind !== 'commit') {
		continue;
	}

	const commit = evt.commit;
	const nsid = commit.rkey;

	if (commit.operation === 'create' || commit.operation === 'update') {
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
}

state = {
	jetstream: {
		cursor: subscription.cursor,
	},
};

{
	const json = JSON.stringify(state, null, '\t');
	await Deno.writeTextFile('state.json', json);
}
