import {Queue} from 'bullmq'

import redis from '../redis.js'
import {isSource} from './sources/index.js'

// Same Redis as the rest of the api (maxRetriesPerRequest: null, which the
// workers require). BullMQ duplicates it for its blocking connections.
export const connection = redis

export const defaultJobOptions = {
	attempts: 3,
	backoff: {type: 'exponential', delay: 5000},
	removeOnComplete: {age: 24 * 3600, count: 1000},
	removeOnFail: {age: 7 * 24 * 3600} // errors stay visible in the dashboard
}

export function queueName(source){
	return `import-${source}`
}

const queues = new Map()

// Queue of a source, created once: the api adds the jobs and drives it (pause,
// reset, counts), the worker processes it
export function getQueue(source){
	if(!isSource(source)) throw new Error('unknown source')

	if(!queues.has(source)){
		queues.set(source, new Queue(queueName(source), {connection, defaultJobOptions}))
	}

	return queues.get(source)
}

export async function closeQueues(){
	await Promise.all([...queues.values()].map(queue => queue.close()))
	queues.clear()
}
