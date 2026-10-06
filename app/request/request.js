import mongoose from 'mongoose'

import {sanitizeAggregate, sendMail} from '../tools.js'
import * as customerApi from '../customer/customer.js'
import * as selectionApi from '../selection/selection.js'

const Request = mongoose.model('Request')
const Product = mongoose.model('Product')
const Tenant = mongoose.model('Tenant')
const Media = mongoose.model('Media')

const ANSWERS = ['quoted', 'declined']


//——— Website (the customer is identified by his session token)

// The selection becomes a request, one part per tenant; the selection is emptied
export async function createFromSelection(token){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')

	const selection = await selectionApi.find({token})
	const items = await selectionApi.existingItems(selection?.items)
	if(!items.length) throw new Error('empty selection')

	const products = await Product.find({_id: {$in: items.map(i => i._product)}}).lean()

	const parts = new Map()
	for(const product of products){
		const _tenant = product._tenant.toString()
		if(!parts.has(_tenant)) parts.set(_tenant, {_tenant, products: []})
		parts.get(_tenant).products.push({_product: product._id, ref: product.ref, title: product.title})
	}

	const $request = new Request({_customer: customer._id, parts: [...parts.values()]})
	await $request.save()

	await selectionApi.clear({token})
	await notifyTenants($request.toObject(), customer)

	return $request.toObject()
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
export async function aggregate(params={}){
	const $match = {}
	if(params._tenant) $match['parts._tenant'] = new mongoose.Types.ObjectId(params._tenant)
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

// A tenant quotes (private PDF) or declines its part; when every part is
// answered, the customer is told his quote is ready
export async function answer(_id, _tenant, status, _media, user){
	if(!ANSWERS.includes(status)) throw new Error('invalid answer')
	if(status === 'quoted' && !_media) throw new Error('missing pdf')
	if(_media && !await Media.exists({_id: _media})) throw new Error('missing pdf')

	const $request = await Request.findOne({_id})
	if(!$request) throw new Error('request not found')
	if($request.status === 'answered') throw new Error('request answered')

	const part = $request.parts.find(p => p._tenant.toString() === _tenant)
	if(!part) throw new Error('part not found')

	part.status = status
	part._media = status === 'quoted' ? _media : undefined
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

// Each tenant gets a mail at the address of its record (requestEmail) with
// its products; kept in the mail-queue while MAIL_FAKE
async function notifyTenants(request, customer){
	for(const part of request.parts){
		const tenant = await Tenant.findOne({_id: part._tenant}, {name: 1, requestEmail: 1}).lean()

		if(!tenant?.requestEmail){
			console.log(`[request] ${request._id}: no request email for tenant ${tenant?.name || part._tenant}`)
			continue
		}

		await sendMail({
			tag: 'request-tenant',
			to: [tenant.requestEmail],
			useTemplate: 'request-tenant-new',
			variables: {
				customer: customer.company || customer.fullName || customer.email,
				count: part.products.length,
				products: part.products.map(p => `- ${p.ref} — ${p.title || ''}`).join('\n'),
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
		to: [customer.email],
		useTemplate: 'request-customer-answered',
		variables: {
			link: `${process.env.WEB_URL}/account/requests/${request._id}`
		}
	}).catch(err => console.log('[request] customer mail failed', err.message))
}
