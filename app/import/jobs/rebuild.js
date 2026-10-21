import mongoose from 'mongoose'

import {getAdapter} from '../sources/index.js'
import {buildProduct} from '../catalogue.js'

const ImportItem = mongoose.model('ImportItem')
const ImportRun = mongoose.model('ImportRun')

// Counters written every BATCH products, the run checked for a stop as often
const BATCH = 100

// "rebuild" job: the catalogue of a source built again from the raw answers
// kept by its ImportItems, without calling the source (a normalization
// changed). The products gone from their source stay hidden, an item never
// imported (no raw) is skipped. The run ends itself: nothing is marked as
// gone, its counters don't go through count()/finish().
export async function handle(job, source){
	const {_run} = job.data

	const adapter = await getAdapter(source)
	const filter = {source, raw: {$ne: null}, status: {$ne: 'gone'}}

	// From zero: a job taken back after a worker restart (stalled) starts over
	const total = await ImportItem.countDocuments(filter)
	await ImportRun.updateOne({_id: _run}, {$set: {total, created: 0, updated: 0, unchanged: 0, failed: 0}})

	let counts = {created: 0, updated: 0, unchanged: 0, failed: 0}
	let firstError = null
	let done = 0

	const flush = async () => {
		await ImportRun.updateOne({_id: _run}, {$inc: counts})
		counts = {created: 0, updated: 0, unchanged: 0, failed: 0}
	}

	for await (const item of ImportItem.find(filter).lean().cursor({batchSize: BATCH})){
		try {
			const {isNew, changed} = await buildProduct(source, item, adapter, item.raw)
			counts[isNew ? 'created' : changed ? 'updated' : 'unchanged']++
		} catch(err) {
			counts.failed++
			firstError ??= `${item.ref || item.externalId} → ${err.message}`
		}

		if(++done % BATCH) continue

		await flush()

		// Stopped or reset meanwhile
		if(!await ImportRun.exists({_id: _run, status: 'running'})) return {cancelled: true, done}
	}

	await flush()

	const run = await ImportRun.findOneAndUpdate({_id: _run, status: 'running'}, {
		$set: {status: 'done', finishedAt: new Date()}
	}, {new: true}).lean()

	if(run?.failed && firstError){
		await ImportRun.updateOne({_id: _run}, {$set: {error: `${run.failed} produit(s) en échec, dont ${firstError}`}})
	}

	return {done}
}

// The job itself failed (database…): the run ends with its error
export async function failed(job, source, err){
	await ImportRun.updateOne({_id: job.data._run, status: 'running'}, {
		$set: {status: 'failed', error: err.message, finishedAt: new Date()}
	})
}
