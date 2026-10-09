// Several selections per customer: drops the former unique index on _customer,
// names the existing selections and marks the active one of each customer.
// Safe to run twice.
// Usage: node -r dotenv/config scripts/migrate-selections.js [--dry]
import mongoose from 'mongoose'

const dry = process.argv.includes('--dry')
const DEFAULT_NAME = 'Ma sélection'

await mongoose.connect(process.env.MONGO)
const db = mongoose.connection.db
const selections = db.collection('selection')

const legacy = (await selections.indexes()).find(i => i.name === '_customer_1' && i.unique)
if(legacy){
	console.log('drop unique index _customer_1', dry ? '(dry)' : '')
	if(!dry) await selections.dropIndex('_customer_1')
}

const unnamed = await selections.countDocuments({name: {$exists: false}})
console.log(`name ${unnamed} selection(s)`, dry ? '(dry)' : '')
if(!dry) await selections.updateMany({name: {$exists: false}}, {$set: {name: DEFAULT_NAME}})

for(const selection of await selections.find({_customer: {$exists: true}}).toArray()){
	const customer = await db.collection('customer').findOne({_id: selection._customer}, {projection: {_selection: 1}})
	if(!customer || customer._selection) continue

	console.log('active selection of', customer._id.toString(), '→', selection._id.toString(), dry ? '(dry)' : '')
	if(!dry) await db.collection('customer').updateOne({_id: customer._id}, {$set: {_selection: selection._id}})
}

await mongoose.disconnect()
