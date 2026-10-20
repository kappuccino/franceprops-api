// Removes the mock products (every product without a source), before the first
// import. The selections lose them too, the requests keep their copy (ref, title).
// Usage: npm run drop:mock-products [-- --dry]
import mongoose from 'mongoose'

const dry = process.argv.includes('--dry')

await mongoose.connect(process.env.MONGO)
const db = mongoose.connection.db

const mocks = {source: {$exists: false}}
const ids = await db.collection('product').distinct('_id', mocks)

const tenants = await db.collection('product').aggregate([
	{$match: mocks},
	{$group: {_id: '$_tenant', count: {$sum: 1}}}
]).toArray()

for(const {_id, count} of tenants){
	const tenant = await db.collection('tenant').findOne({_id}, {projection: {name: 1}})
	console.log(`${tenant?.name || _id}: ${count} product(s)`)
}

const selections = await db.collection('selection').countDocuments({'items._product': {$in: ids}})

console.log(`remove ${ids.length} product(s), from ${selections} selection(s) too`, dry ? '(dry)' : '')

if(!dry && ids.length){
	await db.collection('selection').updateMany({'items._product': {$in: ids}}, {$pull: {items: {_product: {$in: ids}}}})
	await db.collection('product').deleteMany({_id: {$in: ids}})
}

await mongoose.disconnect()
