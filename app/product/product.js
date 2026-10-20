import mongoose from 'mongoose'

import {escapeRegex, sanitizeAggregate} from '../tools.js'

const Product = mongoose.model('Product')


//——— Public

// One tenant, or every tenant when _tenant is empty (rights checked by the resolver)
export async function aggregate(params={}){

	const $match = makeMatch(params)

	if(!params.sort) params.sort = {ref: 1}

	const aggLimited = sanitizeAggregate([{$match}], params)
	const aggNoLimit = [{$match}, {$count: 'totalDocuments'}]

	const [data, total] = await Promise.all([
		Product.aggregate(aggLimited),
		Product.aggregate(aggNoLimit)
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
	return Product.findOne({_id}).lean()
}


// —— Private

function makeMatch(params){

	const query = new mongoose.Query()

	if(params._tenant){
		query.where('_tenant', new mongoose.Types.ObjectId(params._tenant))
	}

	if(params.hideRemoved){
		query.where('removedAt', null)
	}

	if(params.search?.length){
		const reg = new RegExp(escapeRegex(params.search), 'i')
		query.or([
			{ref: reg},
			{title: reg},
		])
	}

	return query._conditions
}
