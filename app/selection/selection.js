import mongoose from 'mongoose'
import {nanoid} from 'nanoid'

import * as customerApi from '../customer/customer.js'
import {requestNumber} from '../request/number.js'

const Selection = mongoose.model('Selection')
const Product = mongoose.model('Product')
const Customer = mongoose.model('Customer')

export const DEFAULT_NAME = 'Ma sélection'

// Anonymous selections are removed after 30 days without change
const ANONYMOUS_TTL = 30 * 24 * 60 * 60 * 1000


//——— Public (the site identifies the visitor by his session token or his
//    anonymous key, never trusts a selection _id without its owner)

// Active selection of the visitor, null when he has none yet
export async function find({token, key}){
	const customer = token ? await customerApi.fromToken(token) : null
	if(customer) return active(customer)

	if(key) return Selection.findOne({key, _customer: {$exists: false}}).lean()
	return null
}

// Every selection of the customer, oldest first
export async function list(token){
	const customer = await requireCustomer(token)
	return Selection.find({_customer: customer._id}).sort({createdAt: 1}).lean()
}

// New empty selection, which becomes the active one
export async function create(token, name){
	const customer = await requireCustomer(token)

	const $selection = new Selection({_customer: customer._id, name: cleanName(name), items: []})
	await $selection.save()
	await setActive(customer, $selection._id)

	return $selection.toObject()
}

export async function rename(token, _id, name){
	const customer = await requireCustomer(token)
	const $selection = await owned(customer, _id)

	$selection.name = cleanName(name)
	await $selection.save()

	return $selection.toObject()
}

export async function activate(token, _id){
	const customer = await requireCustomer(token)
	const $selection = await owned(customer, _id)

	await setActive(customer, $selection._id)
	return $selection.toObject()
}

// The customer keeps at least one selection; returns the active one afterwards
export async function removeSelection(token, _id){
	const customer = await requireCustomer(token)
	const $selection = await owned(customer, _id)

	if(await Selection.countDocuments({_customer: customer._id}) <= 1) throw new Error('last selection')

	await Selection.deleteOne({_id: $selection._id})
	if(customer._selection?.toString() === $selection._id.toString()) await setActive(customer, undefined)

	return active({...customer, _selection: undefined})
}

// _selection: basket chosen by the customer, which becomes the active one;
// the active selection otherwise
export async function add({token, key}, _product, quantity=1, _selection){
	if(!await Product.exists({_id: _product})) throw new Error('product not found')
	quantity = checkQuantity(quantity)

	let $selection
	if(_selection){
		const customer = await requireCustomer(token)
		$selection = await owned(customer, _selection)
		await setActive(customer, $selection._id)
	} else {
		$selection = await findOrCreate({token, key})
	}

	const item = $selection.items.find(i => i._product.toString() === _product)
	if(item) item.quantity = quantity
	else $selection.items.push({_product, quantity, addedAt: new Date()})

	touch($selection)
	await $selection.save()

	return $selection.toObject()
}

// Quantity of a product already in the selection
export async function setQuantity({token, key}, _product, quantity){
	quantity = checkQuantity(quantity)

	const found = await find({token, key})
	const $selection = found && await Selection.findOne({_id: found._id})
	const item = $selection?.items.find(i => i._product.toString() === _product)
	if(!item) throw new Error('product not found')

	item.quantity = quantity

	touch($selection)
	await $selection.save()

	return $selection.toObject()
}

export async function remove({token, key}, _product){
	const found = await find({token, key})
	if(!found) return null

	const $selection = await Selection.findOne({_id: found._id})
	$selection.items = $selection.items.filter(i => i._product.toString() !== _product)

	touch($selection)
	await $selection.save()

	return $selection.toObject()
}

// The selection became a quote request: it is removed, the next add creates a
// new one when the customer has none left
export async function consume(token, _id){
	const customer = await requireCustomer(token)

	await Selection.deleteOne({_id, _customer: customer._id})
	if(customer._selection?.toString() === _id.toString()) await setActive(customer, undefined)
}

// The products of a request go to a new selection, which becomes the active
// one. mode revise: the next request revises it (an existing revision of the
// same request is reopened instead); copy: the next request is a new one
export async function fromRequest(token, request, mode='revise'){
	const customer = await requireCustomer(token)

	if(mode === 'revise'){
		const pending = await Selection.findOne({_customer: customer._id, _request: request._id}).lean()
		if(pending){
			await setActive(customer, pending._id)
			return pending
		}
	}

	const number = requestNumber(request)
	const $selection = new Selection({
		_customer: customer._id,
		name: mode === 'revise' ? `Modification n° ${number}` : `Copie de n° ${number}`,
		items: request.parts
			.flatMap(part => part.products)
			.map(p => ({_product: p._product, quantity: p.quantity || 1, addedAt: new Date()})),
		_request: mode === 'revise' ? request._id : undefined,
		_source: mode === 'copy' ? request._id : undefined
	})

	await $selection.save()
	await setActive(customer, $selection._id)

	return $selection.toObject()
}

// A revision in progress becomes a new request (made from the same request)
export async function detach({token}){
	const found = await find({token})
	if(!found?._request) return found

	const $selection = await Selection.findOne({_id: found._id})
	$selection.set('_source', $selection._request)
	$selection.set('_request', undefined)
	await $selection.save()

	return $selection.toObject()
}

// Login or signup: the anonymous selection joins the customer's active one
// (merged when he already has one), it is no longer reachable by its key
export async function attach(token, key){
	const customer = await requireCustomer(token)

	const anonymous = key ? await Selection.findOne({key, _customer: {$exists: false}}) : null
	const own = await active(customer)

	if(!anonymous) return own

	if(!own){
		anonymous.set('_customer', customer._id)
		anonymous.set('key', undefined)
		anonymous.set('expireAt', undefined)
		await anonymous.save()
		await setActive(customer, anonymous._id)
		return anonymous.toObject()
	}

	const $own = await Selection.findOne({_id: own._id})
	const known = new Set($own.items.map(i => i._product.toString()))
	for(const item of anonymous.items){
		if(!known.has(item._product.toString())) $own.items.push(item)
	}

	await $own.save()
	await Selection.deleteOne({_id: anonymous._id})

	return $own.toObject()
}


// Items whose product still exists (a product removed from the catalogue
// disappears from the selections)
export async function existingItems(items=[]){
	if(!items.length) return []

	const ids = await Product.distinct('_id', {_id: {$in: items.map(i => i._product)}})
	const existing = new Set(ids.map(id => id.toString()))

	return items.filter(i => existing.has(i._product.toString()))
}


// —— Private

async function requireCustomer(token){
	const customer = token ? await customerApi.fromToken(token) : null
	if(!customer) throw new Error('invalid session')

	return customer
}

// Selection of the customer, refused when it belongs to someone else
async function owned(customer, _id){
	const $selection = mongoose.isValidObjectId(_id) && await Selection.findOne({_id, _customer: customer._id})
	if(!$selection) throw new Error('selection not found')

	return $selection
}

// The chosen one, or the last changed when it is gone (or never chosen)
async function active(customer){
	if(customer._selection){
		const selection = await Selection.findOne({_id: customer._selection, _customer: customer._id}).lean()
		if(selection) return selection
	}

	return Selection.findOne({_customer: customer._id}).sort({updatedAt: -1}).lean()
}

function setActive(customer, _id){
	return Customer.updateOne({_id: customer._id}, _id ? {$set: {_selection: _id}} : {$unset: {_selection: 1}})
}

async function findOrCreate({token, key}){
	const found = await find({token, key})
	if(found) return Selection.findOne({_id: found._id})

	const customer = token ? await customerApi.fromToken(token) : null
	if(customer){
		const $selection = new Selection({_customer: customer._id, name: DEFAULT_NAME, items: []})
		await setActive(customer, $selection._id)
		return $selection
	}

	return new Selection({key: nanoid(32), name: DEFAULT_NAME, items: []})
}

function cleanName(name){
	const clean = (name || '').trim().slice(0, 80)
	if(!clean) throw new Error('invalid name')

	return clean
}

function checkQuantity(quantity){
	const n = Number(quantity)
	if(!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('invalid quantity')

	return n
}

// Anonymous selections live 30 days after their last change
function touch($selection){
	if(!$selection._customer) $selection.set('expireAt', new Date(Date.now() + ANONYMOUS_TTL))
}
