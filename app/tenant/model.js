import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// A rental company of the French Props association
const Tenant = new mongoose.Schema({
	name: {type: String, trim: true, required: true},

	// Recipient of the quote requests of this tenant
	requestEmail: {type: String, trim: true, lowercase: true},

	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'tenant',
	collation
})

Tenant.pre('save', function(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('Tenant', Tenant)
