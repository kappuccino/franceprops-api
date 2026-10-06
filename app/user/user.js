import {promisify} from 'util'
import {nanoid} from 'nanoid'
import mongoose from 'mongoose'
import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import {generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse} from '@simplewebauthn/server'

import {sendMail, escapeRegex, sanitizeAggregate} from '../tools.js'
import {generateToken, getTokenData, removeToken} from '../token/token.js'
import {makeVersion} from '../version/version.js'
import {sign} from '../jwt.js'
import {checkPassword} from '../password.js'
import * as redis from '../redis.js'
import * as settingsApi from '../settings/settings.js'

const User = mongoose.model('User')

// WebAuthn relying party id: the parent domain of the dash (same as the
// session cookie)
const rpID = process.env.WEBAUTHN_RP_ID || process.env.COOKIE_DOMAIN || new URL(process.env.DASH_URL).hostname
const origin = process.env.DASH_URL

async function brandName(){
	const settings = await settingsApi.getDefault()
	return settings?.brandName || 'French Props'
}


//-- Auth

export async function login(login, passwd){

	if(!login) throw new Error('no login')
	if(!passwd) throw new Error('no password')

	const user = await User.findOne({login}).lean()
	if(!user) throw new Error('user not found')
	if(!user.password) throw new Error('no password')

	if(!checkPassword(passwd, user.password)) return false

	if(user.needChange){
		const change = new mongoose.Types.ObjectId()
		await User.updateOne({_id: user._id}, {change})
		return {needChange: true, change}
	}

	return {...user, password: undefined}
}

export async function prepareReset(login, url=''){

	if(!login) throw new Error('No login')

	const user = await User.findOne({login}).lean()
	if(!user) throw new Error('user not found')

	await User.updateOne(
		{_id: user._id},
		{reset: new mongoose.Types.ObjectId()}
	)

	const updatedUser = await getById(user._id)

	if(url){

		await sendMail({
			to: [updatedUser.login],
			useTemplate: 'user-reset-password',
			variables: {
				link: `${url}&token=${updatedUser.reset}`
			}
		})

	}

	return updatedUser
}

export async function resetPassword(reset, password){

	if(!reset) throw new Error('no rest _id')
	if(!password) throw new Error('no password')

	const $user = await User.findOne({reset})
	if(!$user) throw new Error('token not found')

	$user.set('password', password)
	$user.set('reset', undefined)
	$user.set('change', undefined)
	$user.set('needChange', false)
	await $user.save()

	return getById($user.get('_id'))
}

export async function changePassword(change, password){

	if(!change) throw new Error('no change _id')
	if(!password) throw new Error('no password')

	const $user = await User.findOne({change})
	if(!$user) throw new Error('token not found')

	$user.set('password', password)
	$user.set('change', undefined)
	$user.set('needChange', false)
	await $user.save()

	return getById($user.get('_id'))
}

export async function validateToken(token){
	if(!token) throw new Error('no token')

	const key = `auth:token:${token}`
	const res = await mget(key)

	return res || null
}


//-- TFA

export async function qrcodeTFA(_id){

	const toDataURL = promisify(QRCode.toDataURL)

	const user = await getById(_id)

	const issuer = await brandName()

	const secret = speakeasy.generateSecret({
		name: issuer
	})

	const otpauth_url = `otpauth://totp/${encodeURIComponent(issuer)}:${user.login}?secret=${secret.base32}&issuer=${encodeURIComponent(issuer)}`
	const qrcode = await toDataURL(otpauth_url)

	await redis.set(`user:tfa:${_id}`, secret.base32, 3600)

	/*console.log({
		secret: secret.base32,
		url: secret.otpauth_url,
		qrcode
	})*/

	return {
		secret: secret.base32,
		url: secret.otpauth_url,
		qrcode
	}
}

export async function verifyTFA(_id, token){

	const cacheKey = `user:tfa:${_id}`
	const secret = await redis.getRaw(cacheKey)
	if(!secret) return {success: false}

	const verified = await challengeTFA(secret, token)
	if(!verified) return {success: false}

	//await redis.del(cacheKey)

	return {success: true, secret}
}

export async function checkTFA(auth, token){
	console.log({auth, token})

	const user = await getByAuth(auth)
	if(!user) return false

	const secret = user?.tfa
	if(!secret) return false

	return challengeTFA(secret, token)
}

export async function recoverTFA(auth, code){

	const user = await getByAuth(auth)
	if(!user) return false

	const recovery = user.recovery || []
	console.log(recovery.includes(code))

	if(!recovery.includes(code)) return false

	const nextRecovers = recovery.filter(r => r !== code)
	await update(user._id, {recovery: nextRecovers})

	return true
}


// -- Magic Link

export async function magicLink(login, url){

	if(!login) throw new Error('No login')

	const user = await User.findOne({login}).lean()
	if(!user) throw new Error('user not found')

	if(user.needChange) throw new Error('User need to change password')

	const token = await generateToken(user.auth, 60, null)

	await sendMail({
		to: [user.login],
		useTemplate: 'user-magic-link',
		variables: {
			link: `${url}&magic=${token}`
		}
	})

	return true
}

export async function getAuthFromMagic(token){
	const data = await getTokenData(token)

	await removeToken(token)

	return data || null

}


//-- User

export async function aggregate(params){
	const $match = await _makeMatch(params)

	let agg = [
		{$match}
	]

	if(!params.sort) params.sort = {_id: -1}

	const aggLimited = sanitizeAggregate(agg, params)
	const aggNoLimit = [{$match}, {$count: 'totalDocuments'}]

	let [data, total] = await Promise.all([
		User.aggregate(aggLimited),
		User.aggregate(aggNoLimit)
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
	return User.findOne({_id}).lean()
}

export async function getByLogin(login){
	if(!login) throw new Error('no login')
	const user = await User.findOne({login}).lean()
	return user || false
}

export async function getByAuth(auth){
	if(!auth) throw new Error('no auth')
	const user = await User.findOne({auth}).lean()
	return user || false
}

export async function create(data){
	delete data._id

	if(!data.login) throw new Error('no login')
	if(!data.password) throw new Error('no passwd')

	const exists = await User.findOne({login: data.login}).lean()
	if(!!exists) throw new Error('user exists')

	const $user = new User(data)
	await $user.save()

	return getById($user.get('_id'))
}

export async function createAuthToken(_id){

	const user = await getById(_id)
	if(!user) return false

	const token = nanoid(36)
	const ttl = 24*60*60 // 1jours

	const auth = {
		date: new Date(),
		ttl,
		token,
		user: {
			_id: user._id,
			login: user.login
		}
	}

	await setex(`auth:token:${token}`, ttl, JSON.stringify(auth))

	return auth
}

export async function createJWT(user, options={}){

	// User data must exist to sign a token
	if(!user?._id || !user.login || !user.auth || !user.role) return null

	const data = {
		_user: user._id,
		login: user.login,
		auth: user.auth,
		role: user.role,
		version: user.tokenVersion || 0
	}

	return sign(data, options)
}

// ✓ version
export async function update(_id, data){

	const $user = await User.findOne({_id})
	if(!$user) throw new Error('user not exists')

	await makeVersion('user', _id, $user)

	Object
		.entries(data)
		.forEach(([key, value]) => $user.set(key, value))

	await $user.save()

	return getById(_id)
}

// ✓ version
export async function remove(_id){

	const $user = await User.findOne({_id})
	if(!$user) throw new Error('user not exists')

	await makeVersion('user', _id, $user)

	await User.deleteOne({_id})

	return true
}

export async function invalidateTokens(_id){

	const $user = await User.findOne({_id})
	if(!$user) throw new Error('user not exists')

	await User.updateOne({_id}, {$inc: {tokenVersion: 1}})

	return true
}


//-- Physical Keys

export async function loginOption(auth){

	const user = await getByAuth(auth)
	if(!user) throw new Error('user not exists')

	const options = await generateAuthenticationOptions({
		rpID,
		allowCredentials: (user.credentials || []).map(cred => ({
			id: cred.credentialID,
			type: 'public-key',
		})),
		userVerification: 'preferred',
	})

	await redis.set(`webauthn:login:${user._id}`, options.challenge, 120)

	return options
}

export async function loginVerify(auth, credential){

	const user = await getByAuth(auth)
	if(!user) throw new Error('user not exists')

	const challenge = await redis.get(`webauthn:login:${user._id}`)
	await redis.del(`webauthn:login:${user._id}`)

	const storedCredential = (user.credentials || []).find(c => c.credentialID === credential.id)
	if(!storedCredential) return {success: false}

	try {
		const verification = await verifyAuthenticationResponse({
			response: credential,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: false,
			credential: {
				id: storedCredential.credentialID,
				publicKey: new Uint8Array(storedCredential.publicKey.buffer),
				counter: storedCredential.counter,
			},
		})

		if(verification.verified){

			// Mettre à jour le counter et lastUsedAt
			await User.updateOne(
				{_id: user._id, 'credentials.credentialID': credential.id},
				{$set: {
						'credentials.$.counter': verification.authenticationInfo.newCounter,
						'credentials.$.lastUsedAt': new Date(),
					}}
			)

			return true
		}
	} catch(err){
		console.log(err)
	}

	return false
}

export async function registerOption(req_user){

	const options = await generateRegistrationOptions({
		rpName: await brandName(),
		rpID,
		userID: Buffer.from(req_user._id),
		userName: req_user.login,
		attestationType: 'none',
		// Empêche de réenregistrer une clé déjà connue
		excludeCredentials: (req_user.credentials || []).map(cred => ({
			id: cred.credentialID ,
			type: 'public-key',
		})),
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred',
		},
	});

	// On stocke le challenge pour le vérifier après
	await redis.set(`webauthn:register:${req_user._id}`, options.challenge, 120)

	return options
}

export async function registerVerify(credential, req_user){

	const challenge = await redis.get(`webauthn:register:${req_user._id}`)
	await redis.del(`webauthn:register:${req_user._id}`) // usage unique

	try {
		const verification = await verifyRegistrationResponse({
			response: credential,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: false,
		})

		if(verification.verified) {
			const {credential: newCredential} = verification.registrationInfo

			// Stocker en BDD sur le user
			await User.updateOne(
				{_id: req_user._id},
				{$push: {
					credentials: {
						credentialID: newCredential.id,
						publicKey: Buffer.from(newCredential.publicKey),
						counter: newCredential.counter,
						createdAt: new Date()
					}
				}}
			)

			return true
		}
	} catch(err){
		console.log(err)
	}

	return false
}

export async function removeCredential(_id, req_user){

	await User.updateOne(
		{_id: req_user._id},
		{$pull: {credentials: {_id}}}
	)

	return getById(req_user._id)
}

export async function updateCredentialName(_id, name, req_user){

	await User.updateOne(
		{_id: req_user._id, 'credentials._id': _id},
		{$set: {'credentials.$.name': name}}
	)

	return getById(req_user._id)
}


//-- Private

async function _makeMatch(params){

	const query = new mongoose.Query()

	if('search' in params && params.search.length){
		const pattern = escapeRegex(params.search)
		const reg = new RegExp(pattern, 'i')

		query.or([
			{'login': reg},
			{'firstName': reg},
			{'lastName': reg},
		])
	}

	if('role' in params && params.role){
		query.where('role', params.role)
	}

	if(params._tenant){
		query.where('_tenants', new mongoose.Types.ObjectId(params._tenant))
	}

	// Ne jamais resortir le user masqué
	query.where('hidden', {$ne: true})

	return query._conditions
}

async function challengeTFA(secret, token){
	return speakeasy.totp.verify({
		secret: secret,
		encoding: 'base32',
		token
	})
}
