// Checks the access to a catalogue source, without writing anything: lists the
// whole catalogue, then fetches and normalizes one product.
// Usage: npm run import:probe -- <source> [externalId] [--raw]
import {isSource, isConfigured, getAdapter} from '../app/import/sources/index.js'

const args = process.argv.slice(2)
const showRaw = args.includes('--raw')
const [source, externalId] = args.filter(arg => arg !== '--raw')

if(!isSource(source)){
	console.log('Usage: npm run import:probe -- <source> [externalId] [--raw]')
	process.exit(1)
}

if(!isConfigured(source)){
	console.error(`${source}: not configured (.env)`)
	process.exit(1)
}

try {
	const adapter = await getAdapter(source)

	const started = Date.now()
	const items = []

	for await (const page of adapter.list()){
		items.push(...page)
		console.log(`page → ${page.length} products`)
	}

	console.log(`${items.length} products listed in ${Date.now() - started} ms`)
	console.log(items.slice(0, 5))

	const _id = externalId || items[0]?.externalId
	if(_id){
		const raw = await adapter.fetchProduct(_id)
		if(showRaw) console.dir(raw, {depth: null})

		console.log(`${_id} →`, raw ? adapter.normalize(raw) : 'gone')
	}
} catch(err){
	console.error(`🔥 ${err.message}`)
	process.exit(1)
}
