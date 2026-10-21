import {UnrecoverableError} from 'bullmq'

import * as list from './list.js'
import * as product from './product.js'
import * as picture from './picture.js'

// Job handlers by name: handle(job, source), and failed(job, source, err)
// once its last attempt failed
const handlers = {list, product, picture}

// A job of an unknown name fails, it shows with the errors of its queue
export async function processJob(source, job){
	const handler = handlers[job.name]
	if(!handler) throw new UnrecoverableError(`unknown job "${job.name}"`)

	return handler.handle(job, source)
}

// Every failure, the handler only hears of the last one (no attempt left, or
// an UnrecoverableError which skips them)
export async function failedJob(source, job, err){
	const last = job.attemptsMade >= (job.opts.attempts || 1) || err?.name === 'UnrecoverableError'
	if(last) await handlers[job.name]?.failed?.(job, source, err)
}
