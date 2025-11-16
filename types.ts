import { isDid, isNsid } from '@atcute/lexicons/syntax';
import * as v from '@badrap/valita';

const didString = v.string().assert((input) => isDid(input), `must be a did`);
const nsidString = v.string().assert((input) => isNsid(input), `must be an nsid`);

const int = v.number().assert(
	(input) => input >= 0 && Number.isSafeInteger(input),
	`must be a nonnegative integer`,
);

const dateInt = v.number().chain((value) => {
	const date = new Date(value);
	const ts = date.getTime();

	if (Number.isNaN(ts)) {
		return v.err(`invalid date`);
	}

	return v.ok(ts);
});

export const bareDocSchema = v.object({
	lexicon: int,
	id: nsidString,
});

export type BareDocument = v.Infer<typeof bareDocSchema>;

export const scrapedEntrySchema = v.object({
	authority: didString.nullable(),
	schema: bareDocSchema.nullable(),
	meta: v.object({
		indexedAt: dateInt.optional(),
		errorAt: dateInt.optional(),
	}),
});

export type ScrapedEntry = v.Infer<typeof scrapedEntrySchema>;
