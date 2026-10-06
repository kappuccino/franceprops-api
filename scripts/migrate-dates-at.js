// Renames every date field to *At (created → createdAt, …). Safe to run twice:
// only the documents still holding the old name are changed.
// Usage: node -r dotenv/config scripts/migrate-dates-at.js [--dry]
import mongoose from 'mongoose'

const dry = process.argv.includes('--dry')

const BASE = {created: 'createdAt', updated: 'updatedAt'}

// Top level fields
const RENAMES = {
	'tenant': BASE,
	'template': BASE,
	'user': BASE,
	'product': BASE,
	'taxonomy': BASE,
	'selection': BASE,
	'customer': BASE,
	'media': BASE,
	'settings': {updated: 'updatedAt'},
	'mail-queue': {date: 'createdAt', resent: 'resentAt'},
}

// Fields inside the items of an array
const ARRAYS = [
	{collection: 'selection', path: 'items', from: 'added', to: 'addedAt'},
	{collection: 'mail-queue', path: 'events', from: 'date', to: 'occurredAt'},
	{collection: 'version', path: 'versions', from: 'date', to: 'createdAt'},
]

await mongoose.connect(process.env.MONGO)
const db = mongoose.connection.db

for(const [name, fields] of Object.entries(RENAMES)){
	const col = db.collection(name)

	for(const [from, to] of Object.entries(fields)){
		const filter = {[from]: {$exists: true}, [to]: {$exists: false}}
		const count = await col.countDocuments(filter)
		if(count && !dry) await col.updateMany(filter, {$rename: {[from]: to}})

		console.log(`${name}.${from} → ${to}`.padEnd(42), count, dry ? '(dry)' : '')
	}
}

for(const {collection, path, from, to} of ARRAYS){
	const col = db.collection(collection)
	const filter = {[`${path}.${from}`]: {$exists: true}}
	const count = await col.countDocuments(filter)

	// Every item: the old field removed, its value under the new name
	if(count && !dry){
		await col.updateMany(filter, [{
			$set: {
				[path]: {
					$map: {
						input: `$${path}`,
						as: 'item',
						in: {
							$mergeObjects: [
								{$arrayToObject: {$filter: {input: {$objectToArray: '$$item'}, as: 'f', cond: {$ne: ['$$f.k', from]}}}},
								{[to]: `$$item.${from}`}
							]
						}
					}
				}
			}
		}])
	}

	console.log(`${collection}.${path}[].${from} → ${to}`.padEnd(42), count, dry ? '(dry)' : '')
}

// The mail-queue TTL index moves from date to createdAt (created by the api at start)
const indexes = await db.collection('mail-queue').indexes()
if(indexes.some(i => i.name === 'date_1')){
	if(!dry) await db.collection('mail-queue').dropIndex('date_1')
	console.log('mail-queue: index date_1 supprimé', dry ? '(dry)' : '')
}

await mongoose.disconnect()
