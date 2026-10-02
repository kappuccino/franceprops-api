import mongoose from 'mongoose'

import {escapeRegex, sanitizeAggregate} from '../tools.js'
import {makeVersion} from '../version/version.js'

const Customer = mongoose.model('Customer')

// Never leaves the api
const PRIVATE = {password: 0, auth: 0}


//——— Public

export async function aggregate(params={}){

	const $match = makeMatch(params)

	if(!params.sort) params.sort = {created: -1}

	const aggLimited = sanitizeAggregate([{$match}, {$project: PRIVATE}], params)
	const aggNoLimit = [{$match}, {$count: 'totalDocuments'}]

	const [data, total] = await Promise.all([
		Customer.aggregate(aggLimited),
		Customer.aggregate(aggNoLimit)
	])

	return {
		skip: params.skip,
		limit: params.limit,
		total: total.length ? total[0].totalDocuments : 0,
		data
	}
}

export async function getById(_id){
	if(!_id) throw new Error('no _id')
	return Customer.findOne({_id}, PRIVATE).lean()
}

export async function create(data){
	delete data._id

	if(!data.email?.trim()) throw new Error('no email')

	const exists = await Customer.exists({email: data.email.trim().toLowerCase()})
	if(exists) throw new Error('customer exists')

	const $customer = new Customer(data)
	await $customer.save()

	return getById($customer.get('_id'))
}

// ✓ version
export async function update(_id, data){

	const $customer = await Customer.findOne({_id})
	if(!$customer) throw new Error('customer not exists')

	if(data.email){
		const exists = await Customer.exists({_id: {$ne: _id}, email: data.email.trim().toLowerCase()})
		if(exists) throw new Error('customer exists')
	}

	// An empty password field means "keep the current one"
	if(!data.password) delete data.password

	await makeVersion('customer', _id, $customer)

	Object
		.entries(data)
		.forEach(([key, value]) => $customer.set(key, value))

	await $customer.save()

	return getById(_id)
}

// ✓ version
export async function remove(_id){

	const $customer = await Customer.findOne({_id})
	if(!$customer) throw new Error('customer not exists')

	await makeVersion('customer', _id, $customer)

	await Customer.deleteOne({_id})

	return true
}


// —— Private

function makeMatch(params){

	const query = new mongoose.Query()

	if(params.search?.length){
		const reg = new RegExp(escapeRegex(params.search), 'i')
		query.or([
			{email: reg},
			{firstName: reg},
			{lastName: reg},
			{company: reg},
			{city: reg},
		])
	}

	return query._conditions
}
