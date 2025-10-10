import type { DidDocument } from '@atcute/identity';
import {
	CompositeDidDocumentResolver,
	type DidDocumentResolver,
	PlcDidDocumentResolver,
	type ResolveDidDocumentOptions,
	WebDidDocumentResolver,
} from '@atcute/identity-resolver';
import type { Did } from '@atcute/lexicons';

interface CachedDidDocumentResolverOptions<TMethod extends string = string> {
	resolver: DidDocumentResolver<TMethod>;
}

class CachedDidDocumentResolver<TMethod extends string = string> implements DidDocumentResolver<TMethod> {
	cache = new Map<Did, Promise<DidDocument>>();

	resolver: DidDocumentResolver<TMethod>;

	constructor({ resolver }: CachedDidDocumentResolverOptions<TMethod>) {
		this.resolver = resolver;
	}

	async resolve(did: Did<TMethod>, options?: ResolveDidDocumentOptions): Promise<DidDocument> {
		let promise: Promise<DidDocument> | undefined;
		while ((promise = this.cache.get(did))) {
			try {
				const doc = await promise;
				return doc;
			} catch {
				/* do nothing */
			}
		}

		promise = this.resolver.resolve(did, options);
		this.cache.set(did, promise);

		promise.catch(() => {
			this.cache.delete(did);
		});

		{
			const doc = await promise;
			return doc;
		}
	}
}

export const didDocumentResolver = new CachedDidDocumentResolver({
	resolver: new CompositeDidDocumentResolver({
		methods: {
			web: new WebDidDocumentResolver(),
			plc: new PlcDidDocumentResolver({ apiUrl: 'https://plc.wtf' }),
		},
	}),
});
