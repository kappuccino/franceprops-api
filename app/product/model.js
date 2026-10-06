import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// Catalogue item, owned by a single tenant (pushed or imported by the tenant)
const Product = new mongoose.Schema({
	_tenant: {type: mongoose.Schema.ObjectId, ref: 'Tenant', required: true, index: true},
	ref: {type: String, trim: true, required: true},
	title: {type: String, trim: true},

	created: Date,
	updated: Date
}, {
	collection: 'product',
	collation
})

// A reference is unique within its tenant only
Product.index({_tenant: 1, ref: 1}, {unique: true})

Product.pre('save', function(next){
	this.updated = new Date()
	if(this.isNew && !this.created) this.created = new Date()

	next()
})

mongoose.model('Product', Product)
