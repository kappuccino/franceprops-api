// The product ref is no longer unique within a tenant (Lanzani reuses its refs,
// some products have none, Defrise has "OU156" and "OU156 "): drops the former
// unique index and creates the plain one. Safe to run twice.
// Usage: npm run migrate:product-ref [-- --dry]
import mongoose from 'mongoose'

const dry = process.argv.includes('--dry')

await mongoose.connect(process.env.MONGO)
const products = mongoose.connection.db.collection('product')

const unique = (await products.indexes()).find(i => i.name === '_tenant_1_ref_1' && i.unique)
if(unique){
	console.log('drop unique index _tenant_1_ref_1', dry ? '(dry)' : '')
	if(!dry) await products.dropIndex('_tenant_1_ref_1')
}

// Same name, the collection collation (fr) applies
console.log('create index _tenant_1_ref_1', dry ? '(dry)' : '')
if(!dry) await products.createIndex({_tenant: 1, ref: 1})

await mongoose.disconnect()
