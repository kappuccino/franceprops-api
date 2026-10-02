import express from 'express'

import {success, catchErrors} from '../request.js'
import {appendEvent} from '../mail-queue/mail-queue.js'

const router = express.Router()
export default router

// Mailjet bounce, blocked and spam events, set on this URL in the Mailjet dashboard
router.post('/mailjet/error',
	express.json({limit: '512kb'}),
	catchErrors(async function error(req, res, next){

		const events = Array.isArray(req.body) ? req.body : [req.body]

		for await (const event of events){
			console.log('MAIL [ERROR]', event.Payload, event.event, event.email)
			await appendEvent(event)
		}

		try {
			success(req.body, req, res)
		} catch(err) {
			next(err)
		}

	}))
