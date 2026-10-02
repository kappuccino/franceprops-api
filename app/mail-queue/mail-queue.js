import mongoose from 'mongoose'
import {readFile} from 'fs/promises'

import {sendMail, sanitizeAggregate, diacriticRegex, escapeRegex} from '../tools.js'

const MailQueue = mongoose.model('MailQueue')

const ERROR_EVENTS = ['bounce', 'blocked', 'spam']


//——— Public

export async function getById(_id){
	if(!_id) throw new Error('no _id')
	return MailQueue.findOne({_id}).lean()
}

export async function aggregate(params={}){

	const $match = makeMatch(params)
	const agg = [
		{$match},
		{$project: {'raw.attachments.content': 0}}
	]

	const aggLimited = sanitizeAggregate(agg, params)
	const aggNoLimit = [{$match}, {$count: 'totalDocuments'}]

	const [data, total] = await Promise.all([
		MailQueue.aggregate(aggLimited),
		MailQueue.aggregate(aggNoLimit),
	])

	return {
		total: total.length ? total[0].totalDocuments : 0,
		skip: params.skip,
		limit: params.limit,
		data
	}
}

export async function getTags(){
	const tags = await MailQueue.distinct('tag')
	return tags.filter(Boolean).sort()
}

// Stored content first, then the path nodemailer would read (temp file or URL)
export async function getAttachment(_id, index){

	const mail = await MailQueue.findOne({_id}, {'raw.attachments': 1}).lean()
	const att = mail?.raw?.attachments?.[index]
	if(!att) throw new Error('attachment not found')

	let content = null
	if(att.content?.buffer) content = Buffer.from(att.content.buffer)
	else if(typeof att.content === 'string') content = Buffer.from(att.content, att.encoding || 'utf8')
	else if(/^https?:\/\//.test(att.path || '')) content = await fetch(att.path).then(res => res.arrayBuffer()).then(Buffer.from).catch(() => null)
	else if(att.path) content = await readFile(att.path).catch(() => null)

	if(!content) throw new Error('attachment file is gone')

	return {
		filename: att.filename || att.path?.split('/').pop() || `attachment-${index}`,
		contentType: att.contentType,
		content: content.toString('base64')
	}
}

export async function create(data){
	delete data._id

	const $mailQueue = new MailQueue(data)
	await $mailQueue.save()

	return getById($mailQueue.get('_id'))
}

export async function remove(_id){
	await MailQueue.deleteOne({_id})

	return true
}

// sendMail() keeps its own entry for the new attempt, the old one is only flagged
export async function resend(_id){

	const mail = await getById(_id)
	if(!mail?.raw) return false

	let success = false
	try {
		await sendMail({...restoreRaw(mail.raw), tag: mail.tag})
		success = true
	} catch(err){
		console.log('[mail-queue] resend failed', err.message)
	}

	await MailQueue.updateOne({_id}, {resent: new Date()})

	return success
}

// Mailjet webhook event, matched on the x-mj-eventpayload header sent by sendMail()
export async function appendEvent(event){
	if(!ERROR_EVENTS.includes(event?.event) || !event.Payload) return

	const date = event.time ? new Date(event.time * 1000) : new Date()

	// Mailjet retries the whole batch on a failure, an event already stored is skipped
	const exists = await MailQueue.exists({
		id: event.Payload,
		events: {$elemMatch: {type: event.event, email: event.email, date}}
	})
	if(exists) return

	const error = [event.error_related_to, event.error]
		.filter(Boolean)
		.join(': ')

	await MailQueue.updateOne(
		{id: event.Payload},
		{
			$set: {status: event.event},
			$setOnInsert: {date: new Date()},
			$push: {
				events: {
					date,
					type: event.event,
					email: event.email,
					error: error || event.source || null,
					hardBounce: event.hard_bounce,
					raw: event
				}
			}
		},
		{upsert: true}
	)
}


// —— Private

function makeMatch(params){

	const query = new mongoose.Query()

	if(params.status?.length){
		query.where('status', {$in: [params.status].flat()})
	}

	if(params.errors){
		query.where('status', {$ne: 'sent'})
	}

	if(params.tag?.length){
		query.where('tag', {$in: [params.tag].flat()})
	}

	if(params.search?.length){
		const reg = new RegExp(diacriticRegex(escapeRegex(params.search)), 'i')
		query.or([
			{'raw.from': reg},
			{'raw.to': reg},
			{'raw.cc': reg},
			{'raw.subject': reg},
			{'events.email': reg},
		])
	}

	return query._conditions
}

// Buffers come back from Mongo as BSON Binary, nodemailer needs real Buffers
function restoreRaw(raw){
	if(!raw?.attachments?.length) return raw

	return {
		...raw,
		attachments: raw.attachments.map(att => {
			if(att.content?.buffer) return {...att, content: Buffer.from(att.content.buffer)}
			return att
		})
	}
}
