import mongoose from 'mongoose'

import {sanitizeAggregate, sendMail} from '../tools.js'
import * as customerApi from '../customer/customer.js'
import * as selectionApi from '../selection/selection.js'
import {requestNumber} from './number.js'

const Request = mongoose.model('Request')
const Product = mongoose.model('Product')
const Tenant = mongoose.model('Tenant')
const Media = mongoose.model('Media')

const ANSWERS = ['quoted', 'declined']
const DECISIONS = ['accepted', 'refused']

export const VAT_RATE = 0.2

// Totals of the quoted parts: {totalHT, vat, totalTTC}, null when none is quoted
export function totals(parts=[]){
	const quoted = parts.filter(p => p.status === 'quoted' && typeof p.amount === 'number')
	if(!quoted.length) return null

	const round = n => Math.round(n * 100) / 100
	const totalHT = round(quoted.reduce((acc, p) => acc + p.amount, 0))
	const vat = round(totalHT * VAT_RATE)

	return {totalHT, vat, totalTTC: round(totalHT + vat)}
}


//——— Website (the customer is identified by his session token)

// The active selection becomes a request, one part per tenant; the selection is
// removed. When the selection revises an answered request, each tenant is compared
// with it: same products and quantities → its answer is carried over (no mail), changed → asked
// again with the changes, no product left → told its quote is no longer needed.
export async function createFromSelection(token, info={}){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')

	const selection = await selectionApi.find({token})
	const items = await selectionApi.existingItems(selection?.items)
	if(!items.length) throw new Error('empty selection')

	// The rental period is the one of the selection
	const details = checkInfo({...info, startAt: selection.startAt, endAt: selection.endAt})

	const quantities = new Map(items.map(i => [i._product.toString(), i.quantity || 1]))
	const products = await Product.find({_id: {$in: items.map(i => i._product)}}).lean()

	const parts = new Map()
	for(const product of products){
		const _tenant = product._tenant.toString()
		if(!parts.has(_tenant)) parts.set(_tenant, {_tenant, products: []})
		parts.get(_tenant).products.push({
			_product: product._id,
			ref: product.ref,
			title: product.title,
			quantity: quantities.get(product._id.toString())
		})
	}

	const previous = selection._request ? await revisable(selection._request, customer) : null
	if(previous) compare([...parts.values()], previous)

	const $request = new Request({
		_customer: customer._id,
		name: selection.name || selectionApi.DEFAULT_NAME,
		...details,
		_previous: previous?._id,
		_source: previous ? undefined : selection._source,
		parts: [...parts.values()]
	})
	if(previous && $request.parts.every(p => ANSWERS.includes(p.status))){
		const removed = previous.parts.some(p => !parts.has(p._tenant.toString()))
		if(!removed) throw new Error('no changes')

		// Only removals: every remaining answer is carried over
		$request.status = 'answered'
		$request.answeredAt = new Date()
	}

	await $request.save()

	if(previous) await Request.updateOne({_id: previous._id}, {status: 'revised', updatedAt: new Date()})

	await selectionApi.consume(token, selection._id)

	const request = $request.toObject()
	await notifyTenants(request, customer)
	if(previous) await notifyRemovedTenants(previous, request, customer)

	return request
}

// Revision of an answered request: its products go back to the selection
export async function revise(token, _id){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')

	const request = await revisable(_id, customer)
	return selectionApi.fromRequest(token, request, 'revise')
}

// New request made from any request of the customer: its products go back to
// the selection, nothing is carried over
export async function copy(token, _id){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')

	const request = await Request.findOne({_id, _customer: customer._id}).lean()
	if(!request) throw new Error('request not found')

	return selectionApi.fromRequest(token, request, 'copy')
}

// The customer accepts or refuses the quotes of an answered request; the
// tenants that quoted are told
export async function decide(token, _id, decision){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')
	if(!DECISIONS.includes(decision)) throw new Error('invalid decision')

	const $request = await Request.findOne({_id, _customer: customer._id})
	if(!$request) throw new Error('request not found')
	if(DECISIONS.includes($request.status)) throw new Error('request decided')
	if($request.status === 'revised') throw new Error('request revised')
	if($request.status !== 'answered') throw new Error('request not answered')
	if(!$request.parts.some(p => p.status === 'quoted')) throw new Error('nothing quoted')

	$request.status = decision
	$request.decidedAt = new Date()
	await $request.save()

	const request = $request.toObject()
	await notifyDecision(request, customer)

	return request
}

export async function listForCustomer(token){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')

	return Request.find({_customer: customer._id}).sort({createdAt: -1}).lean()
}

export async function getForCustomer(token, _id){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')

	return Request.findOne({_id, _customer: customer._id}).lean()
}


//——— Dashboard

// _tenant: requests holding a part of this tenant, every request otherwise
// partStatus: status of that tenant's part (of any part without _tenant)
export async function aggregate(params={}){
	const $match = {}
	const _tenant = params._tenant ? new mongoose.Types.ObjectId(params._tenant) : null

	if(_tenant && params.partStatus) $match.parts = {$elemMatch: {_tenant, status: params.partStatus}}
	else if(_tenant) $match['parts._tenant'] = _tenant
	else if(params.partStatus) $match['parts.status'] = params.partStatus

	if(params.status) $match.status = params.status

	if(!params.sort) params.sort = {createdAt: -1}

	const [data, total] = await Promise.all([
		Request.aggregate(sanitizeAggregate([{$match}], params)),
		Request.countDocuments($match)
	])

	return {skip: params.skip, limit: params.limit, total, data}
}

export async function getById(_id){
	if(!_id) throw new Error('no _id')
	return Request.findOne({_id}).lean()
}

// A tenant quotes (private PDF and its amount HT) or declines its part; when
// every part is answered, the customer is told his quote is ready
export async function answer(_id, _tenant, status, _media, user, amount){
	if(!ANSWERS.includes(status)) throw new Error('invalid answer')
	if(status === 'quoted' && !_media) throw new Error('missing pdf')
	if(status === 'quoted' && !(Number.isFinite(amount) && amount > 0)) throw new Error('missing amount')
	if(_media && !await Media.exists({_id: _media})) throw new Error('missing pdf')

	const $request = await Request.findOne({_id})
	if(!$request) throw new Error('request not found')
	if($request.status === 'answered') throw new Error('request answered')
	if($request.status === 'revised') throw new Error('request revised')
	if(DECISIONS.includes($request.status)) throw new Error('request decided')

	const part = $request.parts.find(p => p._tenant.toString() === _tenant)
	if(!part) throw new Error('part not found')

	part.status = status
	part._media = status === 'quoted' ? _media : undefined
	part.amount = status === 'quoted' ? Math.round(amount * 100) / 100 : undefined
	part._answeredBy = user?._id
	part.answeredAt = new Date()

	const complete = $request.parts.every(p => ANSWERS.includes(p.status))
	if(complete){
		$request.status = 'answered'
		$request.answeredAt = new Date()
	}

	await $request.save()

	if(complete) await notifyCustomer($request.toObject())

	return $request.toObject()
}


// —— Private

// What the customer fills when sending a request (project, billing, delivery,
// rental dates, comment, terms)
function checkInfo(info){
	const text = (value, max=2000) => (value || '').toString().trim().slice(0, max)
	const date = value => {
		const parsed = value ? new Date(value) : null
		return parsed && !isNaN(parsed) ? parsed : null
	}

	const details = {
		project: text(info.project, 200),
		company: text(info.company, 200),
		billingAddress: text(info.billingAddress),
		delivery: Boolean(info.delivery),
		deliveryAddress: info.delivery ? text(info.deliveryAddress) : '',
		startAt: date(info.startAt),
		endAt: date(info.endAt),
		comment: text(info.comment, 5000),
		termsAcceptedAt: info.terms ? new Date() : null
	}

	if(!details.project) throw new Error('missing project')
	if(!details.billingAddress) throw new Error('missing billing address')
	if(details.delivery && !details.deliveryAddress) throw new Error('missing delivery address')
	if(!details.startAt || !details.endAt || details.endAt < details.startAt) throw new Error('invalid dates')
	if(!details.termsAcceptedAt) throw new Error('terms not accepted')

	return details
}

// Rental period of a request, for the mails: "du 26/06/2026 au 07/07/2026"
function rentalDates(request){
	const day = date => new Date(date).toLocaleDateString('fr-FR', {timeZone: 'Europe/Paris'})
	return request.startAt ? `du ${day(request.startAt)} au ${day(request.endAt)}` : ''
}

// The customer's answered request that a revision is made from
async function revisable(_id, customer){
	const request = await Request.findOne({_id, _customer: customer._id}).lean()
	if(!request) throw new Error('request not found')
	if(request.status === 'revised') throw new Error('request revised')
	if(DECISIONS.includes(request.status)) throw new Error('request decided')
	if(request.status !== 'answered') throw new Error('request not answered')

	return request
}

// Each part against the same tenant in the previous request: carried over
// when its products and quantities did not change, otherwise asked again with
// the changes
function compare(parts, previous){
	const quantities = list => new Map(list.map(p => [p._product.toString(), p.quantity || 1]))

	for(const part of parts){
		const before = previous.parts.find(p => p._tenant.toString() === part._tenant)
		if(!before) continue

		const now = quantities(part.products), then = quantities(before.products)
		const changed = part.products
			.filter(p => then.has(p._product.toString()) && then.get(p._product.toString()) !== (p.quantity || 1))
			.map(p => ({_product: p._product, ref: p.ref, title: p.title, from: then.get(p._product.toString()), to: p.quantity || 1}))

		const same = now.size === then.size && [...now.keys()].every(id => then.has(id)) && !changed.length

		if(same){
			Object.assign(part, {
				status: before.status,
				_media: before._media,
				amount: before.amount,
				_answeredBy: before._answeredBy,
				answeredAt: before.answeredAt,
				_carriedFrom: before._carriedFrom || previous._id
			})
		} else {
			part.added = part.products.filter(p => !then.has(p._product.toString()))
			part.removed = before.products.filter(p => !now.has(p._product.toString()))
			part.changed = changed
		}
	}
}

async function tenantEmail(_tenant, request){
	const tenant = await Tenant.findOne({_id: _tenant}, {name: 1, requestEmail: 1}).lean()
	if(!tenant?.requestEmail) console.log(`[request] ${request._id}: no request email for tenant ${tenant?.name || _tenant}`)

	return tenant?.requestEmail
}

const productLines = products => products.map(p => `- ${p.ref} — ${p.title || ''} × ${p.quantity || 1}`).join('\n')
const changeLines = changes => changes.map(c => `- ${c.ref} — ${c.title || ''} : ${c.from} → ${c.to}`).join('\n')

// Each tenant asked for a quote gets a mail at the address of its record
// (requestEmail) with its products, and what changed when the request revises
// another one; kept in the mail-queue while MAIL_FAKE
async function notifyTenants(request, customer){
	for(const part of request.parts){
		if(part.status !== 'pending') continue

		const to = await tenantEmail(part._tenant, request)
		if(!to) continue

		const revised = Boolean(request._previous)
		const changes = [
			part.added?.length ? `Ajouté(s) :\n${productLines(part.added)}` : '',
			part.removed?.length ? `Retiré(s) :\n${productLines(part.removed)}` : '',
			part.changed?.length ? `Quantité(s) modifiée(s) :\n${changeLines(part.changed)}` : '',
		].filter(Boolean).join('\n\n')

		await sendMail({
			tag: 'request-tenant',
			_tenants: [part._tenant],
			to: [to],
			useTemplate: revised ? 'request-tenant-revised' : 'request-tenant-new',
			variables: {
				customer: request.company || customer.company || customer.fullName || customer.email,
				project: request.project || '',
				dates: rentalDates(request),
				delivery: request.delivery ? `Livraison : ${request.deliveryAddress}` : 'Enlèvement par le client',
				count: part.products.length,
				products: productLines(part.products),
				changes: changes || 'Nouveau loueur sur cette demande.',
				link: `${process.env.DASH_URL}/request/${request._id}`
			}
		}).catch(err => console.log('[request] tenant mail failed', err.message))
	}
}

// Tenants left out of a revision: their quote is no longer needed
async function notifyRemovedTenants(previous, request, customer){
	const kept = new Set(request.parts.map(p => p._tenant.toString()))

	for(const part of previous.parts){
		if(kept.has(part._tenant.toString())) continue

		const to = await tenantEmail(part._tenant, previous)
		if(!to) continue

		await sendMail({
			tag: 'request-tenant',
			_tenants: [part._tenant],
			to: [to],
			useTemplate: 'request-tenant-cancelled',
			variables: {
				customer: customer.company || customer.fullName || customer.email,
				products: productLines(part.products),
				link: `${process.env.DASH_URL}/request/${previous._id}`
			}
		}).catch(err => console.log('[request] tenant mail failed', err.message))
	}
}

// The tenants that quoted learn the decision of the customer
async function notifyDecision(request, customer){
	const euros = amount => amount.toLocaleString('fr-FR', {style: 'currency', currency: 'EUR'})

	for(const part of request.parts){
		if(part.status !== 'quoted') continue

		const to = await tenantEmail(part._tenant, request)
		if(!to) continue

		await sendMail({
			tag: 'request-tenant',
			_tenants: [part._tenant],
			to: [to],
			useTemplate: request.status === 'accepted' ? 'request-tenant-accepted' : 'request-tenant-refused',
			variables: {
				customer: request.company || customer.company || customer.fullName || customer.email,
				project: request.project || '',
				number: requestNumber(request),
				amount: euros(part.amount || 0),
				link: `${process.env.DASH_URL}/request/${request._id}`
			}
		}).catch(err => console.log('[request] tenant mail failed', err.message))
	}
}

async function notifyCustomer(request){
	const customer = await customerApi.getById(request._customer)
	if(!customer?.email) return

	await sendMail({
		tag: 'request-customer',
		_tenants: request.parts.map(p => p._tenant),
		to: [customer.email],
		useTemplate: 'request-customer-answered',
		variables: {
			link: `${process.env.WEB_URL}/account/requests/${request._id}`
		}
	}).catch(err => console.log('[request] customer mail failed', err.message))
}
