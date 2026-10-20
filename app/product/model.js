import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// Catalogue item, owned by a single tenant (imported from its source)
const Product = new mongoose.Schema({
	_tenant: {type: mongoose.Schema.ObjectId, ref: 'Tenant', required: true, index: true},
	ref: {type: String, trim: true}, // a label only: some sources reuse it or leave it empty
	title: {type: String, trim: true},

	// Imported product: its source and its id there (see app/import)
	source: {type: String, index: true},
	externalId: String,
	_importItem: {type: mongoose.Schema.ObjectId, ref: 'ImportItem', index: true},

	// Gone from its source: hidden on the site, still valid in the requests and
	// the selections. Cleared if the product comes back.
	removedAt: {type: Date, index: true},

	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'product',
	collation
})

// Not unique: an imported product is identified by its source and its id there
// (ImportItem). Former unique index: scripts/migrate-product-ref-index.js
Product.index({_tenant: 1, ref: 1})

Product.pre('save', function(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('Product', Product)
