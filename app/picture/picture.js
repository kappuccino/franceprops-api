import sharp from 'sharp'

import * as storageAPI from '../../libs/storage/storage.js'
import * as cacheAPI from '../../libs/storage/cache.js'

// Pictures of the imported products: the original of the source, as large as
// it comes, stored once under product/<source>/<id at the source>/<hash>.<ext>.
// The hash is the one of the content: a new version (a cut-out at the source)
// gets a new key, so a stored file never changes and its thumbnails are cached
// forever. No Media document: the picture lives on its product.

// Thumbnails served by /picture: a bounding box (px), and an output format.
// A fixed list: a free size would let anyone fill the cache disk.
export const SIZES = [200, 400, 800, 1600]
export const FORMATS = ['jpg', 'webp', 'avif']

// Originals accepted, by sharp format
const ORIGINALS = {jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', tiff: 'tif', avif: 'avif'}
export const EXTENSIONS = Object.values(ORIGINALS)

const ID = /^[\w-]{1,64}$/
const HASH = /^[0-9a-f]{16}$/

// Ids of the sources go into the keys and the urls as they are: a Mongo id or
// an integer. The source key keeps two numeric ids of two sources apart.
export function isValidId(id){
	return ID.test(String(id ?? ''))
}

export function isValidHash(hash){
	return HASH.test(hash || '')
}

// Extension of an original, from its sharp metadata (null: not accepted)
export function extensionOf(meta){
	if(meta.format === 'heif') return meta.compression === 'av1' ? 'avif' : null
	return ORIGINALS[meta.format] || null
}

export function storageKey(source, pic){
	return `product/${source}/${pic.sourceId}/${pic.hash}.${pic.ext}`
}

// Every thumbnail of a stored picture, in a folder of its own
export function cacheFolder(source, pic){
	return `picture/${source}/${pic.sourceId}/${pic.hash}`
}

// Base url of a stored picture, the fronts add "/<size>.<format>"
export function pictureUrl(source, pic){
	if(!pic?.hash) return null
	return `${process.env.API_URL}/picture/${source}/${pic.sourceId}/${pic.hash}.${pic.ext}`
}

// Stored files and their thumbnails (the pictures not stored yet are skipped)
export async function removeStored(source, pics){
	const stored = pics.filter(pic => pic?.hash)
	if(!stored.length) return

	await storageAPI.removeKeys(stored.map(pic => storageKey(source, pic)))
	await Promise.all(stored.map(pic => cacheAPI.removeDir(cacheFolder(source, pic))))
}

// Thumbnail transform: oriented from its EXIF, then the metadata is dropped
// (GPS included). Never enlarged beyond the original.
export function thumbnail(size, format){
	const settings = {quality: 80}
	if(format === 'jpg') settings.chromaSubsampling = '4:4:4'

	return sharp()
		.rotate()
		.resize({width: size, height: size, fit: 'inside', withoutEnlargement: true})
		.toFormat(format === 'jpg' ? 'jpeg' : format, settings)
}
