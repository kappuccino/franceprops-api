import express from 'express'
import crypto from 'crypto'
import mime from 'mime'
import {pipeline} from 'stream/promises'

import * as storageAPI from '../../libs/storage/storage.js'
import * as cacheAPI from '../../libs/storage/cache.js'
import {isSource} from '../import/sources/index.js'
import {SIZES, FORMATS, EXTENSIONS, isValidId, isValidHash, storageKey, cacheFolder, thumbnail} from './picture.js'

import {catchErrors} from '../request.js'

const router = express.Router()
export default router

// The url never changes for a given content (hash in it): cached for a year
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

// Concurrent requests for the same cold thumbnail share a single generation
const inFlight = new Map()

// Thumbnail of a product picture: /picture/defrise/6977a…/a1b2c3d4e5f6a7b8.jpg/400.webp
// Every segment is checked against a strict format: none of them reaches a
// storage or cache path as the client wrote it.
router.get('/picture/:source/:id/:original/:file',
	catchErrors(async function pictureThumbnail(req, res){

		const {source, id} = req.params
		const [hash, ext, ...extra] = req.params.original.split('.')
		const [size, format, ...more] = req.params.file.split('.')

		const valid = isSource(source) && isValidId(id) && isValidHash(hash) && EXTENSIONS.includes(ext)
			&& SIZES.includes(Number(size)) && FORMATS.includes(format) && !extra.length && !more.length

		if(!valid) return exit(res, 404)

		const pic = {sourceId: id, hash, ext}
		const cacheKey = `${cacheFolder(source, pic)}/${size}.${format}`
		const eTag = '"' + crypto.createHash('sha1').update(cacheKey).digest('base64') + '"'

		if(req.headers['if-none-match'] === eTag) return exit(res, 304)

		let cached = await cacheAPI.readStream(cacheKey)

		if(!cached){
			let gen = inFlight.get(cacheKey)

			if(!gen){
				gen = generate(storageKey(source, pic), cacheKey, Number(size), format)
					.finally(() => inFlight.delete(cacheKey))

				inFlight.set(cacheKey, gen)
			}

			try{
				await gen
			} catch(err){
				if(err.code !== 'not found') console.error(`🔥 /picture ${cacheKey}`, err.message)
				return exit(res, 404)
			}

			cached = await cacheAPI.readStream(cacheKey)
			if(!cached) return exit(res, 404)
		}

		res.writeHead(200, {
			'Content-Type': mime.getType(format),
			'Cache-Control': CACHE_CONTROL,
			'ETag': eTag
		})

		return pipeline(cached, res).catch(() => {})
	}))


// —— Private

// The original streamed from the storage through sharp into the cache, never
// held in memory as a whole
async function generate(key, cacheKey, size, format){
	const src = await storageAPI.readStream(key)
	if(!src) throw Object.assign(new Error('not found'), {code: 'not found'})

	await cacheAPI.writeStream(cacheKey, src, thumbnail(size, format))
}

function exit(res, code){
	res.status(code)
	return res.end()
}
