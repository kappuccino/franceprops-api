// Catalogue sources, one per tenant (Tenant.importSource). Their accesses come
// from the .env: a source without them is "not configured", it can't be started
// and the worker ignores it.
//
// Each source has its own file (sources/<key>.js), with its own fetch logic:
//   list() → async iterable of pages [{externalId, hash, ref}], the full catalogue
//   fetchProduct(externalId) → raw product, null when it's gone
//   normalize(raw) → FranceProps product fields {ref, title}, same shape for every source
export const sources = {
	xxo: {
		label: 'XXO',
		env: ['XXO_API_URL', 'XXO_API_TOKEN'],
		adapter: () => import('./xxo.js')
	},

	defrise: {
		label: 'Defrise',
		env: ['DEFRISE_API_URL', 'DEFRISE_API_TOKEN'],
		adapter: () => import('./defrise.js')
	},

	lanzani: {
		label: 'Lanzani',
		env: ['LANZANI_API_URL', 'LANZANI_API_TOKEN'],
		adapter: () => import('./lanzani.js')
	},

	// Access still unknown
	les2ailleurs: {
		label: 'Les 2 Ailleurs',
		env: null
	}
}

export const sourceKeys = Object.keys(sources)

export function isSource(key){
	return Object.hasOwn(sources, key || '')
}

export function isConfigured(key){
	const env = sources[key]?.env
	return !!env?.length && env.every(name => process.env[name])
}

export async function getAdapter(key){
	if(!sources[key]?.adapter) throw new Error(`no adapter for the source "${key}"`)
	return sources[key].adapter()
}

// Jobs processed in parallel by the worker (product jobs, the list is alone)
export function concurrency(key){
	return sources[key]?.concurrency || Number(process.env.IMPORT_CONCURRENCY) || 4
}
