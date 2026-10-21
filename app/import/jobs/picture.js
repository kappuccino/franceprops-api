import mongoose from 'mongoose'
import sharp from 'sharp'
import mime from 'mime'
import {createHash} from 'crypto'
import {UnrecoverableError} from 'bullmq'

import * as storageAPI from '../../../libs/storage/storage.js'
import {extensionOf, storageKey, removeStored} from '../../picture/picture.js'

const Product = mongoose.model('Product')

const MAX_SIZE = 50 * 1024 * 1024
const TIMEOUT = 60000

// "picture" job: a version of a picture (its url at the source) downloaded
// and stored, then set on its product. Nothing is written when the product
// no longer wants this version (picture removed, or another cut-out since).
export async function handle(job, source){
	const {_product, sourceId, url} = job.data

	const product = await Product.findOne({_id: _product}, {picture: 1, gallery: 1}).lean()
	const current = findPicture(product, sourceId)

	if(current?.sourceUrl !== url) return 'obsolete'
	if(current.storedFrom === url && current.hash) return 'unchanged'

	const image = await download(url)
	const pic = {sourceId, hash: image.hash, ext: image.ext}

	// Same content at a new url (the source moved its files): nothing to upload
	const isNewFile = image.hash !== current.hash
	if(isNewFile) await storageAPI.putObject(storageKey(source, pic), image.body, mime.getType(image.ext))

	const stored = await setPicture(_product, sourceId, url, {
		status: 'stored',
		hash: image.hash,
		ext: image.ext,
		width: image.width,
		height: image.height,
		storedFrom: url,
		storedAt: new Date()
	}, ['error'])

	if(!stored){
		if(isNewFile) await removeStored(source, [pic])
		return 'obsolete'
	}

	// The version it replaces
	if(isNewFile && current.hash) await removeStored(source, [current])

	return isNewFile ? 'stored' : 'moved'
}

// Last attempt: the picture keeps the error, its stored version (if any) stays
export async function failed(job, source, err){
	const {_product, sourceId, url} = job.data
	await setPicture(_product, sourceId, url, {status: 'error', error: err.message})
}


// —— Private

function findPicture(product, sourceId){
	return [product?.picture, ...(product?.gallery || [])].find(pic => pic?.sourceId === sourceId) || null
}

// Conditional on the version wanted, main picture or gallery
async function setPicture(_product, sourceId, url, fields, unset=[]){
	const update = path => ({
		$set: Object.fromEntries(Object.entries(fields).map(([key, value]) => [path + key, value])),
		...(unset.length ? {$unset: Object.fromEntries(unset.map(key => [path + key, 1]))} : {}),
		$inc: {picturesRev: 1}
	})

	let res = await Product.updateOne({_id: _product, 'picture.sourceId': sourceId, 'picture.sourceUrl': url}, update('picture.'))
	if(!res.matchedCount) res = await Product.updateOne({_id: _product, gallery: {$elemMatch: {sourceId, sourceUrl: url}}}, update('gallery.$.'))

	return res.matchedCount > 0
}

// The original as the source serves it, checked by sharp: {body, hash, ext,
// width, height}. Retried on a network error or a 5xx, not on what won't change.
async function download(url){
	const res = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT)})
		.catch(err => {
			throw new Error(`${url} → ${err.cause?.message || err.message}`)
		})

	if([403, 404, 410].includes(res.status)) throw new UnrecoverableError(`HTTP ${res.status} at the source`)
	if(!res.ok) throw new Error(`HTTP ${res.status} at the source`)
	if(Number(res.headers.get('content-length')) > MAX_SIZE) throw new UnrecoverableError('file too large')

	const chunks = []
	let size = 0

	for await (const chunk of res.body){
		size += chunk.length
		if(size > MAX_SIZE) throw new UnrecoverableError('file too large')
		chunks.push(chunk)
	}

	const body = Buffer.concat(chunks)

	const meta = await sharp(body).metadata()
		.catch(() => {
			throw new UnrecoverableError('not an image')
		})

	const ext = extensionOf(meta)
	if(!ext) throw new UnrecoverableError(`format not accepted (${meta.format})`)

	// EXIF orientations 5 to 8 turn the picture by 90°, as the thumbnails do
	const turned = meta.orientation >= 5

	return {
		body,
		ext,
		hash: createHash('sha1').update(body).digest('hex').slice(0, 16),
		width: turned ? meta.height : meta.width,
		height: turned ? meta.width : meta.height
	}
}
