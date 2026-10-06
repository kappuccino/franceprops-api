import mongoose from 'mongoose'

import {randomInt} from 'crypto'

import {escapeRegex, sanitizeAggregate, sendMail, validateEmail} from '../tools.js'
import {makeVersion} from '../version/version.js'
import {checkPassword, isPasswordStrong} from '../password.js'
import {sign, verify} from '../jwt.js'
import * as redis from '../redis.js'

const Customer = mongoose.model('Customer')

// Never leaves the api
const PRIVATE = {password: 0, auth: 0}

// Lifetime of a customer session on the website (seconds)
const SESSION_TTL = 30 * 24 * 60 * 60

// Website signup: code sent by mail, checked before the account is created
const SIGNUP_TTL = 15 * 60
const SIGNUP_RESEND = 60
const SIGNUP_ATTEMPTS = 5

// Fields a customer fills in when signing up on the website
const SIGNUP_FIELDS = ['firstName', 'lastName', 'phone', 'company']

// Fields a customer changes from "Mon compte" on the website
const PROFILE_FIELDS = ['firstName', 'lastName', 'company', 'address', 'postal', 'city', 'country']


//——— Public

export async function aggregate(params={}){

	const $match = makeMatch(params)

	if(!params.sort) params.sort = {createdAt: -1}

	const aggLimited = sanitizeAggregate([{$match}, {$project: PRIVATE}], params)
	const aggNoLimit = [{$match}, {$count: 'totalDocuments'}]

	const [data, total] = await Promise.all([
		Customer.aggregate(aggLimited),
		Customer.aggregate(aggNoLimit)
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
	return Customer.findOne({_id}, PRIVATE).lean()
}

export async function create(data){
	delete data._id

	if(!data.email?.trim()) throw new Error('no email')

	const exists = await Customer.exists({email: data.email.trim().toLowerCase()})
	if(exists) throw new Error('customer exists')

	const $customer = new Customer(data)
	await $customer.save()

	return getById($customer.get('_id'))
}

// ✓ version
export async function update(_id, data){

	const $customer = await Customer.findOne({_id})
	if(!$customer) throw new Error('customer not exists')

	if(data.email){
		const exists = await Customer.exists({_id: {$ne: _id}, email: data.email.trim().toLowerCase()})
		if(exists) throw new Error('customer exists')
	}

	// An empty password field means "keep the current one"
	if(!data.password) delete data.password

	await makeVersion('customer', _id, $customer)

	Object
		.entries(data)
		.forEach(([key, value]) => $customer.set(key, value))

	await $customer.save()

	return getById(_id)
}

// ✓ version
export async function remove(_id){

	const $customer = await Customer.findOne({_id})
	if(!$customer) throw new Error('customer not exists')

	await makeVersion('customer', _id, $customer)

	await Customer.deleteOne({_id})

	return true
}


//——— Website session

// Signed token of the customer ({_customer}, never a dashboard user), false
// when the credentials do not match
export async function login(email, password){
	if(!email || !password) return false

	const customer = await Customer.findOne({email: email.trim().toLowerCase()}).lean()
	if(!customer?.password || !checkPassword(password, customer.password)) return false

	return createSession(customer._id)
}

// New session token of a customer (login, signup, email change)
async function createSession(_id){
	const customer = await Customer.findOne({_id}).lean()

	const token = sign({
		_customer: customer._id,
		auth: customer.auth,
		version: customer.tokenVersion || 0
	}, {expiresIn: SESSION_TTL})

	return {token, customer: await getById(customer._id)}
}

// Customer of a token, null when invalid, expired or revoked (tokenVersion)
export async function fromToken(token){
	const decoded = await verify(token)
	if(!decoded?._customer) return null

	const customer = await Customer.findOne({_id: decoded._customer}).lean()
	if(!customer || customer.auth !== decoded.auth) return null
	if((customer.tokenVersion || 0) !== decoded.version) return null

	return getById(customer._id)
}


//——— Website account (the customer is identified by his session token)

export async function updateProfile(token, data={}){
	const customer = await fromToken(token)
	if(!customer) throw new Error('invalid session')

	const fields = Object.fromEntries(Object.entries(data).filter(([k]) => PROFILE_FIELDS.includes(k)))
	return update(customer._id, fields)
}

// Every other session is closed (tokenVersion), a new token is returned for this one
export async function changePassword(token, current, password){
	const customer = await fromToken(token)
	if(!customer) throw new Error('invalid session')

	const $customer = await Customer.findOne({_id: customer._id})
	if(!checkPassword(current, $customer.password)) throw new Error('invalid password')
	if(!isPasswordStrong(password)) throw new Error('weak password')

	await makeVersion('customer', customer._id, $customer)

	$customer.set('password', password)
	$customer.set('tokenVersion', ($customer.tokenVersion || 0) + 1)
	await $customer.save()

	return login(customer.email, password)
}


//——— Website signup

// Sends the confirmation code, no account is created yet
export async function signupStart(email){
	email = (email || '').trim().toLowerCase()
	if(!validateEmail(email)) throw new Error('invalid email')

	if(await Customer.exists({email})) throw new Error('customer exists')

	const key = signupKey(email)
	const pending = await redis.get(key)
	if(pending && Date.now() - pending.sent < SIGNUP_RESEND * 1000) throw new Error('too soon')

	const code = newCode()
	await redis.set(key, {code, attempts: 0, sent: Date.now()}, SIGNUP_TTL)

	await sendMail({
		tag: 'customer-signup',
		to: [email],
		useTemplate: 'customer-signup-code',
		variables: {code}
	})

	return true
}

// Checks the code then creates the account, returns a session like login()
export async function signupConfirm(email, code, data={}){
	email = (email || '').trim().toLowerCase()

	const key = signupKey(email)
	await checkCode(key, code)

	if(!isPasswordStrong(data.password)) throw new Error('weak password')

	const fields = Object.fromEntries(Object.entries(data).filter(([k]) => SIGNUP_FIELDS.includes(k)))
	await create({...fields, email, password: data.password})
	await redis.del(key)

	return login(email, data.password)
}


//——— Website email change (code sent to the new address)

export async function emailStart(token, email, password){
	const customer = await fromToken(token)
	if(!customer) throw new Error('invalid session')

	const $customer = await Customer.findOne({_id: customer._id})
	if(!checkPassword(password, $customer.password)) throw new Error('invalid password')

	email = (email || '').trim().toLowerCase()
	if(!validateEmail(email)) throw new Error('invalid email')
	if(email === customer.email) throw new Error('same email')
	if(await Customer.exists({email})) throw new Error('customer exists')

	const key = emailKey(customer._id)
	const pending = await redis.get(key)
	if(pending && Date.now() - pending.sent < SIGNUP_RESEND * 1000) throw new Error('too soon')

	const code = newCode()
	await redis.set(key, {code, email, attempts: 0, sent: Date.now()}, SIGNUP_TTL)

	await sendMail({
		tag: 'customer-email',
		to: [email],
		useTemplate: 'customer-email-code',
		variables: {code}
	})

	return true
}

// Every other session is closed, the old address is warned
export async function emailConfirm(token, code){
	const customer = await fromToken(token)
	if(!customer) throw new Error('invalid session')

	const key = emailKey(customer._id)
	const {email} = await checkCode(key, code)

	// Taken in the meantime by another account
	if(await Customer.exists({email})) throw new Error('customer exists')

	const $customer = await Customer.findOne({_id: customer._id})
	await makeVersion('customer', customer._id, $customer)

	$customer.set('email', email)
	$customer.set('tokenVersion', ($customer.tokenVersion || 0) + 1)
	await $customer.save()
	await redis.del(key)

	try {
		await sendMail({
			tag: 'customer-email',
			to: [customer.email],
			useTemplate: 'customer-email-changed',
			variables: {email}
		})
	} catch(err){
		console.log('[customer] email changed warning failed', err.message)
	}

	return createSession(customer._id)
}


// —— Private

function newCode(){
	return randomInt(0, 1000000).toString().padStart(6, '0')
}

// Pending code of a key (signup, email change): wrong attempts are counted,
// the code is dropped after SIGNUP_ATTEMPTS
async function checkCode(key, code){
	const pending = await redis.get(key)
	if(!pending) throw new Error('code expired')

	if(pending.code !== String(code || '').trim()){
		const attempts = pending.attempts + 1

		if(attempts >= SIGNUP_ATTEMPTS){
			await redis.del(key)
			throw new Error('too many attempts')
		}

		const ttl = await redis.default.ttl(key)
		await redis.set(key, {...pending, attempts}, ttl > 0 ? ttl : SIGNUP_TTL)
		throw new Error('invalid code')
	}

	return pending
}

function signupKey(email){
	return `customer:signup:${email}`
}

function emailKey(_customer){
	return `customer:email:${_customer}`
}


function makeMatch(params){

	const query = new mongoose.Query()

	if(params.search?.length){
		const reg = new RegExp(escapeRegex(params.search), 'i')
		query.or([
			{email: reg},
			{firstName: reg},
			{lastName: reg},
			{company: reg},
			{city: reg},
		])
	}

	return query._conditions
}
