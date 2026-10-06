import mongoose from 'mongoose'
import {nanoid} from 'nanoid'

import {collation} from '../db-tools.js'
import {hashPassword} from '../password.js'

// Website account, the one making the requests. Shared by the whole French Props
// association (not tied to a tenant), kept apart from the dashboard users.
const Customer = new mongoose.Schema({
	email: {type: String, trim: true, lowercase: true, required: true, unique: true},
	password: {type: String},
	auth: {type: String}, // session token identity, renewed to log out every device
	tokenVersion: {type: Number, default: 1},

	firstName: {type: String, trim: true},
	lastName: {type: String, trim: true},
	phone: {type: String, trim: true},
	company: {type: String, trim: true},

	address: {type: String, trim: true},
	postal: {type: String, trim: true},
	city: {type: String, trim: true},
	country: {type: String},

	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'customer',
	collation
})

Customer.pre('save', function(next){
	if(this.isModified('password') && this.password) this.password = hashPassword(this.password)
	if(!this.auth) this.auth = nanoid(36)

	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('Customer', Customer)
