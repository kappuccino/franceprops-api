import mongoose from 'mongoose'

import {getQueue, KINDS} from './queues.js'
import {sources, sourceKeys, isSource, isConfigured} from './sources/index.js'

const ImportItem = mongoose.model('ImportItem')
const ImportRun = mongoose.model('ImportRun')
const Product = mongoose.model('Product')
const Tenant = mongoose.model('Tenant')

// Product jobs processed by a run (the unchanged products don't get a job,
// the listing counts them)
const PROCESSED = {$add: ['$created', '$updated', '$unchanged', '$failed', '$gone']}

const ACTIVE = ['listing', 'running']
const COUNTS = ['waiting', 'active', 'delayed', 'failed'] // a paused queue keeps its jobs in waiting


//——— Public

// A run: an ImportRun, then a "list" job which adds the product jobs. full:
// every product is imported again, unchanged or not (new fields or pictures
// to fetch, normalization changed)
export async function start(source, {full=false}={}){
	if(!isSource(source)) throw new Error('unknown source')
	if(!isConfigured(source)) throw new Error('source not configured')
	if(!await Tenant.exists({importSource: source})) throw new Error('no tenant for this source')
	if(await ImportRun.exists({source, status: {$in: ACTIVE}})) throw new Error('import already running')

	const run = await ImportRun.create({source, status: 'listing', full, startedAt: new Date()})

	// A single attempt: a listing started over would count its products twice
	await getQueue(source).add('list', {_run: run._id.toString(), full}, {jobId: `list-${run._id}`, attempts: 1})

	return run.toObject()
}

// The catalogue built again from the raw answers kept (ImportItem.raw), the
// source isn't called: a normalization changed. A run of its own, exclusive
// with the imports.
export async function rebuild(source){
	if(!isSource(source)) throw new Error('unknown source')
	if(!isConfigured(source)) throw new Error('source not configured')
	if(await ImportRun.exists({source, status: {$in: ACTIVE}})) throw new Error('import already running')

	const run = await ImportRun.create({source, type: 'rebuild', status: 'running', startedAt: new Date()})

	// A single attempt: started over, it would count its products twice
	await getQueue(source).add('rebuild', {_run: run._id.toString()}, {jobId: `rebuild-${run._id}`, attempts: 1})

	return run.toObject()
}

// State of every source: its tenant, its queue, its last run
export async function getSources(){
	const tenants = await Tenant.find({importSource: {$in: sourceKeys}}, {name: 1, importSource: 1}).lean()

	return Promise.all(sourceKeys.map(async key => {
		const configured = isConfigured(key)
		const queue = configured && getQueue(key)

		const pictures = configured && getQueue(key, 'pictures')

		const [paused, counts, pictureCounts, workers, lastRun] = await Promise.all([
			queue ? queue.isPaused() : false,
			queue ? queue.getJobCounts(...COUNTS) : {},
			pictures ? pictures.getJobCounts(...COUNTS) : {},
			queue ? countWorkers(queue) : null,
			ImportRun.findOne({source: key}).sort({startedAt: -1}).lean()
		])

		return {
			key,
			label: sources[key].label,
			configured,
			tenant: tenants.find(t => t.importSource === key) || null,
			paused,
			counts,
			pictureCounts,
			workers,
			lastRun
		}
	}))
}

export async function getRuns(source, limit=20){
	return ImportRun.find({source}).sort({startedAt: -1}).limit(Math.min(limit, 100)).lean()
}

// Failed jobs of a queue (catalogue or pictures), kept 7 days (removeOnFail),
// the most recent first. ref: the product of each job.
export async function getFailedJobs(source, {kind='catalogue', limit=50, skip=0}={}){
	const queue = getQueue(source, kind)

	const [total, jobs] = await Promise.all([
		queue.getFailedCount(),
		queue.getFailed(skip, skip + limit - 1)
	]).then(([total, jobs]) => [total, jobs.filter(Boolean)])

	const refs = await jobRefs(source, jobs)

	return {
		total,
		data: jobs.map(job => ({
			id: job.id,
			name: job.name,
			data: job.data,
			ref: refs.get(job.id) || null,
			failedReason: job.failedReason,
			stacktrace: job.stacktrace || [],
			attemptsMade: job.attemptsMade,
			createdAt: job.timestamp ? new Date(job.timestamp) : null,
			failedAt: job.finishedOn ? new Date(job.finishedOn) : null
		}))
	}
}

// The jobs in progress end, no new one starts. Not while listing or
// rebuilding: a single job goes on until its end, stop() is the way to end it.
// The pictures queue follows.
export async function pause(source){
	if(await ImportRun.exists({source, $or: [{status: 'listing'}, {status: 'running', type: 'rebuild'}]})) throw new Error('import listing')

	await Promise.all(KINDS.map(kind => getQueue(source, kind).pause()))
}

export async function resume(source){
	await Promise.all(KINDS.map(kind => getQueue(source, kind).resume()))
}

// The run in progress ends: the listing stops at its next page, the waiting
// product jobs are removed, the active ones end. Nothing is marked as gone,
// the failed jobs stay (unlike reset). The pictures already queued go on:
// their products are imported.
export async function stop(source){
	const res = await ImportRun.updateMany({source, status: {$in: ACTIVE}}, {
		$set: {status: 'stopped', finishedAt: new Date()}
	})

	if(!res.modifiedCount) throw new Error('no import running')

	await getQueue(source).drain(true)
}

// Both queues are emptied completely (waiting, active, failed jobs, and their
// paused state). The run in progress stops without marking anything as gone;
// ImportItem and Product stay as they are (pictures pending until the next
// import of their product).
export async function reset(source){
	await Promise.all(KINDS.map(kind => getQueue(source, kind).obliterate({force: true})))

	await ImportRun.updateMany({source, status: {$in: ACTIVE}}, {
		$set: {status: 'reset', finishedAt: new Date()}
	})
}

// A failed job, or all of them, in both queues. A product job is no longer
// counted as failed by its run (a "list" job is not retried: a new import is
// started instead).
export async function retry(source, jobId){
	let retried = 0

	for(const kind of KINDS){
		const queue = getQueue(source, kind)

		const jobs = jobId
			? [await queue.getJob(jobId)]
			: await queue.getFailed(0, -1)

		for(const job of jobs){
			if(!['product', 'picture'].includes(job?.name) || !await job.isFailed()) continue

			await job.retry('failed')
			retried++

			if(job.name !== 'product') continue

			await ImportItem.updateOne({source, externalId: job.data.externalId}, {$set: {status: 'pending', updatedAt: new Date()}})
			await ImportRun.updateOne({_id: job.data._run, failed: {$gt: 0}}, {$inc: {failed: -1}})
		}
	}

	return retried
}

// A counter of the run, then the run may be over
export async function count(_run, field, n=1){
	await ImportRun.updateOne({_id: _run}, {$inc: {[field]: n}})
	return finish(_run)
}

// Over once the listing is done and every product job processed. The update
// is atomic: a single caller wins it, and marks the gone products. Never a
// rebuild (it ends itself, nothing is gone).
export async function finish(_run){
	const run = await ImportRun.findOneAndUpdate(
		{_id: _run, status: 'running', type: {$ne: 'rebuild'}, $expr: {$gte: [PROCESSED, '$total']}},
		{$set: {status: 'done', finishedAt: new Date()}},
		{new: true}
	).lean()

	if(run) await markGone(run)
}

// The product of an item is no longer at its source: hidden on the site
export async function removeProduct(_product){
	if(!_product) return

	const now = new Date()
	await Product.updateOne({_id: _product, removedAt: null}, {$set: {removedAt: now, updatedAt: now}})
}


// —— Private

// Ref of the product of each job: listed (product job), or imported (picture job)
async function jobRefs(source, jobs){
	const externalIds = jobs.map(job => job.data?.externalId).filter(Boolean)
	const _products = jobs.map(job => job.data?._product).filter(Boolean)

	const [items, products] = await Promise.all([
		externalIds.length ? ImportItem.find({source, externalId: {$in: externalIds}}, {externalId: 1, ref: 1}).lean() : [],
		_products.length ? Product.find({_id: {$in: _products}}, {ref: 1}).lean() : []
	])

	return new Map(jobs.map(job => [job.id,
		job.data?._product
			? products.find(product => product._id.toString() === job.data._product)?.ref
			: items.find(item => item.externalId === job.data?.externalId)?.ref
	]))
}

// Workers connected to the queue (CLIENT LIST, which some hosted Redis refuse)
async function countWorkers(queue){
	try {
		return await queue.getWorkersCount()
	} catch(err){
		return null
	}
}

// Items missing from the listing of a complete run (listed before it started).
// Never after a failed listing or a reset: the run is not "done".
async function markGone(run){
	const items = await ImportItem.find({source: run.source, listedAt: {$lt: run.startedAt}, status: {$ne: 'gone'}}, {_product: 1}).lean()
	if(!items.length) return

	await ImportItem.updateMany({_id: {$in: items.map(item => item._id)}}, {$set: {status: 'gone', updatedAt: new Date()}})
	for(const item of items) await removeProduct(item._product)

	await ImportRun.updateOne({_id: run._id}, {$inc: {gone: items.length}})
}
