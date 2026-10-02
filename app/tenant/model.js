import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// A rental company of the French Props association
const Tenant = new mongoose.Schema({
	name: {type: String, trim: true, required: true},

	created: Date,
	updated: Date
}, {
	collection: 'tenant',
	collation
})

Tenant.pre('save', function(next){
	this.updated = new Date()
	if(this.isNew && !this.created) this.created = new Date()

	next()
})

mongoose.model('Tenant', Tenant)
