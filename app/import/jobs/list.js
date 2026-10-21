import mongoose from 'mongoose'
import {UnrecoverableError} from 'bullmq'

import {getQueue} from '../queues.js'
import {getAdapter} from '../sources/index.js'
import {finish} from '../import.js'

const ImportItem = mongoose.model('ImportItem')
const ImportRun = mongoose.model('ImportRun')
const Tenant = mongoose.model('Tenant')

// "list" job: the whole catalogue of the source, page by page. Every product
// gets its ImportItem; a product job is added unless it's unchanged (always
// with a full run).
export async function handle(job, source){
	const {_run, full} = job.data

	const tenant = await Tenant.findOne({importSource: source}, {_id: 1}).lean()
	if(!tenant) throw new UnrecoverableError('no tenant for this source')

	const adapter = await getAdapter(source)
	let listed = 0

	for await (const page of adapter.list()){
		// Stopped or reset in the meantime: the run ends here
		if(!await ImportRun.exists({_id: _run, status: 'listing'})) return {cancelled: true, listed}

		await addPage(source, _run, tenant._id, page, full)
		listed += page.length

		await job.updateProgress({listed})
	}

	// An empty catalogue is most likely an error of the source, not a reason
	// to remove every product
	if(!listed && await ImportItem.exists({source})) throw new UnrecoverableError('empty listing')

	await ImportRun.updateOne({_id: _run, status: 'listing'}, {$set: {status: 'running', listedAt: new Date()}})
	await finish(_run) // every product job may be over already

	return {listed}
}

// The run fails, nothing is marked as gone
export async function failed(job, source, err){
	await ImportRun.updateOne({_id: job.data._run, status: 'listing'}, {
		$set: {status: 'failed', error: err.message, finishedAt: new Date()}
	})
}


// —— Private

async function addPage(source, _run, _tenant, page, full){
	const now = new Date()

	const existing = await ImportItem.find({source, externalId: {$in: page.map(p => p.externalId)}}, {externalId: 1, hash: 1, status: 1, _product: 1}).lean()
	const items = new Map(existing.map(item => [item.externalId, item]))

	// Same fingerprint as the last successful import
	const isUnchanged = ({externalId, hash}) => {
		if(full) return false

		const item = items.get(externalId)
		return !!hash && item?.hash === hash && !!item._product && ['imported', 'unchanged'].includes(item.status)
	}

	const unchanged = page.filter(isUnchanged)
	const todo = page.filter(p => !isUnchanged(p))

	// Native bulkWrite: mongoose would add the status default to $setOnInsert
	await ImportItem.collection.bulkWrite(page.map(p => ({
		updateOne: {
			filter: {source, externalId: p.externalId},
			update: {
				$set: {_tenant, ref: p.ref, listedAt: now, updatedAt: now, status: isUnchanged(p) ? 'unchanged' : 'pending'},
				$setOnInsert: {createdAt: now}
			},
			upsert: true
		}
	})))

	// Counted before the jobs exist, so they never reach the total too early
	await ImportRun.updateOne({_id: _run}, {$inc: {total: page.length, unchanged: unchanged.length}})

	// The listed hash is only saved by a successful product job
	await getQueue(source).addBulk(todo.map(p => ({
		name: 'product',
		data: {_run, externalId: p.externalId, hash: p.hash},
		opts: {jobId: `${_run}-${p.externalId}`.replaceAll(':', '_')} // ":" is reserved by BullMQ
	})))
}
