import {Worker} from 'bullmq'

import {disconnect} from './db.js'
import redis from './redis.js'
import {connection, queueName} from './import/queues.js'
import {sourceKeys, isConfigured, concurrency} from './import/sources/index.js'
import {processJob, failedJob} from './import/jobs/index.js'

// MODE=worker: processes the import queues, no http server. The api adds the
// jobs and drives the queues (start, pause, reset…).

const configured = sourceKeys.filter(isConfigured)

const workers = configured.map(source => {
	const worker = new Worker(queueName(source), job => processJob(source, job), {
		connection,
		concurrency: concurrency(source)
	})

	worker.on('failed', (job, err) => {
		console.error(`🔥 ${queueName(source)} → ${job?.name} ${job?.id} (${job?.attemptsMade}) ${err.message}`)
		if(!job) return

		failedJob(source, job, err)
			.catch(err => console.error(`🔥 ${queueName(source)} → failedJob()`, err))
	})

	worker.on('error', err => {
		console.error(`🔥 ${queueName(source)} → ${err.message}`)
	})

	return worker
})

// Stays alive without any configured source (Coolify would restart it in a loop)
console.log(configured.length
	? `[λ] Worker running → ${configured.map(queueName).join(', ')}`
	: '[λ] Worker running → no configured source')

// Redeploy (SIGTERM): the jobs in progress end before leaving. A job cut short
// anyway is taken back by BullMQ as "stalled".
async function shutdown(signal){
	console.log(`[•] ${signal} → closing the workers`)

	await Promise.all(workers.map(worker => worker.close()))
	await disconnect()
	await redis.quit()

	process.exit(0)
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
