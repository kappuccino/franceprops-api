import mongoose from 'mongoose'

import {makeVersion} from '../version/version.js'

const Taxonomy = mongoose.model('Taxonomy')

// Allowed taxonomies and their depth (1: flat)
export const TAXONOMIES = {
	category: {depth: 2},
	generic: {depth: 1},
}


//——— Public

export async function getAll(params={}){
	const cond = {}

	if(params.taxonomy?.length){
		cond.taxonomy = {$in: [params.taxonomy].flat()}
	}

	return Taxonomy.find(cond).sort({taxonomy: 1, order: 1}).lean()
}

export async function getById(_id){
	if(!_id) throw new Error('no _id')
	return Taxonomy.findOne({_id}).lean()
}

export async function create(data){
	delete data._id

	if(!TAXONOMIES[data.taxonomy]) throw new Error(`unknown taxonomy "${data.taxonomy}"`)

	// An empty parent means a root term
	if(!data._parent) delete data._parent
	await checkParent(data.taxonomy, data._parent)

	data.order = await getNextOrder(data.taxonomy, data._parent)

	const $taxo = new Taxonomy(data)
	await $taxo.save()

	return getById($taxo.get('_id'))
}

// ✓ version
export async function update(_id, data){

	const $taxo = await Taxonomy.findOne({_id})
	if(!$taxo) throw new Error('taxonomy not exists')

	// The taxonomy of a term never changes
	delete data.taxonomy

	if('_parent' in data){
		if(data._parent && data._parent.toString() === _id.toString()) throw new Error('a term can not be its own parent')

		// A term with children can not become a child (two levels max)
		const hasChildren = await Taxonomy.exists({_parent: _id})
		if(data._parent && hasChildren) throw new Error('this term has children')

		await checkParent($taxo.taxonomy, data._parent)
	}

	await makeVersion('taxonomy', _id, $taxo)

	Object
		.entries(data)
		// An empty parent means a root term
		.forEach(([key, value]) => $taxo.set(key, key === '_parent' ? (value || undefined) : value))

	await $taxo.save()

	return getById(_id)
}

export async function batchUpdate(data=[]){
	for(const {_id, ...values} of data){
		await update(_id, values)
	}

	return Taxonomy.find({_id: {$in: data.map(d => d._id)}}).lean()
}

// ✓ version
export async function remove(_ids=[]){

	const hasChildren = await Taxonomy.exists({_parent: {$in: _ids}, _id: {$nin: _ids}})
	if(hasChildren) throw new Error('remove the children first')

	for(const _id of _ids){
		const $taxo = await Taxonomy.findOne({_id})
		if(!$taxo) continue

		await makeVersion('taxonomy', _id, $taxo)
		await Taxonomy.deleteOne({_id})
	}

	return true
}

// _ids: the siblings in their new order
export async function sort(taxonomy, _ids=[]){
	await Promise.all(_ids.map((_id, order) => Taxonomy.updateOne({_id, taxonomy}, {order})))

	return Taxonomy.find({taxonomy}).sort({order: 1}).lean()
}


// —— Private

// The parent must be a root term of the same taxonomy, when the taxonomy allows it
async function checkParent(taxonomy, _parent){
	if(!_parent) return

	if(TAXONOMIES[taxonomy]?.depth < 2) throw new Error(`"${taxonomy}" is a flat taxonomy`)

	const parent = await Taxonomy.findOne({_id: _parent}).lean()
	if(!parent || parent.taxonomy !== taxonomy) throw new Error('parent not found')
	if(parent._parent) throw new Error('two levels max')
}

async function getNextOrder(taxonomy, _parent){
	const last = await Taxonomy.findOne({taxonomy, _parent: _parent || null}).sort({order: -1}).lean()
	return last ? (last.order || 0) + 1 : 0
}
