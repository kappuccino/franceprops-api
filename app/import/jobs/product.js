import mongoose from 'mongoose'
import {UnrecoverableError} from 'bullmq'

import {getAdapter} from '../sources/index.js'
import {count, removeProduct} from '../import.js'
import {buildProduct} from '../catalogue.js'

const ImportItem = mongoose.model('ImportItem')
const ImportRun = mongoose.model('ImportRun')

// "product" job: the raw product goes to its ImportItem, its normalized
// fields to the Product of the catalogue (created on the first import), its
// pictures to the picture queue
export async function handle(job, source){
	const {_run, externalId, hash} = job.data

	// Run stopped or reset: a job added by its last listed page after the
	// drain does nothing (the item stays pending until the next run)
	if(await ImportRun.exists({_id: _run, status: {$in: ['stopped', 'reset']}})) return 'cancelled'

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

	// Back at the source: visible again
	const {isNew, _product} = await buildProduct(source, item, adapter, raw, {revive: true})

	item.set({raw, hash, status: 'imported', error: undefined, importedAt: new Date(), _product})
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
