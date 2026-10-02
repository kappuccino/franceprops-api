import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

const RETENTION = 30 * 24 * 60 * 60

const MailQueueEvent = new mongoose.Schema({
	date: Date,
	type: String,
	email: String,
	error: String,
	hardBounce: Boolean,
	raw: mongoose.Schema.Types.Mixed,
}, {_id: false})

const MailQueue = new mongoose.Schema({
	date: {type: Date, expires: RETENTION},
	id: {type: String, index: true}, // x-mj-eventpayload, matches the Mailjet webhook events
	tag: {type: String, index: true}, // where the mail comes from (template slug, sendMail tag)
	status: {type: String, index: true}, // sent | error (SMTP) | bounce | blocked | spam (Mailjet)
	error: String,
	raw: mongoose.Schema.Types.Mixed,
	events: [MailQueueEvent],
	resent: Date,
}, {
	collection: 'mail-queue',
	collation
})

MailQueue.pre('save', function(next){
	if(this.isNew && !this.date) this.date = new Date()
	next()
})

mongoose.model('MailQueue', MailQueue)
