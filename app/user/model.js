import {randomBytes} from 'crypto'
import mongoose from 'mongoose'
import {nanoid} from 'nanoid'

import {collation} from '../db-tools.js'
import {hashPassword} from '../password.js'

const UserCredential = new mongoose.Schema({
	credentialID: {type: String, required: true},
	publicKey: {type: Buffer, required: true},
	counter: {type: Number, required: true, default: 0},
	name: {type: String, trim: true},

	createdAt: {type: Date},
	lastUsedAt: {type: Date},
})

const User = new mongoose.Schema({
	login: {type: String},
	password: {type: String},
	needChange: {type: Boolean, default: false},
	change: {type: mongoose.Schema.ObjectId}, // No ref
	role: {type: String},
	permissions: {type: [String]},
	firstName: {type: String},
	lastName: {type: String},
	auth: {type: String},
	tfa: {type: String},
	reset: {type: mongoose.Schema.ObjectId}, // No ref
	recovery: {type: [String]},
	hidden: {type: Boolean},

	_picture: {type: mongoose.Schema.ObjectId, ref: 'Media'},

	// Tenants a manager has full access to (admins see them all)
	_tenants: {type: [mongoose.Schema.ObjectId], ref: 'Tenant', index: true},

	credentials: [{type: UserCredential}],

	tokenVersion: {type: Number, default: 1},
	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'user',
	collation
})

User.pre('save', function(next){
	const modified = this.modifiedPaths() || []

	if(modified.includes('password')){
		this.password = hashPassword(this.get('password'))
	}

	if(modified.includes('tfa') && this.get('tfa')){
		this.recovery = Array.from({length: 10}, () => randomBytes(4).toString('hex'))
	}

	next()
})

User.pre('save', function createAuth(next){
	if(!this.auth) this.auth = nanoid(36)

	next()
})

User.pre('save', function fixDates(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('User', User)
