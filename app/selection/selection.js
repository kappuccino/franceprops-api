import mongoose from 'mongoose'
import {nanoid} from 'nanoid'

import * as customerApi from '../customer/customer.js'

const Selection = mongoose.model('Selection')
const Product = mongoose.model('Product')

// Anonymous selections are removed after 30 days without change
const ANONYMOUS_TTL = 30 * 24 * 60 * 60 * 1000


//——— Public (the site identifies the visitor by his session token or his
//    anonymous key, never by the _id of the selection)

// Selection of the visitor, null when he has none yet
export async function find({token, key}){
	const customer = token ? await customerApi.fromToken(token) : null
	if(customer) return Selection.findOne({_customer: customer._id}).lean()

	if(key) return Selection.findOne({key, _customer: {$exists: false}}).lean()
	return null
}

export async function add({token, key}, _product){
	if(!await Product.exists({_id: _product})) throw new Error('product not found')

	const $selection = await findOrCreate({token, key})

	if(!$selection.items.some(i => i._product.toString() === _product)){
		$selection.items.push({_product, added: new Date()})
	}

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

// Login or signup: the anonymous selection joins the customer's one (merged
// when he already has one), it is no longer reachable by its key
export async function attach(token, key){
	const customer = await customerApi.fromToken(token)
	if(!customer) throw new Error('invalid session')

	const anonymous = key ? await Selection.findOne({key, _customer: {$exists: false}}) : null
	const $own = await Selection.findOne({_customer: customer._id})

	if(!anonymous) return $own ? $own.toObject() : null

	if(!$own){
		anonymous.set('_customer', customer._id)
		anonymous.set('key', undefined)
		anonymous.set('expireAt', undefined)
		await anonymous.save()
		return anonymous.toObject()
	}

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

async function findOrCreate({token, key}){
	const found = await find({token, key})
	if(found) return Selection.findOne({_id: found._id})

	const customer = token ? await customerApi.fromToken(token) : null
	if(customer) return new Selection({_customer: customer._id, items: []})

	return new Selection({key: nanoid(32), items: []})
}

// Anonymous selections live 30 days after their last change
function touch($selection){
	if(!$selection._customer) $selection.set('expireAt', new Date(Date.now() + ANONYMOUS_TTL))
}
