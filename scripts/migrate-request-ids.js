// Renumbers every request, oldest first, the way the save hook does: a request
// gets the next id, a revision (_previous) keeps the id of its chain with the
// next revision. Deterministic, safe to run twice. Also drops the former unique
// index on id alone.
// Usage: node -r dotenv/config scripts/migrate-request-ids.js [--dry]
import mongoose from 'mongoose'

const dry = process.argv.includes('--dry')

await mongoose.connect(process.env.MONGO)
const requests = mongoose.connection.db.collection('request')

const legacy = (await requests.indexes()).find(i => i.name === 'id_1' && i.unique)
if(legacy){
	console.log('drop unique index id_1', dry ? '(dry)' : '')
	if(!dry) await requests.dropIndex('id_1')
}

const all = await requests.find({}, {projection: {_previous: 1, createdAt: 1}}).sort({createdAt: 1, _id: 1}).toArray()

const numbers = new Map()
const revisions = new Map()
let id = 0

for(const request of all){
	const previous = request._previous && numbers.get(request._previous.toString())

	const number = previous
		? {id: previous.id, revision: (revisions.get(previous.id) || 0) + 1}
		: {id: ++id, revision: 0}

	numbers.set(request._id.toString(), number)
	revisions.set(number.id, number.revision)

	const label = number.revision ? `${number.id}.${number.revision}` : `${number.id}`
	console.log(`#${label}`, request._id.toString(), request.createdAt?.toISOString() || '', dry ? '(dry)' : '')
}

if(!dry){
	// Unset first so the unique {id, revision} index never sees a transient duplicate
	await requests.updateMany({}, {$unset: {id: '', revision: ''}})
	for(const [_id, number] of numbers){
		await requests.updateOne({_id: new mongoose.Types.ObjectId(_id)}, {$set: number})
	}
}

await mongoose.disconnect()
