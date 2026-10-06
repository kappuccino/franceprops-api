import mongoose from 'mongoose'

import {escapeRegex, sanitizeAggregate} from '../tools.js'

const Product = mongoose.model('Product')


//——— Public

// Always scoped to one tenant
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


// —— Private

function makeMatch(params){

	if(!params._tenant) throw new Error('no tenant')

	const query = new mongoose.Query()
	query.where('_tenant', new mongoose.Types.ObjectId(params._tenant))

	if(params.search?.length){
		const reg = new RegExp(escapeRegex(params.search), 'i')
		query.or([
			{ref: reg},
			{title: reg},
		])
	}

	return query._conditions
}
