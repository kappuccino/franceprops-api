import {randomBytes, scryptSync, timingSafeEqual} from 'crypto'

// Shared by every entity holding a password (User, Customer): "salt:hash"
export function hashPassword(plain){
	const salt = randomBytes(16).toString('hex')
	const hash = scryptSync(plain, salt, 64).toString('hex')
	return `${salt}:${hash}`
}

export function checkPassword(plain, stored){
	if(!plain || !stored) return false

	const [salt, key] = stored.split(':')
	if(!salt || !key) return false

	return timingSafeEqual(scryptSync(plain, salt, 64), Buffer.from(key, 'hex'))
}
