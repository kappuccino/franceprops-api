import mongoose from 'mongoose'

import {collation} from '../db-tools.js'
import {sourceKeys} from '../import/sources/index.js'

// A rental company of the FranceProps association
const Tenant = new mongoose.Schema({
	name: {type: String, trim: true, required: true},

	// Recipient of the quote requests of this tenant
	requestEmail: {type: String, trim: true, lowercase: true},

	// Catalogue imported from this source (app/import/sources), one tenant per source
	importSource: {type: String, enum: sourceKeys},

	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'tenant',
	collation
})

// Unique when set (a sparse index would still collide on null)
Tenant.index({importSource: 1}, {unique: true, partialFilterExpression: {importSource: {$type: 'string'}}})

Tenant.pre('save', function(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('Tenant', Tenant)
