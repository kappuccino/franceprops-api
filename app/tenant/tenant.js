import mongoose from 'mongoose'

import {escapeRegex, sanitizeAggregate} from '../tools.js'
import {makeVersion} from '../version/version.js'

const Tenant = mongoose.model('Tenant')
const User = mongoose.model('User')


//——— Public

export async function aggregate(params={}){

	const $match = makeMatch(params)

	if(!params.sort) params.sort = {name: 1}

	const aggLimited = sanitizeAggregate([{$match}], params)
	const aggNoLimit = [{$match}, {$count: 'totalDocuments'}]

	const [data, total] = await Promise.all([
		Tenant.aggregate(aggLimited),
		Tenant.aggregate(aggNoLimit)
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
	return Tenant.findOne({_id}).lean()
}

export async function getByIds(_ids){
	if(!_ids?.length) return []
	return Tenant.find({_id: {$in: _ids}}).sort({name: 1}).lean()
}

export async function create(data){
	delete data._id

	if(!data.name?.trim()) throw new Error('no name')

	const $tenant = new Tenant(data)
	await $tenant.save()

	return getById($tenant.get('_id'))
}

// ✓ version
export async function update(_id, data){

	const $tenant = await Tenant.findOne({_id})
	if(!$tenant) throw new Error('tenant not exists')

	await makeVersion('tenant', _id, $tenant)

	Object
		.entries(data)
		.forEach(([key, value]) => $tenant.set(key, value))

	await $tenant.save()

	return getById(_id)
}

// ✓ version
export async function remove(_id){

	const $tenant = await Tenant.findOne({_id})
	if(!$tenant) throw new Error('tenant not exists')

	await makeVersion('tenant', _id, $tenant)

	await Tenant.deleteOne({_id})

	// Managers lose the access to the removed tenant
	await User.updateMany({_tenants: _id}, {$pull: {_tenants: _id}})

	return true
}


// —— Private

function makeMatch(params){

	const query = new mongoose.Query()

	if(params.search?.length){
		query.where('name', new RegExp(escapeRegex(params.search), 'i'))
	}

	return query._conditions
}
