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

// Same rules as the password forms (dashboard, website): 8 characters, an
// uppercase, a lowercase, a digit and a special character
export function isPasswordStrong(plain){
	const pass = (plain || '').trim()

	return pass.length >= 8
		&& /[A-Z]/.test(pass)
		&& /[a-z]/.test(pass)
		&& /[0-9]/.test(pass)
		&& /[!@#$%^&*()_+~`|}{[\]:;?><,./=-]/.test(pass)
}
