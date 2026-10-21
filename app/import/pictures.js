import mongoose from 'mongoose'
import {createHash} from 'crypto'

import {getQueue} from './queues.js'
import {removeStored} from '../picture/picture.js'

const Product = mongoose.model('Product')

// Pictures of a product after its import: {picture, gallery} as normalized
// from the source, merged with the stored ones by their id at the source.
//   same url → kept as it is
//   new picture, or new url (a cut-out) → pending, a picture job downloads it;
//     the stored version stays shown until the new one replaces it
//   gone from the source → its file is removed right away
//
// The picture jobs write on the same product meanwhile: the write is
// conditional on picturesRev, which every write increments, and is merged again
// when a picture job got there first.
export async function syncPictures(source, _product, wanted){
	for(let attempt = 0; attempt < 5; attempt++){
		const current = await Product.findOne({_id: _product}, {picture: 1, gallery: 1, picturesRev: 1}).lean()
		if(!current) return

		const {picture, gallery, removed} = merge(current, wanted)

		if(!isSame(current, picture, gallery)){
			const rev = current.picturesRev || 0
			const res = await Product.updateOne(
				{_id: _product, picturesRev: rev || {$in: [0, null]}},
				{$set: {picture, gallery}, $inc: {picturesRev: 1}}
			)

			if(!res.matchedCount) continue

			await removeStored(source, removed)
		}

		await enqueue(source, _product, [picture, ...gallery].filter(pic => pic?.status === 'pending'))
		return
	}

	throw new Error('pictures updated concurrently')
}


// —— Private

function merge(current, wanted){
	const known = new Map([current.picture, ...(current.gallery || [])].filter(Boolean).map(pic => [pic.sourceId, pic]))

	const next = pic => {
		const old = known.get(pic.sourceId)
		if(!old) return {...pic, status: 'pending'}
		if(old.sourceUrl === pic.sourceUrl) return old

		// The size is the one of the stored file, while it stays shown
		const {error, ...rest} = old
		return {...rest, sourceUrl: pic.sourceUrl, status: 'pending', ...(old.hash ? {} : {width: pic.width, height: pic.height})}
	}

	const picture = wanted.picture ? next(wanted.picture) : null
	const gallery = (wanted.gallery || []).map(next)

	const kept = new Set([picture, ...gallery].filter(Boolean).map(pic => pic.sourceId))
	const removed = [...known.values()].filter(pic => !kept.has(pic.sourceId))

	return {picture, gallery, removed}
}

// Compared field by field: the key order differs between the database and
// the merge
function isSame(current, picture, gallery){
	const fields = pic => pic && Object.keys(pic).sort().map(key => [key, pic[key] instanceof Date ? pic[key].getTime() : pic[key]]).filter(([, value]) => value !== undefined)
	const json = (pic, list) => JSON.stringify([fields(pic), (list || []).map(fields)])

	return json(current.picture || null, current.gallery) === json(picture, gallery)
}

// One job per version of a picture: added again while it waits, it's ignored
async function enqueue(source, _product, pics){
	if(!pics.length) return

	await getQueue(source, 'pictures').addBulk(pics.map(pic => ({
		name: 'picture',
		data: {_product: String(_product), sourceId: pic.sourceId, url: pic.sourceUrl},
		opts: {jobId: `picture-${pic.sourceId}-${createHash('sha1').update(pic.sourceUrl).digest('hex').slice(0, 12)}`}
	})))
}
