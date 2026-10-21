import {Queue} from 'bullmq'

import redis from '../redis.js'
import {isSource} from './sources/index.js'

// Same Redis as the rest of the api (maxRetriesPerRequest: null, which the
// workers require). BullMQ duplicates it for its blocking connections.
export const connection = redis

export const defaultJobOptions = {
	attempts: 3,
	backoff: {type: 'exponential', delay: 5000},
	removeOnComplete: true, // ImportRun and ImportItem keep what matters
	removeOnFail: {age: 7 * 24 * 3600} // errors stay visible in the dashboard
}

// Two queues per source: the catalogue (list and product jobs), and its
// pictures, downloaded apart (a slow picture server never holds a run back)
export const KINDS = ['catalogue', 'pictures']

export function queueName(source, kind='catalogue'){
	return kind === 'pictures' ? `import-${source}-pictures` : `import-${source}`
}

const queues = new Map()

// Queue of a source, created once: the api adds the jobs and drives it (pause,
// reset, counts), the worker processes it
export function getQueue(source, kind='catalogue'){
	if(!isSource(source)) throw new Error('unknown source')
	if(!KINDS.includes(kind)) throw new Error('unknown queue')

	const name = queueName(source, kind)
	if(!queues.has(name)){
		queues.set(name, new Queue(name, {connection, defaultJobOptions}))
	}

	return queues.get(name)
}

export async function closeQueues(){
	await Promise.all([...queues.values()].map(queue => queue.close()))
	queues.clear()
}
