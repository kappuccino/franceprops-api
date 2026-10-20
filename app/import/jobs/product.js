import mongoose from 'mongoose'
import {UnrecoverableError} from 'bullmq'

import {getAdapter} from '../sources/index.js'
import {count, removeProduct} from '../import.js'

const ImportItem = mongoose.model('ImportItem')
const Product = mongoose.model('Product')

// "product" job: the raw product goes to its ImportItem, its normalized
// fields to the Product of the catalogue (created on the first import)
export async function handle(job, source){
	const {_run, externalId, hash} = job.data

	const item = await ImportItem.findOne({source, externalId})
	if(!item) throw new UnrecoverableError('import item not found')

	const adapter = await getAdapter(source)
	const raw = await adapter.fetchProduct(externalId)

	// Gone between the listing and now
	if(!raw){
		item.set({status: 'gone', error: undefined})
		await item.save()

		await removeProduct(item._product)
		await count(_run, 'gone')
		return 'gone'
	}

	const fields = adapter.normalize(raw)

	let $product = item._product && await Product.findOne({_id: item._product})
	const isNew = !$product

	if(isNew) $product = new Product({source, externalId, _importItem: item._id})

	// Back at the source: visible again
	$product.set({...fields, _tenant: item._tenant, removedAt: undefined})

	await $product.save()

	item.set({raw, hash, status: 'imported', error: undefined, importedAt: new Date(), _product: $product._id})
	item.markModified('raw')
	await item.save()

	const result = isNew ? 'created' : 'updated'
	await count(_run, result)

	return result
}

// Last attempt: the item keeps the error, the run counts it
export async function failed(job, source, err){
	const {_run, externalId} = job.data

	await ImportItem.updateOne({source, externalId}, {$set: {status: 'error', error: err.message, updatedAt: new Date()}})
	await count(_run, 'failed')
}
