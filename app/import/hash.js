import {createHash} from 'crypto'

// Fingerprint of a product as answered by its source, for the sources without
// a reliable modification date. Same query → same key order → same JSON.
export function contentHash(value){
	return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}
